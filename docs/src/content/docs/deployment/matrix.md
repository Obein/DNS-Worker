---
title: Architecture & Comparison Matrix
description: Comprehensive feature matrix comparing Standalone Serverfull mode and Cloudflare Workers Edge mode.
---

Whether you prioritize global edge acceleration with zero maintenance across 300+ PoPs, or complete data sovereignty with native UDP 53 on your router and Android DoT 853, DNS Worker delivers high-performance filtering, instant local analytics, and post-quantum zero-knowledge encrypted logging.

## Dual-Engine Comparison Matrix

| Feature / Dimension | 🖥️ Standalone Server / VPS (Cloudflare-Free) | ☁️ Cloudflare Workers Edge Mode |
|---|---|---|
| **Core Value** | 100% Data Sovereignty, Home LAN/Router, Android DoT | Global Ultra-Low Latency, Zero Maintenance |
| **Runtime Platform** | Linux / VPS / macOS / Windows (`Node.js >= 22.5.0`) | Cloudflare Global 300+ Edge Locations |
| **Storage Engine** | Native Node.js SQLite (`node:sqlite`) on NVMe/SSD | Cloudflare D1 (Global Distributed SQL) |
| **Supported Protocols** | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** (RFC 8484) | **DoH** (RFC 8484 over HTTPS) |
| **Data Ownership** | **100% Self-Hosted**, zero vendor lock-in | Edge-encrypted; hosted on Cloudflare infrastructure |
| **Router / LAN Integration** | **Direct UDP 53** (Point router DNS directly to server IP) | Requires DoH client, proxy, or split-tunnel tool |
| **Android Private DNS** | **Native DoT 853** with SNI routing (`<token>.dns.example.com`) | Requires DoH URL or third-party client |
| **Post-Quantum Zero-Knowledge E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn |
| **Local-First Web Dashboard** | ✅ In-browser SQLite WASM + OPFS 0ms queries | ✅ In-browser SQLite WASM + OPFS 0ms queries |
| **Process Daemon** | Native systemd / schtasks (`dns-worker service install`) | Zero server maintenance, auto-scaling |
| **Cost & Requirements** | Runs on existing VPS or home server hardware | Free tier eligible on Cloudflare |

---

## Which One Should You Choose?

- **Choose Standalone Server (Serverfull)**:
  - You want to configure network-wide ad blocking for routers and smart TVs via classic UDP 53;
  - You want to use Android's built-in "Private DNS" setting without third-party VPN apps;
  - You prefer keeping 100% of resolution history on your own storage.
- **Choose Cloudflare Workers Edge**:
  - You travel frequently and need minimal latency from 300+ locations worldwide;
  - You want a completely maintenance-free setup with automatic scaling and zero OS patching.
