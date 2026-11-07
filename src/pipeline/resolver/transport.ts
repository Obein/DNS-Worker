import { connectUniversal } from "../../utils/sockets";
import { parseDnsStamp } from "../../utils/dnsStamp";
import { http2SessionPool, isHttp2Supported } from "../../utils/http2Client";
import { getAppUserAgent } from "../../constants/version";
import { UpstreamHttpError, UpstreamTransportResult } from "./types";

/**
 * Parsed upstream endpoint and diagnostic information.
 */
export interface UpstreamEndpointInfo {
  /** The effective target URL after resolving stamps or protocols. */
  effectiveUrl: string;
  /** Diagnostic string of the transport protocol (e.g., 'POST', 'DoT', 'TCP'). */
  diagMethod: string;
  /** Diagnostic target string (URL or socket address). */
  diagTarget: string;
}

/**
 * Reads a 2-byte framed DNS message from a ReadableStream reader (RFC 1035 / RFC 7858).
 * Handles TCP / TLS packet fragmentation and enforces a timeout.
 *
 * @param reader - ReadableStream reader for the upstream socket.
 * @param timeoutMs - Timeout duration in milliseconds.
 * @returns Complete wire-format DNS answer packet without 2-byte length header.
 */
export async function readFramedDnsResponse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 5000
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let expectedBodyLength: number | null = null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Upstream Socket Timeout")), timeoutMs);
  });

  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), timeoutPromise]);
      if (done || !value) {
        throw new Error("Socket closed before complete DNS response received");
      }

      chunks.push(value);
      totalBytes += value.length;

      // RFC 1035 Section 4.2.2: Max DNS TCP message is 65535 bytes + 2 bytes prefix
      if (totalBytes > 65537) {
        throw new Error("DNS upstream message exceeded maximum RFC frame length (65535 bytes)");
      }

      if (expectedBodyLength === null && totalBytes >= 2) {
        const b0 = chunks[0][0];
        const b1 = chunks[0].length > 1 ? chunks[0][1] : chunks[1][0];
        expectedBodyLength = (b0 << 8) | b1;
      }

      if (expectedBodyLength !== null && totalBytes >= 2 + expectedBodyLength) {
        const combined = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(chunk, offset);
          offset += chunk.length;
        }
        return combined.slice(2, 2 + expectedBodyLength);
      }
    }
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

/**
 * Parses a host and port from a target URL with support for IPv6 brackets.
 *
 * @param address - Host string potentially prefixed with protocol and containing port.
 * @param defaultPort - Default port to use if omitted.
 * @returns Object containing parsed host and port.
 */
export function parseHostAndPort(
  address: string,
  defaultPort: number
): { host: string; port: number } {
  let host = address;
  let port = defaultPort;

  if (host.startsWith("[")) {
    const closeIdx = host.indexOf("]");
    if (closeIdx !== -1) {
      const ip = host.slice(1, closeIdx);
      const rest = host.slice(closeIdx + 1);
      host = ip;
      if (rest.startsWith(":")) {
        port = parseInt(rest.slice(1), 10) || defaultPort;
      }
    }
  } else if (host.includes(":")) {
    const parts = host.split(":");
    host = parts[0];
    port = parseInt(parts[1], 10) || defaultPort;
  }

  return { host, port };
}

/**
 * Queries an upstream DNS server over DNS over TLS (DoT - RFC 7858).
 *
 * @param host - Remote DoT hostname or IP address.
 * @param port - Remote port number (default 853).
 * @param queryRaw - Wire-format DNS query packet.
 * @param timeoutMs - Connection and read timeout in milliseconds (default 5000).
 * @returns Complete wire-format DNS answer packet.
 */
export async function queryDoT(
  host: string,
  port = 853,
  queryRaw: Uint8Array,
  timeoutMs = 5000
): Promise<Uint8Array> {
  const socket = await connectUniversal({
    hostname: host,
    port,
    secureTransport: "on"
  });

  try {
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    // RFC 7858 Section 3.3: 2-byte length prefix + DNS message
    const framedQuery = new Uint8Array(queryRaw.length + 2);
    framedQuery[0] = (queryRaw.length >> 8) & 0xff;
    framedQuery[1] = queryRaw.length & 0xff;
    framedQuery.set(queryRaw, 2);

    await writer.write(framedQuery);
    writer.releaseLock();

    return await readFramedDnsResponse(reader, timeoutMs);
  } finally {
    await socket.close().catch(() => {});
  }
}

