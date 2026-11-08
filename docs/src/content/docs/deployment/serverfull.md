---
title: Standalone Server / VPS Guide
description: Deploy and operate DNS Worker independently on Linux, macOS, or Windows servers.
---

DNS Worker can run completely independent of Cloudflare Workers on your own VPS, home server, or virtual machine.

## System Requirements
- **Runtime (Node.js / Bun)**:
  - **Node.js**: `>= 22.5.0` (Recommended, LTS with built-in `node:sqlite`)
  - **Bun**: `>= 1.4.0` (Supported with built-in `node:sqlite` compatibility layer)
- **Memory**: Minimum 256MB RAM (512MB+ recommended)
- **Network Ports**:
  - UDP 53 (Classic DNS, optional)
  - TCP 853 (DoT, optional, requires wildcard certificate)
  - TCP 10080 (HTTP Web Dashboard & DoH)
  - TCP 10443 (HTTPS Web Dashboard & DoH, optional, requires certificate)

---

## Quick Start via CLI (NPM, Recommended)

Running DNS Worker via the NPM for physical servers, VPS instances, and local workstations. It runs directly on the host OS for optimal I/O throughput and minimal memory footprint, and includes a built-in cross-platform daemon service manager.

### 1. Global Installation & Launch

Install globally via npm and start immediately:

```bash
# Install CLI globally
npm install -g dns-worker

# Initialize standard default .env configuration file
dns-worker config init

# Start the resolver daemon
dns-worker
```

Or run on-demand with zero permanent installation via `npx`:

```bash
npx dns-worker
```

Once running, navigate to `http://localhost:10080` (or `http://<your-server-ip>:10080`) in your web browser to access the Web Dashboard and complete initial setup.

### 2. Common CLI Commands

The DNS Worker CLI includes integrated tools for configuration, health inspection, and maintenance:

```bash
# View active service and database runtime status
dns-worker status

# View or inspect active configuration file paths
dns-worker config show
dns-worker config init

# Inspect active ECH cryptographic configuration and outer SNI
dns-worker ech

# Restore default .env configuration and wipe database (factory reset)
dns-worker reset
```

### 3. One-Click Background Service Setup

To keep DNS Worker running in the background across system reboots with automatic crash recovery, register it as a system daemon:

- **Linux (systemd)**:
  ```bash
  # Install as a systemd service
  sudo dns-worker service install

  # Start and check service status
  sudo dns-worker service start
  sudo dns-worker service status
  ```
- **Windows (Scheduled Task)**:
  ```powershell
  # Install as an Administrator scheduled task service
  dns-worker service install
  dns-worker service status
  ```

For more service management options, see [Background Service Management](/DNS-Worker/deployment/service/).

---

## Directory Standards

DNS Worker automatically manages standard persistent directories:

- **Linux**:
  - Configuration: `/etc/dns-worker/` (config file: `/etc/dns-worker/.env`)
  - Database: `/var/lib/dns-worker/` (SQLite file: `/var/lib/dns-worker/dns_worker.sqlite`)
- **Windows**:
  - Configuration & Data: `%ProgramData%\DNS-Worker\` (e.g. `C:\ProgramData\DNS-Worker\.env`)

Manage configuration effortlessly with the CLI:
```bash
# View active configuration paths
dns-worker config show

# Initialize clean standard .env file
dns-worker config init
```

---

## Docker Deployment (Beta)

DNS Worker provides an official containerized workflow powered by **Bun LTS** (`oven/bun:1-slim`) for minimal memory footprint and instant startup.

### Quick Run with Docker

Run the container in detached mode with persistent volumes for database, configuration, and TLS certificates:

```bash
docker run -d \
  --name dns-worker \
  --restart unless-stopped \
  -p 53:53/udp \
  -p 853:853/tcp \
  -p 80:80/tcp \
  -p 443:443/tcp \
  -v dns_worker_data:/var/lib/dns-worker \
  -v dns_worker_config:/etc/dns-worker \
  -v /etc/letsencrypt:/etc/ssl/dns-worker:ro \
  hugokoo/dns-worker:latest
