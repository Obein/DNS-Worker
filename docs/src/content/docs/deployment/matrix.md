---
title: Architecture & Comparison Matrix
description: Comprehensive feature matrix comparing Cloudflare Workers Edge mode (Primary) and Standalone Serverfull mode.
---

Whether you prioritize global edge acceleration with zero maintenance across 300+ PoPs, or complete data sovereignty with native UDP 53 on your router and Android DoT 853, DNS Worker delivers high-performance filtering, instant local analytics, and post-quantum zero-knowledge encrypted logging.

## Dual-Engine Comparison Matrix

| Feature / Dimension | ☁️ Cloudflare Workers Edge (Primary / Recommended) | 🖥️ Standalone Server / VPS (Serverfull Self-Hosted) |
|---|---|---|
| **Core Value** | **Global Ultra-Low Latency, Zero Maintenance** | 100% Data Sovereignty, Home LAN/Router, Android DoT |
| **Runtime Platform** | **Cloudflare Global 300+ Edge Locations** | Linux / VPS / macOS / Windows (`Node.js >= 22.5` / `Bun >= 1.4`) |
| **Storage Engine** | **Cloudflare D1 (Global Distributed SQL)** | Native SQLite (`node:sqlite`) on NVMe/SSD |
| **Supported Protocols** | **DoH** (RFC 8484 over HTTP/2 & HTTP/3) | **UDP 53** (RFC 1035) + **DoT 853** (RFC 7858) + **DoH** |
| **Infrastructure Overhead** | **Zero Server Maintenance**, auto-scaling worldwide | Requires host maintenance, OS patching, systemd daemon |
| **Router / LAN Integration** | Forward via DoH proxy (SmartDNS, AdGuard Home, OpenWrt) | **Direct UDP 53** (Point router DNS directly to server IP) |
| **Android Private DNS** | Native DoH URL or third-party client | **Native DoT 853** with SNI routing (`<token>.dns.example.com`) |
| **Post-Quantum Zero-Knowledge E2EE** | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn | ✅ NIST FIPS 203 **P256-MLKEM768** + Passkey WebAuthn |
| **Local-First Web Dashboard** | ✅ In-browser SQLite WASM + OPFS 0ms queries | ✅ In-browser SQLite WASM + OPFS 0ms queries |
| **Cost & Requirements** | **Free tier eligible** on Cloudflare | Runs on existing VPS or home server hardware |

---

## Which One Should You Choose?

### ☁️ Choose Cloudflare Workers Edge (Primary / Recommended)
- You want a **maintenance-free** protective DNS resolver that scales automatically;
- You travel frequently or need minimal DNS latency from 300+ locations worldwide;
- You prefer not to manage Linux server daemons, firewalls, or SSL renewals manually;
- You want free tier deployment on world-class global infrastructure.

### 🖥️ Choose Standalone Server / VPS (Serverfull Alternative)
- You want to configure network-wide ad blocking for routers and smart TVs via classic UDP 53;
- You want to use Android's built-in "Private DNS" setting on port 853 without third-party apps;
- You prefer keeping 100% of query logs and SQLite files on your private NVMe storage.