/**
 * Queries an upstream DNS server over Classic TCP (RFC 1035).
 *
 * @param host - Remote TCP hostname or IP address.
 * @param port - Remote port number (default 53).
 * @param queryRaw - Wire-format DNS query packet.
 * @param timeoutMs - Connection and read timeout in milliseconds (default 5000).
 * @returns Complete wire-format DNS answer packet.
 */
export async function queryTcp(
  host: string,
  port = 53,
  queryRaw: Uint8Array,
  timeoutMs = 5000
): Promise<Uint8Array> {
  const socket = await connectUniversal({
    hostname: host,
    port,
    secureTransport: "off"
  });

  try {
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    const framedQuery = new Uint8Array(queryRaw.length + 2);
    framedQuery[0] = (queryRaw.length >> 8) & 0xff;
    framedQuery[1] = queryRaw.length & 0xff;
    framedQuery.set(queryRaw, 2);

    await writer.write(framedQuery);
    writer.releaseLock();

    return await readFramedDnsResponse(reader, timeoutMs);
  } finally {
    await socket.close().catch(() => {});
  }
}

/**
 * Resolves raw upstream URL or DNS stamp into effective endpoint info and diagnostic targets.
 *
 * @param rawUpstreamUrl - Configured upstream URL or connection string.
 * @returns Endpoint details for network dispatch and diagnostics.
 */
