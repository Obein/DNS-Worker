<div align="center">
  <img src="web/src/assets/obex_cat_eye_logo-256.webp" alt="DNS Worker Logo" width="128">
  <h1>DNS Worker</h1>
  <p>Protective DNS resolver based on Cloudflare Workers & D1</p>
  <p>Protect your first hop on the internet</p>
  <p align="center">
    English | <a href="README_zh-CN.md">简体中文</a> | <a href="README_zh-TW.md">正體中文</a>
  </p>

  [![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](LICENSE)
  [![Platform: Cloudflare Workers](https://img.shields.io/badge/Platform-Cloudflare%20Workers-orange.svg)](https://workers.cloudflare.com/)
</div>

---

## 📖 Introduction

**DNS Worker** is a lightweight, scalable, and privacy-focused DNS resolution system. It runs entirely on Cloudflare's edge network, leveraging the ultra-fast response of Workers and the efficient storage of D1 database to provide users with a granular DNS (over HTTPS) control experience.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker)

### Why DNS Worker?

| | Traditional DNS Services | DNS Worker |
|---|---|---|
| **Hosting** | Requires a VPS or home server | Runs on Cloudflare's free tier — no server needed |
| **Latency** | Depends on server location | Edge-computed in 300+ cities worldwide |
| **Maintenance** | Manual updates, OS patches | Zero-maintenance serverless deployment |
| **Scaling** | Limited by hardware | Scales automatically with Cloudflare's network |
| **Cost** | Server fees + electricity | Free for most personal usage |

> Deploy your own privacy-respecting DNS resolver in under 5 minutes — no credit card, no server, no DevOps.

### What is DNS over HTTPS (DoH)?

DoH (RFC 8484) is a protocol for performing DNS queries via encrypted HTTPS connections. Compared to traditional plaintext DNS, DoH can:
*   **Prevent Hijacking**: Prevents ISPs or third parties from tampering with DNS responses.
*   **Enhance Privacy**: Hides your browsing history through an encrypted tunnel.
*   **Bypass Censorship**: Provides more stable resolution in restricted network environments.

---

## ✨ Core Features

-   🚀 **Ultra-fast Resolution**: Fully based on edge computing with extremely low global latency.
-   🗒️ **Multi-profile Management**: Supports creating multiple independent configurations, each with a unique endpoint.
-   🛡️ **Granular Filtering**:
    -   **Allow/Block Lists**: Supports exact domain and subdomain wildcard matching.
    -   **Third-party Rule Sets**: Supports subscribing to external blocklists in formats like AdGuard.
    -   **Custom Redirection**: Supports custom overrides for A, AAAA, TXT, and CNAME records.
-   📊 **Real-time Stats & Logs**: Visual dashboard recording every request's hit reason, geo-location, and upstream latency.
-   🔐 **Privacy Enhancement**: Flexible ECS (EDNS Client Subnet) configuration (Forward, Custom, or Hidden).
-   🌗 **Modern UI**: Dark mode support, high-density management panel built with React + BlueprintJS.

---

## 🖼️ Quick Look

| User Login |
|:---:|
| ![Login](docs/screenshots/dns.obex-login.webp) |

| Setup Guide | Endpoints |
|:---:|:---:|
| ![Setup](docs/screenshots/dns.obex-setup.webp) | ![Endpoints](docs/screenshots/dns.obex-endpoints.webp) |

| Real-time Analytics | Request Destinations |
|:---:|:---:|
| ![Stats](docs/screenshots/dns.obex-stats.webp) | ![Destinations](docs/screenshots/dns.obex-stats_dest.webp) |

| Rule Management | External Filters |
|:---:|:---:|
| ![Rules](docs/screenshots/dns.obex-rules.webp) | ![Filters](docs/screenshots/dns.obex-filter.webp) |

| Resolution Logs | Log Detail |
|:---:|:---:|
| ![Resolution Logs](docs/screenshots/dns.obex-log.webp) | ![Log Detail](docs/screenshots/dns.obex-log_detail.webp) |

| Profile Settings | Profile Select |
|:---:|:---:|
| ![Settings](docs/screenshots/dns.obex-settings.webp) | ![Profile Select](docs/screenshots/dns.obex-profile_select.webp) |

| Mobile Logs | Mobile Stats |
|:---:|:---:|
| ![Mobile Logs](docs/screenshots/dns.obex-mobile_log.webp) | ![Mobile Stats](docs/screenshots/dns.obex-mobile_stats.webp) |

---

## 🛠️ Technical Architecture

### Code Structure
```text
├── src/
│   ├── index.ts          # Entry point, handles HTTP routing & middleware
│   ├── types.ts          # Type definitions
│   ├── api/              # API Controllers (Auth, Account, Profiles)
│   ├── lib/              # Core logic (RBAC, Rule filtering)
│   ├── models/           # D1 Database models
│   ├── pipeline/         # DNS Resolution Pipeline (Core business logic)
│   └── utils/            # Utilities (Cache, GeoIP, DNS Codec, Bloom Filter)
├── web/                  # React/BlueprintJS UI frontend project
│   ├── public/           # Public static files
│   ├── src/              # Frontend source code
│   │   ├── assets/       # Static assets (images, icons, etc.)
│   │   ├── components/   # Reusable UI components
│   │   ├── i18n/         # Internationalization (i18n) configuration
│   │   ├── layouts/      # Layout components (dashboard layout, etc.)
│   │   ├── routes/       # Frontend routing configuration
│   │   ├── services/     # Centralized API service wrappers (Auth, Account, Profiles, etc.)
│   │   ├── views/        # Main pages / views (dashboard, logs, settings, setup, etc.)
│   │   └── utils/        # Utility helpers and functions
│   └── package.json      # Frontend dependencies configuration
├── static/               # Compiled static resources
├── migrations/           # D1 Database migration scripts
└── wrangler.toml         # Cloudflare deployment configuration
```

### Resolution Pipeline
When a DNS request arrives, it goes through the following processing stages:
1.  **Memory Cache Check**: Checks if a valid response for the query exists in the edge node's memory.
2.  **Config Loading**: Layers profile settings loading from Memory -> Cache API -> D1 Database.
3.  **Local Rule Matching**:
    -   **Whitelist**: If hit, forwards directly to upstream and returns.
    -   **Redirection**: If hit, returns custom records.
    -   **Blacklist**: If hit, returns NXDOMAIN, 0.0.0.0, or a custom result.
4.  **External List Filtering**:
    -   Use a **Bloom filter** for fast filtering.
5.  **Upstream Resolution**: If none of the above hit, requests the upstream DoH server based on configuration, with optional ECS support.
6.  **Async Logging & Caching**: Asynchronously records resolution logs, fetches target GeoIP, and writes results to various cache levels.

---

## 🚀 Deployment Guide

### Development Environment
-   **Node.js**: v18.x or later
-   **Package Manager**: npm
-   **Cloudflare Account**: Workers and D1 permissions required

### Local Development
1.  Clone the repository and install dependencies:

```bash
npm install
```

2.  Initialize D1 Database:

```bash
npm run db:setup
npm run db:migrate:dev
```

3.  Configure environment variables:
    *   Create a `.dev.vars` file in the root directory and add a secure random JWT secret (required for session token signing):
        ```env
        JWT_SECRET=your_secure_random_string_here
        ```
    *   (Optional) Enable Envelope Encryption for sensitive credentials (like TOTP secrets and recovery keys) by adding a Key Encryption Key (KEK):
        ```env
        KEK_v1=your_secure_kek_v1_key_string
        ```

4.  Start the development server:

```bash
npm run dev
```

5.  Deploy online

```bash
npm run deploy
```

### Online Deployment (Cloudflare Dashboard)
1.  **Fork this repo**: Click the `Fork` button at the top right to clone the repository to your own GitHub account.
2.  **Create D1 Database**: Log in to the Cloudflare dashboard, go to `Workers & Pages` > `D1`, and create a new database (e.g., named `obex_db`), and copy the created database ID.
3.  **Configure Database ID**: In your forked repository, edit the `wrangler.toml` file and replace `database_id` with the ID of the database you just created.
4.  **Create Worker**: Go to Cloudflare dashboard `Workers & Pages` > `Create application` > `Create Worker`.
5.  **Import from GitHub**: On the deployment page, select `Deploy from GitHub`, connect your forked project, and complete the authorized deployment.
6.  **Configure JWT Secret**: Go to Cloudflare Dashboard -> `Workers & Pages` -> click on your Worker -> `Settings` -> `Variables` -> under `Environment Variables` click `Add Variable`. Set Name to `JWT_SECRET`, choose type `Secret`, input a secure random string as Value, and click `Save and Deploy`.
7.  **Configure KEK for Envelope Encryption (Optional)**: To enable server-side envelope encryption for sensitive credentials (such as TOTP keys and recovery keys) in D1, add a variable named `KEK_v1`, type `Secret`, and input a secure key value. When you need to rotate the KEK key, add a new secret `KEK_v(N+1)` (e.g. `KEK_v2` -> `KEK_v3`, etc.) sequentially.

### Online Deployment to Cloudflare Pages (⚠️ Not Recommended)

If you wish to deploy the project using Cloudflare Pages (Advanced Mode):

> [!WARNING]
> **Not Recommended**: This project is primarily a DNS resolution service, which is highly sensitive to response latency. Workers, as lightweight edge functions, are much better suited for low-latency DoH resolution tasks compared to Pages Functions. Standard Worker deployment also offers simpler routing and binding management. We strongly suggest deploying via Workers instead.

1.  **Create a D1 Database**, copy its ID, and paste it into the `database_id` field in `wrangler.toml`.
2.  In the Cloudflare Dashboard, go to `Workers & Pages` > `Create application` > `Pages` > `Connect to Git`.
3.  Select your forked repository, and configure the build settings:
    *   **Framework preset**: `None`
    *   **Build command**: `npm run build:pages`
    *   **Build output directory**: `static`
4.  After the initial deployment, go to the Pages project's **Settings** > **Functions** > **D1 database bindings**, and add a binding:
    *   **Variable name**: `DB`
    *   **D1 database**: Select your `obex_db` database.
5.  Redeploy the Pages project for the bindings to take effect.

---

## 💪 Powered by

* [Cloudflare Workers](https://workers.cloudflare.com/)
* [Blueprint](https://github.com/palantir/blueprint) (at Palantir)
* [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
* [React](https://github.com/facebook/react)

---

## 📄 License

This project is licensed under the [AGPLv3](LICENSE) License.

---

## 📝 Summary

DNS Worker gives you full control over your DNS resolution — with no servers to rent, no infrastructure to manage, and no compromises on privacy. By leveraging Cloudflare Workers' global edge network and D1 database, it delivers a production-ready Protective DNS service that is:

-   **Free to run** on Cloudflare's generous free tier
-   **Fast everywhere** thanks to 300+ edge locations worldwide
-   **Fully customizable** with per-profile rules, allowlists, blocklists, and third-party filter subscriptions
-   **Privacy-first** with encrypted DoH and flexible ECS controls
-   **Easy to deploy** in minutes via one-click deploy or a simple `npm run deploy`

Whether you're protecting a single device or managing DNS for your family, DNS Worker offers an elegant, self-hosted alternative to commercial DNS filtering services — without the cost or complexity.

<div align="center">
  <br>
  <a href="https://deploy.workers.cloudflare.com/?url=https://github.com/Obein/DNS-Worker">
    <img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare">
  </a>
  <br><br>
  <b>If DNS Worker is useful to you, please consider giving it a ⭐</b>
</div>
