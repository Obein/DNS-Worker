<div align="center">
  <img src="https://raw.githubusercontent.com/Obein/DNS-Worker/main/web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>Privacy-First Protective DNS Resolver & DoH / DoT Server</p>
  <p>Protect your first hop on the internet</p>
  <p align="center">
    English | <a href="README_zh-CN.md">中文 (简体)</a> | <a href="README_zh-TW.md">中文 (正體)</a>
  </p>

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
[![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
[![Runtime: Node.js >= 22.5](https://img.shields.io/badge/Runtime-Node.js%20%3E%3D%2022.5%20(LTS%20Recommended)-green.svg)](https://nodejs.org/)
[![Security: NIST FIPS 203 PQC](https://img.shields.io/badge/Security-NIST%20FIPS%20203%20PQC-purple.svg)](https://csrc.nist.gov/pubs/fips/203/final)
[![Docs: Astro Starlight](https://img.shields.io/badge/Docs-Astro%20Starlight-blueviolet.svg)](https://obein.github.io/DNS-Worker/)
[![Protocols: UDP 53 · DoT 853 · DoH](https://img.shields.io/badge/Protocols-UDP%2053%20%7C%20DoT%20853%20%7C%20DoH-brightgreen.svg)](https://obein.github.io/DNS-Worker/deployment/matrix/)

</div>

---

## 📖 Introduction

**DNS Worker** is a privacy-first protective DNS resolution system built with an innovative **Dual-Engine Architecture**:
- **🖥️ Standalone Server Mode (Serverfull)**: Run completely free of Cloudflare on your own VPS, Linux home server, or Windows machine, with native **UDP 53**, **DoT 853** (TLS SNI routing for Android Private DNS), and local SQLite.
- **☁️ Edge Serverless Mode**: Run on Cloudflare Workers across 300+ edge locations worldwide with D1 database, enjoying zero maintenance.

> 📚 **Official Documentation Site**  
> For full deployment tutorials, dual-engine comparison matrix, TLS certificate & permission best practices, environment variable dictionary, and troubleshooting:  
> 👉 [**https://obein.github.io/DNS-Worker/**](https://obein.github.io/DNS-Worker/)

### Quick Start

#### Option A: Standalone Server via npm
```bash
# Install globally and run
npm install -g dns-worker
dns-worker config init
dns-worker
# Web Dashboard: http://localhost:10080
```

#### Option B: Deploy to Cloudflare Workers
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

### Key Highlights
- ⚡ **Full-Stack Protocols**: UDP 53, DoT 853, DoH (HTTP/2 & HTTP/3), DoQ (RFC 9250), ECH & DDR (RFC 9460).
- 🛡️ **Post-Quantum Zero-Knowledge E2EE**: NIST FIPS 203 **P256-MLKEM768** hybrid lattice cryptography + Hardware Passkeys (WebAuthn).
- 🚀 **Local-First Architecture**: Embedded in-browser WebAssembly SQLite + OPFS for instant 0ms log analytics and charting.
- 🛡️ **Granular Protection**: Wildcard filtering, Bloom filter accelerated blocklist subscriptions, custom overrides, and ECH fronting.

---

## 🖼️ Preview

| Analytics & Insights | Destinations Map |
|:---:|:---:|
| ![Analytics](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats.webp) | ![Destinations](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-stats_dest.webp) |

| Rules Configuration | Filter Subscriptions |
|:---:|:---:|
| ![Rules](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-rules.webp) | ![Filters](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-filter.webp) |

| Query Logs | Mobile Responsive |
|:---:|:---:|
| ![Query Logs](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-log.webp) | ![Mobile Stats](https://raw.githubusercontent.com/Obein/DNS-Worker/main/docs/screenshots/dns.obex-mobile_stats.webp) |

> 💡 For live demonstrations and endpoints setup, visit your Web Dashboard after launch or refer to the [Official Documentation](https://obein.github.io/DNS-Worker/).

---

## 💪 Motivation & Ecosystem

DNS Worker stands on the shoulders of modern open-source infrastructure and cryptography:

- **Compute & Runtime**: [Node.js](https://nodejs.org/) (native `node:sqlite`) & [Cloudflare Workers](https://workers.cloudflare.com/) + [D1 Database](https://developers.cloudflare.com/d1/)
- **User Interface**: [React](https://github.com/facebook/react), [Blueprint](https://github.com/palantir/blueprint) & [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
- **Documentation**: [Astro](https://astro.build/) & [Starlight](https://starlight.astro.build/) (lightning-fast, zero-JS static documentation)
- **Cryptography & Storage**: [NIST FIPS 203](https://csrc.nist.gov/pubs/fips/203/final) (ML-KEM-768) & [wa-sqlite](https://github.com/rhashimoto/wa-sqlite) (WASM + OPFS Local-First driver)

---

## 📄 License

Licensed under the [AGPL-3.0](LICENSE) License.

<div align="center">
  <br>
  <b>If DNS Worker helps you protect your DNS privacy, consider giving it a ⭐</b>
</div>