```

> [!TIP]
> **HTTPS Auto-Redirection**: Direct use of plain HTTP is not recommended in production. When TLS certificates are mounted to `/etc/ssl/dns-worker` (or configured via `SERVERFULL_TLS_CERT_PATH`), DNS Worker activates HTTPS on port 443, and all plain HTTP requests arriving on port 80 will **automatically redirect to HTTPS (HTTP 301/307)**.

### Docker Volume & Port Reference

- **Ports**:
  - `53:53/udp`: Classic UDP DNS (RFC 1035)
  - `853:853/tcp`: DNS over TLS (DoT, RFC 7858, DoQ compatible)
  - `80:80/tcp`: HTTP Web Dashboard (Auto-redirects to HTTPS 443)
  - `443:443/tcp`: HTTPS Web Dashboard & DoH (Primary / Recommended)
- **Volumes**:
  - `/var/lib/dns-worker`: Holds persistent SQLite database (`dns_worker.sqlite`) and auto-generated JWT secrets.
  - `/etc/dns-worker`: Mount host directory to provide custom `.env` configuration file.
  - `/etc/ssl/dns-worker`: Mount host TLS certificates (`fullchain.pem` and `privkey.pem`) for automatic discovery and HTTPS activation.

---

## Ports & Network Configuration

Customize listening ports in `/etc/dns-worker/.env`:

```ini
# Bind host address (0.0.0.0 for all interfaces, 127.0.0.1 for local loopback only)
SERVERFULL_HOST=0.0.0.0

# Port configuration
SERVERFULL_UDP_PORT=53
SERVERFULL_DOT_PORT=853
SERVERFULL_HTTP_PORT=10080
SERVERFULL_HTTPS_PORT=10443

# Disable specific services if desired
SERVERFULL_DISABLE_HTTPS=false
```

---

## Reverse Proxy with Caddy or Nginx (Port 10080)

In production setups, in addition to binding port `10080` directly or using built-in HTTPS on port `10443`, **we strongly recommend placing a modern reverse proxy like Caddy or Nginx in front of DNS Worker**. The reverse proxy handles automated SSL certificate issuance and renewal on standard port `443` while forwarding requests to `http://127.0.0.1:10080`.

> [!TIP]
> When using a reverse proxy, set `SERVERFULL_DISABLE_HTTPS=true` to save resources, and optionally set `SERVERFULL_HOST=127.0.0.1` to restrict access strictly to the local loopback.

### Option 1: Caddy Reverse Proxy (Recommended)

Caddy natively provisions and renews Let's Encrypt / ZeroSSL certificates automatically, enabling preferred HTTP/3 (QUIC) on UDP port 443 by default while maintaining seamless HTTP/2 compatibility. Edit `/etc/caddy/Caddyfile`:

```caddy
dns.example.com {
    reverse_proxy 127.0.0.1:10080 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        header_up CF-Connecting-IP {remote_host}
    }
}
```

> [!NOTE]
> DNS Worker automatically recognizes and parses `CF-Connecting-IP`, `X-Real-IP`, and `X-Forwarded-For` headers. Your query logs, active sessions, and security audits will accurately record the client's genuine public IP instead of `127.0.0.1`.

Reload Caddy to apply:
```bash
sudo systemctl reload caddy
```

### Option 2: Nginx Reverse Proxy

For Nginx, add the following server block to your site configuration (e.g. `/etc/nginx/sites-available/dns-worker`):

```nginx
server {
    listen 80;
    server_name dns.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name dns.example.com;

    ssl_certificate /etc/letsencrypt/live/dns.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/dns.example.com/privkey.pem;

    # DoH & Web Dashboard proxy
    location / {
        proxy_pass http://127.0.0.1:10080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support for real-time dashboard updates
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Test and reload Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Maintenance & Factory Reset

To restore the system to its initial pristine state, use the `reset` command:

```bash
# Interactive reset (prompts for confirmation)
dns-worker reset

# Automated non-interactive reset (force)
dns-worker reset --force
```

This operation will:
1. Revert `/etc/dns-worker/.env` to the default configuration template.
2. Clear the SQLite database and re-apply all migrations from scratch.

---

## Next Steps

- [Configure Linux systemd Background Service](/DNS-Worker/deployment/service/)
- [Configure Let's Encrypt TLS Certificates for HTTPS & DoT](/DNS-Worker/advanced/tls-certs/)
