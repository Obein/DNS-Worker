---
title: Upstreams & Network Architecture
description: Upstream DNS resolution engines, ECH privacy fronting, GeoIP split-routing, and complete network environment variables reference.
sidebar:
  order: 2
---

DNS Worker acts as an intelligent intermediary and privacy shield between client devices and recursive root nameservers. This document details the upstream resolution pipeline, Encrypted Client Hello (ECH) protection, GeoIP intelligence, and network-related configuration variables.

---

## 1. Upstream Resolution Engine

DNS Worker supports high-concurrency recursive query forwarding over multiple modern transport protocols:

```
[ Client Device ]
        │  (DoH / DoT / UDP)
        ▼
┌────────────────────────────────────────────────────────┐
│ DNS Worker Engine                                      │
│  ├─ Policy & Blocklist Evaluation                      │
│  ├─ Cache & ECS (EDNS Client Subnet) Injection         │
│  └─ Multiplexed Upstream Dispatcher                    │
└────────────────────────────────────────────────────────┘
        │
   ┌────┴───────────────────────────┬──────────────────────┐
   ▼                                ▼                      ▼
[ DoQ / QUIC Upstream ]    [ DoH + ECH Upstream ]   [ DoT / TLS Upstream ]
 (RFC 9250 - quic://)       (RFC 8484 / RFC 9460)    (RFC 7858 - tls://)
```

### Supported Upstream URI Schemes
When configuring custom upstreams in the Web UI or via environment variables, you can use any of the following URI schemes:

- **Classic UDP / TCP**: `udp://1.1.1.1:53` or `1.1.1.1`
- **DNS over TLS (DoT)**: `tls://dns.quad9.net` or `tls://1.0.0.1:853`
- **DNS over HTTPS (DoH)**: `https://cloudflare-dns.com/dns-query`
- **DNS over QUIC (DoQ)**: `quic://dns.adguard-dns.com` or `doq://9.9.9.9:853`

---

## 2. Encrypted Client Hello (ECH) Protection

When resolving upstream queries over DoH or HTTPS, network eavesdroppers and intermediate ISPs could historically inspect the plain-text **Server Name Indication (SNI)** in TLS handshakes.

DNS Worker integrates **RFC 9460 / RFC 8484 Encrypted Client Hello (ECH)**:
- Outbound DoH requests encrypt the outer SNI header using ephemeral public keys published in DNS HTTPS/SVCB resource records.
- When enabled, recursive requests appear to intermediate networks as connecting to a generic fronting domain (e.g., `cloudflare-ech.com`), concealing the true upstream resolver destination.

---

## 3. GeoIP & EDNS Client Subnet (ECS)

To prevent Content Delivery Networks (CDNs) from routing users to distant edge nodes, DNS Worker supports intelligent EDNS Client Subnet (ECS) forwarding:
- **Subnet Precision**: Forwards truncated `/24` (IPv4) or `/48` (IPv6) client subnets to authoritative nameservers, preserving geographical routing accuracy without exposing user IP addresses.
- **Regional IP Classification**: Checks queries against `IP_REGION` to route domestic and international domains to their geographically optimal upstream resolvers.

---

---

## 4. Network Configuration: Serverless vs Serverfull

Because Cloudflare Workers runs on an edge serverless runtime while Serverfull mode runs directly on a host operating system, network parameters differ significantly between `wrangler.toml` and `.env.serverfull`.

