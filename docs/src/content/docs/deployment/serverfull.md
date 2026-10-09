---
title: Standalone Server / VPS Guide
description: Deploy and operate DNS Worker independently on Linux, macOS, or Windows servers.
---

DNS Worker can run completely independent of Cloudflare Workers on your own VPS, home server, or virtual machine.

## System Requirements
- **Node.js**: `>= 22.5.0` (Latest LTS recommended for built-in `node:sqlite`)
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
# Network interface binding (0.0.0.0 binds all interfaces)
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

## Next Steps

- [Configure systemd background daemon](/DNS-Worker/deployment/service/)
- [Configure Let's Encrypt certificates for HTTPS & DoT](/DNS-Worker/advanced/tls-certs/)
