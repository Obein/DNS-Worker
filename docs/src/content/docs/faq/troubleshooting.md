---
title: Troubleshooting & FAQ
description: Common issues including Permission Denied (EACCES), DoT Wildcard certificates, and service environments.
---

## 1. TLS Certificate Inaccessible: Permission denied (EACCES)

### Symptom
Startup logs report:
`• DoT (TLS DNS) : Disabled (Files Inaccessible: Permission denied (EACCES))`

### Root Cause
The background service runs under an unprivileged user by default (Principle of Least Privilege), and cannot read Certbot's `0600 (root:root)` private key files under `/etc/letsencrypt/`.

### Solution
Use the standard `ssl-cert` group delegation without elevating the process to root:
```bash
sudo groupadd -f ssl-cert
sudo usermod -a -G ssl-cert <username>
sudo chgrp ssl-cert /etc/letsencrypt/live/<your-domain>/privkey.pem
sudo chmod 640 /etc/letsencrypt/live/<your-domain>/privkey.pem
sudo chgrp ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod 750 /etc/letsencrypt/live /etc/letsencrypt/archive
sudo dns-worker service restart
```

---

## 2. DoT Shows Paused (Requires Wildcard Certificate *.domain)

### Symptom
Web Dashboard works over HTTPS, but DoT is paused.

### Root Cause
DoT maps queries to user profiles via TLS Server Name Indication (`<profileToken>.dns.example.com`). A single-domain certificate cannot match subdomains, so a wildcard certificate is required.

### Solution
Register a wildcard certificate via Certbot with DNS challenge:
```bash
certbot certonly -d *.your.domain -d your.domain --manual --preferred-challenges dns
```

---

## 3. Why Are Changes to .env in Current Directory Ignored by Service?

### Symptom
Editing `.env` in your user directory has no effect after restarting the service.

### Root Cause
When managed by `systemd`, the daemon loads environment variables from `/etc/dns-worker/.env`. Ensure your changes are written to `/etc/dns-worker/.env`.
