---
title: Environment Variables Reference
description: Complete reference for configuration variables across Standalone and Cloudflare Workers modes.
---

Below is the complete reference of environment variables supported in `.env` (Standalone) and Cloudflare Workers.

## Network & Port Configuration

| Variable | Description | Default / Example |
|---|---|---|
| `SERVERFULL_HOST` | Network interface binding address | `0.0.0.0` |
| `SERVERFULL_UDP_PORT` | Classic UDP DNS listening port | `53` |
| `SERVERFULL_DOT_PORT` | DoT listening port | `853` |
| `SERVERFULL_HTTP_PORT` | HTTP Web Dashboard & DoH port | `10080` |
| `SERVERFULL_HTTPS_PORT` | HTTPS Web Dashboard & DoH port | `10443` |
| `SERVERFULL_DISABLE_HTTPS` | Disable HTTPS server | `false` |
| `SERVERFULL_DISABLE_UDP` | Disable UDP DNS server | `false` |
| `SERVERFULL_DISABLE_DOT` | Disable DoT server | `false` |

---

## TLS & Cryptography

| Variable | Description | Aliases |
|---|---|---|
| `SERVERFULL_TLS_CERT_PATH` | Path to TLS certificate chain PEM | `TLS_CERT_PATH`, `SSL_CERT_PATH`, `CERT_PATH` |
| `SERVERFULL_TLS_KEY_PATH` | Path to TLS private key PEM | `TLS_KEY_PATH`, `SSL_KEY_PATH`, `KEY_PATH` |
| `SERVERFULL_DOT_DOMAIN` | Base domain name (requires wildcard for DoT) | `DOT_DOMAIN`, `SERVERFULL_DOMAIN` |

---

## Authentication & System Paths

| Variable | Description | Default / Example |
|---|---|---|
| `JWT_SECRET` | Secret key for signing sessions and tokens | Auto-generated secure random string |
| `SERVERFULL_DB_PATH` | Path to SQLite database file | `/var/lib/dns-worker/dns_worker.sqlite` |
| `SERVERFULL_DEFAULT_PROFILE_KEY` | Default Profile token fallback | Auto-selected first profile |
| `KEK_v1` | Key Encryption Key for credential envelope encryption | Custom secret string |
