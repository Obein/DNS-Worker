---
title: TLS Certificates & Permissions Best Practices
description: Guidance on Let's Encrypt certificates, non-root permissions, ssl-cert group delegation, and wildcard DoT requirements.
---

Enabling the HTTPS Web Dashboard (port 10443) and DoT (port 853) requires valid TLS certificates.

## Environment Configuration

Specify certificate paths in `/etc/dns-worker/.env`:

```ini
SERVERFULL_TLS_CERT_PATH=/etc/letsencrypt/live/example.com/fullchain.pem
SERVERFULL_TLS_KEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem
SERVERFULL_DOT_DOMAIN=example.com
```

---

## Permission Security & Best Practices

### Why Does "Permission Denied (EACCES)" Occur?
Certbot generates private keys with `0600 (root:root)` and parent directories with `0700`.
Because DNS Worker's background service runs as an unprivileged user by default, file reads are denied by the kernel.

:::caution[Avoid Insecure Permissions]
**Never make private keys world-readable (`chmod 644`)**! Doing so exposes the private key to any compromised script or local user on the machine.
:::

### Best Practice 1: Group Delegation via `ssl-cert` (Recommended)

Debian / Ubuntu systems provide the standard `ssl-cert` group for securely granting read permissions without elevating the service to root:

```bash
# 1. Ensure the ssl-cert group exists
sudo groupadd -f ssl-cert

# 2. Add the service user to ssl-cert
sudo usermod -a -G ssl-cert <username>

# 3. Restrict private key group to ssl-cert with read-only access (0640)
sudo chgrp ssl-cert /etc/letsencrypt/live/<your-domain>/privkey.pem
sudo chmod 640 /etc/letsencrypt/live/<your-domain>/privkey.pem

# 4. Grant traversal permission on parent directories (0750)
sudo chgrp ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod 750 /etc/letsencrypt/live /etc/letsencrypt/archive

# 5. Restart service
sudo dns-worker service restart
```

### Option 2: Dedicated Certificate Directory + Renewal Hook

Copy renewed certificates into `/etc/dns-worker/certs/`, assign ownership to the service user, and lock private key permissions strictly to `0600`. Automate renewal synchronization via Certbot's `renewal-hooks/deploy/` directory.

### Option 3: Dedicated Standalone VPS Running as `root`

For single-purpose machines dedicated exclusively to DNS Worker with no multi-user sharing, installing as root is directly supported:

```bash
sudo dns-worker service install --user root
```

---

## Wildcard Certificate Requirement for DoT

DoT routes queries to specific profiles via TLS Server Name Indication (`<profileKey>.dns.example.com`).
- A **wildcard certificate covering both `*.your.domain` and `your.domain` is strictly required**.
- With a single-domain certificate, HTTPS Web Dashboard will operate normally, while DoT will remain safely paused (`Paused (Requires Wildcard Certificate *.domain)`).

### Obtain Wildcard Certificate via Certbot DNS Challenge

```bash
certbot certonly -d *.your.domain -d your.domain --manual --preferred-challenges dns
```
