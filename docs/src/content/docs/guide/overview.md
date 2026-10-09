---
title: Project Overview
description: Learn about the design philosophy, dual-engine architecture, and core capabilities of DNS Worker.
---

## What is DNS Worker?

**DNS Worker** is a modern, privacy-first Protective DNS resolution platform built with an innovative **Dual-Engine Architecture**:

1. **☁️ Edge Serverless Mode (Primary / Recommended)**:
   Deploy across 300+ global edge locations on Cloudflare Workers and Cloudflare D1 distributed SQL database. Benefit from zero server maintenance, global Anycast acceleration, and sub-millisecond edge latency.
2. **🖥️ Standalone Server Mode (Serverfull Self-Hosted)**:
   Run completely independent of Cloudflare on your own VPS, home server, or bare-metal Linux/Windows host. Powered by Node.js built-in `node:sqlite`, it natively serves classic UDP 53, DoT 853 (with TLS SNI profile routing), and Web Dashboard / DoH.

---

## Interactive Web Dashboard & Threat Intelligence

DNS Worker comes with a built-in modern Web Dashboard that provides real-time visualization of query traffic, latency distribution, and security metrics:

![DNS Worker Web Dashboard Analytics](/DNS-Worker/screenshots/dns.obex-stats.webp)

- **Comprehensive Security Metrics**: Track total requests, intercepted ads & malicious queries, average latency, and 24-hour traffic trends.
- **Top Blocked & Permitted Domains**: Identify high-frequency tracker beacons and rogue domains at a glance.

---

## Global Routing & Destination Analytics

![Geographic Resolution Destinations Map](/DNS-Worker/screenshots/dns.obex-stats_dest.webp)

DNS Worker automatically maps DNS resolution destinations and upstream recursive servers geographically, enabling you to inspect where your traffic is routed across the globe in real time.

---

## Protocols & Capabilities

### 1. Full-Stack Protocol Coverage
* **Classic UDP 53 (RFC 1035)**: Standard DNS resolution for routers, LAN devices, and system-wide configurations.
* **DoT 853 (RFC 7858)**: Encrypted DNS over dedicated port 853 with TLS SNI profile routing (`<profileKey>.dns.example.com`), natively compatible with Android 9+ Private DNS.
* **DoH (RFC 8484)**: Fast encrypted DNS over HTTP/2 and HTTP/3 (Alt-Svc) for all modern web browsers.
* **DoQ (RFC 9250)**: Encrypted DNS over QUIC with 0-RTT handshakes and zero head-of-line blocking.
* **ECH & DDR (RFC 9460)**: Broadcast Encrypted Client Hello parameters and outer SNI, paired with Discovery of Designated Resolvers (DDR).

### 2. Local-First Architecture
Using embedded in-browser SQLite (WebAssembly + Origin Private File System), query log filtering and multi-dimensional analytics render instantly in 0ms without exhausting server database read quotas.

### 3. Post-Quantum Zero-Knowledge E2EE
Implements NIST FIPS 203 **P256-MLKEM768** hybrid lattice cryptography, protected by hardware Passkeys (WebAuthn). Persistent storage holds only irreversible ciphertexts; decryption takes place strictly on authorized user devices.

---

## Mobile & Desktop Responsive Design

DNS Worker is fully responsive, delivering a smooth mobile management experience alongside desktop views:

| Mobile Security Analytics | Mobile Query Audit Stream |
| :---: | :---: |
| ![Mobile Analytics](/DNS-Worker/screenshots/dns.obex-mobile_stats.webp) | ![Mobile Query Logs](/DNS-Worker/screenshots/dns.obex-mobile_log.webp) |
