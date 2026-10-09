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

## Directory Standards

DNS Worker automatically manages standard persistent directories:

- **Linux**:
  - Configuration: `/etc/dns-worker/.env`
  - Database: `/var/lib/dns-worker/dns_worker.sqlite`
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

## Ports & Network Configuration

Customize listening ports in `/etc/dns-worker/.env`:

```ini
# Network interface binding (0.0.0.0 binds all interfaces, or 127.0.0.1 for local-only)
SERVERFULL_HOST=0.0.0.0

# Port configuration
SERVERFULL_UDP_PORT=53
SERVERFULL_DOT_PORT=853
SERVERFULL_HTTP_PORT=10080
SERVERFULL_HTTPS_PORT=10443

# Toggle specific listeners
SERVERFULL_DISABLE_HTTPS=false
```

---

## Reverse Proxying HTTP & DoH (Caddy / Nginx)

In production deployments, you can place a mature reverse proxy such as **Caddy** or **Nginx** in front of DNS Worker instead of exposing port `10080` (HTTP) directly or managing local certificates on port `10443` (HTTPS).

The reverse proxy terminates TLS on standard port `443` (with automated Let's Encrypt / ZeroSSL certificates) and forwards traffic to `http://127.0.0.1:10080`.

> [!TIP]
> When using a reverse proxy, set `SERVERFULL_DISABLE_HTTPS=true` in `.env` to disable the internal port 10443 listener and save system resources. You can also bind `SERVERFULL_HOST=127.0.0.1` so port `10080` is accessible strictly via localhost.

### Option 1: Caddy Configuration (Recommended)

Caddy provides zero-configuration automated HTTPS with automatic renewal. Add this to `/etc/caddy/Caddyfile`:

```nginx
dns.example.com {
    reverse_proxy 127.0.0.1:10080 {
        header_up Host {host}
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
    }
}
```

Reload Caddy:
```bash
sudo systemctl reload caddy
```

### Option 2: Nginx Configuration

If you use Nginx, add the following server block (e.g., `/etc/nginx/sites-available/dns-worker`):

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

    # DoH and Web Dashboard reverse proxy
    location / {
        proxy_pass http://127.0.0.1:10080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket support (for live dashboard updates)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

Reload Nginx:
```bash
sudo nginx -t && sudo systemctl reload nginx
```

> [!NOTE]
> **Client IP Forwarding**: Forwarding `X-Real-IP` and `X-Forwarded-For` is essential so that DNS Worker correctly records real client IPs, evaluates rate limits, and resolves geographic coordinates in query logs.

---

## Maintenance & Factory Reset

If you need to restore the system to its initial state, use the `reset` command:

```bash
# Interactive reset (requires secondary confirmation)
dns-worker reset

# Automated / non-interactive reset
dns-worker reset --force
```

This operation will:
1. Restore the `.env` configuration file to the built-in default template.
2. Completely clear the SQLite database and reapply all migrations from scratch.

---

## Next Steps

- [Configure systemd background daemon](/DNS-Worker/deployment/service/)
- [Configure Let's Encrypt certificates for HTTPS & DoT](/DNS-Worker/advanced/tls-certs/)

