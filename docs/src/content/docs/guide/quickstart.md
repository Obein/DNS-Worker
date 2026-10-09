---
title: Quick Start
description: Launch and experience DNS Worker in less than 60 seconds.
---

DNS Worker offers two deployment paths tailored to your needs. As a **Serverless-First** platform, deploying to Cloudflare Workers is the primary, recommended approach for zero-maintenance global edge resolution.

---

## Method 1: Deploy to Cloudflare Workers (Serverless - Recommended)

Deploy across 300+ edge locations worldwide with automatic global failover and zero server patching.

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Obein/DNS-Worker.git
cd DNS-Worker
npm install
```

### 2. Create Cloudflare D1 Database
```bash
# Log in to Cloudflare via Wrangler CLI
npx wrangler login

# Create D1 database for DNS Worker
npm run db:setup
```
Copy the output `database_id` into `wrangler.toml` under `[[d1_databases]]`:
```toml
[[d1_databases]]
binding = "DB"
database_name = "dns_worker_db"
database_id = "your-database-id-here"
```

### 3. Initialize Database Schema & Deploy
```bash
# 1. Apply database migrations to production D1
npm run db:migrate:prod

# 2. Build Web Dashboard and deploy Worker
npm run deploy
```

Once deployed, your secure DNS resolution endpoint and Web Dashboard are live immediately at `https://<your-worker>.workers.dev` (or your custom apex domain).

---

## Method 2: Standalone Server / VPS (Serverfull - Self-Hosted Alternative)

If you require raw UDP port 53 for local home routers or dedicated Android Private DNS on port 853:

```bash
# 1. Install CLI globally
npm install -g dns-worker

# 2. Initialize persistent directory and default configuration
dns-worker config init

# 3. Start DNS Worker daemon
dns-worker
```

Access the local management dashboard at `http://localhost:10080` and UDP DNS at `127.0.0.1:53`.

---

## Next Steps

- [Explore Architecture & Deployment Matrix](/DNS-Worker/deployment/matrix/)
- [Cloudflare Workers Edge Deployment Guide](/DNS-Worker/deployment/cloudflare/)
- [Create Profiles & Configure Client Devices](/DNS-Worker/networking/endpoints/)
- [Configure Let's Encrypt TLS Certificates](/DNS-Worker/advanced/tls-certs/)