| Network Parameter | Serverless (`wrangler.toml`) | Serverfull (`.env.serverfull`) | Architectural Difference |
| :--- | :--- | :--- | :--- |
| **Listener Binding** | N/A (Managed by Cloudflare Anycast) | `SERVERFULL_HOST=0.0.0.0` | Serverfull listens on local host network interfaces. |
| **UDP DNS Port** | Not supported directly on Edge | `SERVERFULL_UDP_PORT=53` | Serverfull binds native UDP port 53. |
| **DoT Port** | Not supported directly on Edge | `SERVERFULL_DOT_PORT=853` | Serverfull binds native TLS port 853 for DoT. |
| **Web UI & DoH (HTTP)** | N/A | `SERVERFULL_HTTP_PORT=10080` | Local HTTP reverse proxy / dashboard port. |
| **Web UI & DoH (HTTPS)** | N/A (Managed by Cloudflare CDN 443) | `SERVERFULL_HTTPS_PORT=10443` | Direct HTTPS port when TLS certificates are mounted. |
| **DoT Base Domain** | N/A | `SERVERFULL_DOT_DOMAIN=dns.example.com` | Required in Serverfull for Android Private DNS and SNI matching. |
| **ECH Mode** | `PRESET_ECH_FRONTING_DOMAINS` (JSON array) | `SERVERFULL_ECH_ENABLED=true` | Serverfull synthesizes RFC 9460 HTTPS/SVCB ECH responses dynamically. |
| **Emergency Fail-Open** | `FAIL_OPEN_UPSTREAM` | `FAIL_OPEN_UPSTREAM` | Identical default (`https://freedns.controld.com/no-ads-malware-typo`). |

---

## 5. Network Environment Variables Reference

### Upstream DNS Variables

#### `FAIL_OPEN_UPSTREAM`
- **Supported in**: Serverless & Serverfull
- **Default (`wrangler.toml`)**: `https://freedns.controld.com/no-ads-malware-typo`
- **Default (`.env.serverfull`)**: `https://freedns.controld.com/no-ads-malware-typo`
- **Description**: Emergency upstream resolver invoked when all upstream pools timeout or encounter fatal transport failures. Supports HTTPS (DoH), DoT (`tls://`), TCP (`tcp://`), and DNS Stamps (`sdns://`).

#### `PRESET_UPSTREAMS`
- **Supported in**: Serverless & Serverfull
- **Format (`wrangler.toml`)**: Multi-line TOML string containing JSON array of objects with `label` and `url`.
- **Format (`.env.serverfull`)**: Single-line JSON string.
- **Default**: Curated pool containing Cloudflare Security, Quad9 ECS, AdGuard, and Google DNS.

---

### ECH (Encrypted Client Hello) Variables

#### `PRESET_ECH_FRONTING_DOMAINS` *(Serverless)*
- **Type**: JSON string array
- **Default**: `["cloudflare-ech.com", "crypto.cloudflare.com", "one.one.one.one", "www.cloudflare.com", "encryptedsni.com", "cdnjs.com"]`
- **Description**: Candidate cover domains randomly selected for outer SNI wrapping in Cloudflare Worker recursive requests.

#### `SERVERFULL_ECH_ENABLED` & `SERVERFULL_ECH_FRONTING_DOMAIN` *(Serverfull)*
- **Type**: `boolean` & `string`
- **Default**: `SERVERFULL_ECH_ENABLED=true`, `SERVERFULL_ECH_FRONTING_DOMAIN=cloudflare-ech.com`
- **Description**: Controls whether the Serverfull daemon synthesizes ECHConfig parameters in DNS HTTPS/SVCB and DDR responses, and defines the default cover domain.

---

### Serverfull Port & Daemon Binding Variables *(Serverfull Only)*

#### `SERVERFULL_HOST`
- **Default**: `0.0.0.0`
- **Description**: Local interface to bind. Use `127.0.0.1` if reverse-proxying behind Caddy or Nginx.

#### `SERVERFULL_UDP_PORT` (or `SERVERFULL_PORT`)
- **Default**: `53`
- **Description**: RFC 1035 UDP DNS port. Requires root or `CAP_NET_BIND_SERVICE`.

#### `SERVERFULL_DOT_PORT`
- **Default**: `853`
- **Description**: RFC 7858 DNS over TLS port.

#### `SERVERFULL_HTTP_PORT` & `SERVERFULL_HTTPS_PORT`
- **Default**: `10080` (HTTP) & `10443` (HTTPS)
- **Description**: Web Dashboard and DoH query ports. HTTPS is automatically enabled when valid TLS certificates are mounted via `SERVERFULL_TLS_CERT_PATH` and `SERVERFULL_TLS_KEY_PATH`.

#### `SERVERFULL_DOT_DOMAIN`
- **Default**: `dns.example.com`
- **Description**: Base domain for DoT and Android Private DNS routing. Must have wildcard DNS record (`*.your.domain`) and valid TLS certificate.
