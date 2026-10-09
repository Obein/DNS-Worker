---
title: Cloudflare Workers Edge Deployment
description: Deploy serverless across 300+ edge locations with Cloudflare Workers and D1 database.
---

The Cloudflare Workers deployment allows you to run a globally distributed, high-availability DoH resolver with zero infrastructure management.

## Method 1: Git-Connected Automated Deployment (Recommended)

1. **Fork the Repository**: Click `Fork` at the top right of the GitHub repository to clone it to your account.
2. **Create D1 Database**:
   - In Cloudflare Dashboard, go to `Workers & Pages` > `D1`;
   - Create a database named `dns_worker_db` and copy the generated Database ID.
3. **Configure wrangler.toml**:
   - In your forked repository, edit `wrangler.toml`;
   - Replace `database_id` with your database ID.
4. **Deploy Application**:
   - Go to `Workers & Pages` > `Create application` > `Continue with GitHub`;
   - Connect your repository and configure build settings:
     - Build command: `npm run build`
     - Deploy command: `npm run deploy`
     - Output directory: `/`
5. **Set Secrets**:
   - After initial deployment, go to `Settings` > `Variables and secrets`;
   - Add `JWT_SECRET` (type: `Secret`, strong random string);
   - *(Optional)* Add `KEK_v1` (type: `Secret`) for server-side credential envelope encryption.

---

## Method 2: Local CLI Development & Deployment

```bash
# 1. Clone repository and install dependencies
npm install

# 2. Initialize and migrate local D1 database
npm run db:setup
npm run db:migrate:dev

# 3. Configure local development secrets (.dev.vars)
echo "JWT_SECRET=your_secure_random_jwt_secret" > .dev.vars
echo "KEK_v1=your_secure_kek_v1_secret" >> .dev.vars

# 4. Start local development server
npm run dev

# 5. Deploy to Cloudflare Workers
npm run deploy
```