export function resolveUpstreamEndpoint(rawUpstreamUrl: string): UpstreamEndpointInfo {
  let effectiveUrl = rawUpstreamUrl;

  if (rawUpstreamUrl.startsWith("sdns://")) {
    const stamp = parseDnsStamp(rawUpstreamUrl);
    if (stamp.protocol === "dnscrypt") {
      throw new Error(
        "DNSCrypt (0x01) protocol in DNS Stamp is not supported; please use DoH (0x02) or DoT (0x03) DNS Stamps"
      );
    }
    if (stamp.protocol === "doq") {
      effectiveUrl = stamp.resolvedUrl || `quic://${stamp.hostname || stamp.serverAddress}:853`;
    }
    if (!stamp.resolvedUrl && stamp.protocol !== "doq") {
      throw new Error(`Unsupported DNS Stamp protocol: 0x${stamp.protocolId.toString(16)}`);
    }
    if (stamp.protocol !== "doq") {
      effectiveUrl = stamp.resolvedUrl!;
    }
  }

  if (effectiveUrl.startsWith("dot://")) {
    effectiveUrl = effectiveUrl.replace(/^dot:\/\//, "tls://");
  }

  if (effectiveUrl.startsWith("quic://") || effectiveUrl.startsWith("doq://")) {
    const rawHost = effectiveUrl.replace(/^(quic|doq):\/\//, "");
    const { host, port } = parseHostAndPort(rawHost, 853);
    return {
      effectiveUrl: `tls://${host}:${port}`,
      diagMethod: "DoQ",
      diagTarget: `quic://${host}:${port}`
    };
  }

  if (effectiveUrl.startsWith("tls://")) {
    const rawHost = effectiveUrl.replace(/^tls:\/\//, "");
    const { host, port } = parseHostAndPort(rawHost, 853);
    return {
      effectiveUrl,
      diagMethod: "DoT",
      diagTarget: `tls://${host}:${port}`
    };
  }

  if (!effectiveUrl.startsWith("http://") && !effectiveUrl.startsWith("https://")) {
    const rawHost = effectiveUrl.replace(/^(tcp|udp):\/\//, "");
    const { host, port } = parseHostAndPort(rawHost, 53);
    return {
      effectiveUrl,
      diagMethod: "TCP",
      diagTarget: `tcp://${host}:${port}`
    };
  }

  return {
    effectiveUrl,
    diagMethod: "POST",
    diagTarget: effectiveUrl
  };
}

/**
 * Communicates with the upstream DNS server over DoH, DoT, TCP, or DNS Stamps.
 *
 * Upstream Protocol Priority:
 * 1. HTTP/3 (DoH3 / RFC 9114) -> Future extension point
 * 2. HTTP/2 (RFC 8484 §5.2)   -> Required minimum HTTP version for DoH. In Node.js Serverfull, DoH queries strictly enforce native HTTP/2.
 *
 * In accordance with RFC 8484 §5.2, HTTP/1.1 negotiation is forbidden for DoH ("Clients and servers MUST NOT negotiate HTTP/1.1 for DoH").
 * If an upstream DoH query fails, the failure details (HTTP status code, status text, upstream body snippet)
 * are raised directly via UpstreamHttpError without silent protocol switching.
 *
 * @param endpoint - Resolved upstream endpoint information.
 * @param queryRaw - Wire-format DNS query packet.
 * @returns Upstream resolution result containing raw answer, latency, and diagnostics.
 */
export async function fetchFromUpstream(
  endpoint: UpstreamEndpointInfo,
  queryRaw: Uint8Array
): Promise<UpstreamTransportResult> {
  const { effectiveUrl, diagMethod, diagTarget } = endpoint;
  const startFetch = Date.now();
  let answer: Uint8Array;

  if (effectiveUrl.startsWith("tls://") || effectiveUrl.startsWith("dot://")) {
    // ── DNS over TLS (DoT - RFC 7858) ──────────────────────────────────
    const rawHost = effectiveUrl.replace(/^(tls|dot):\/\//, "");
    const { host: dotHost, port: dotPort } = parseHostAndPort(rawHost, 853);
    answer = await queryDoT(dotHost, dotPort, queryRaw, 5000);
  } else if (
    !effectiveUrl.startsWith("http://") &&
    !effectiveUrl.startsWith("https://")
  ) {
    // ── Classic DNS (TCP Socket) ──────────────────────────────────────────
    const rawHost = effectiveUrl.replace(/^(tcp|udp):\/\//, "");
    const { host: tcpHost, port: tcpPort } = parseHostAndPort(rawHost, 53);
    answer = await queryTcp(tcpHost, tcpPort, queryRaw, 5000);
  } else {
    // ── DoH (DNS over HTTPS - RFC 8484) ─────────────────────────────────
    const dohUrl = new URL(effectiveUrl);

    // 1. Prioritize HTTP/2 (H2) if supported in the current environment
    if (isHttp2Supported()) {
      try {
        const h2Res = await http2SessionPool.request(dohUrl, queryRaw, 5000);
        if (h2Res.status >= 200 && h2Res.status < 300) {
          const latency = Date.now() - startFetch;
          return {
            answer: h2Res.answer,
            latency,
            diagMethod: "H2",
            diagTarget: effectiveUrl
          };
        }

        let snippet = "";
        try {
          snippet = new TextDecoder()
            .decode(h2Res.answer)
            .replace(/<[^>]*>?/gm, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300);
        } catch {}
        throw new UpstreamHttpError(h2Res.status, "HTTP/2 Error", snippet);
      } catch (h2Err) {
        if (h2Err instanceof UpstreamHttpError) {
          throw h2Err;
        }
        // Strict RFC 8484 §5.2: Minimum HTTP version is HTTP/2. Do NOT fall back to HTTP/1.1 fetch.
        const errMsg = h2Err instanceof Error ? h2Err.message : String(h2Err);
        throw new Error(`Upstream DoH requires HTTP/2 or later (RFC 8484 §5.2). HTTP/2 connection failed: ${errMsg}`);
      }
    }

    // 2. Standard fetch (Cloudflare Workers runtime with edge HTTP/2 negotiation)
    const response = await fetch(effectiveUrl, {
      method: "POST",
      headers: {
        Accept: "application/dns-message",
        "Content-Type": "application/dns-message",
        "User-Agent": getAppUserAgent()
      },
      body: queryRaw,
      signal: AbortSignal.timeout(5000)
    });

    if (!response.ok) {
      let snippet = "";
      try {
        const rawBody = await response.text();
        // Extract plain text snippet (strip HTML tags and extra whitespace), retain max 300 chars
        snippet = rawBody.replace(/<[^>]*>?/gm, " ").replace(/\s+/g, " ").trim().slice(0, 300);
      } catch {}
      const cfRay = response.headers.get("cf-ray") || undefined;
      throw new UpstreamHttpError(response.status, response.statusText, snippet, cfRay);
    }

    const answerBuffer = await response.arrayBuffer();
    answer = new Uint8Array(answerBuffer);
  }

  const latency = Date.now() - startFetch;
  return { answer, latency, diagMethod, diagTarget };
}
