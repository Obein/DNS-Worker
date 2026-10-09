---
title: Quick Start
description: Launch and experience DNS Worker in less than 60 seconds.
---

DNS Worker provides a developer-friendly CLI that lets you get started immediately without setting up external database servers.

## Prerequisites
- **Node.js**: `>= 22.5.0` (Latest LTS recommended for native `node:sqlite`)
- **Operating System**: Linux, macOS, or Windows

---

## Method 1: Global Installation via npm (Recommended)

```bash
# 1. Install CLI globally
npm install -g dns-worker

# 2. Initialize persistent directory and default configuration
dns-worker config init

# 3. Start DNS Worker
dns-worker
```

Once started, access your management dashboard:
- **Web Dashboard**: `http://localhost:10080`
- **Classic UDP DNS**: `127.0.0.1:53`

---

## Method 2: Instant Run with npx

```bash
npx dns-worker
```

---

## Method 3: Run from Cloned Source Repository

```bash
# 1. Clone repository
git clone https://github.com/Obein/DNS-Worker.git
cd DNS-Worker

# 2. Install dependencies
npm install

# 3. Copy configuration template and launch
cp .env.serverfull .env
npm run start:serverfull
```

---

## Next Steps

- [Explore Architecture & Deployment Options](/DNS-Worker/deployment/matrix/)
- [Set up background daemon on Linux or Windows](/DNS-Worker/deployment/service/)
- [Configure Let's Encrypt TLS certificates for HTTPS & DoT](/DNS-Worker/advanced/tls-certs/)
