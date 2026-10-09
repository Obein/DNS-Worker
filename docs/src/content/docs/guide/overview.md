---
title: Project Overview
description: Learn about the design philosophy, dual-engine architecture, and core capabilities of DNS Worker.
---

## What is DNS Worker?

**DNS Worker** is a modern, privacy-first Protective DNS resolution platform built with an innovative **Dual-Engine Architecture**:

1. **🖥️ Standalone Server Mode (Serverfull)**:
   Run completely independent of Cloudflare on your own VPS, home server, or bare-metal Linux/Windows host. Powered by Node.js built-in `node:sqlite`, it natively serves classic UDP 53, DoT 853, and Web Dashboard / DoH.
2. **☁️ Edge Serverless Mode**:
   Deploy across 300+ global edge locations on Cloudflare Workers and D1 database, enjoying zero infrastructure maintenance and sub-millisecond edge latency.

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
