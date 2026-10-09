---
title: CLI Reference
description: Complete command and flag reference for the dns-worker CLI.
---

When installed globally via `npm install -g dns-worker`, access the following subcommands:

## Main Daemon

```bash
dns-worker [options]
```

Runs DNS Worker in the foreground. Command line flags override `.env` settings:
- `-s, --status`: Display service and database runtime status
- `-f, --force, -y, --yes`: Bypass interactive confirmation prompt for reset command
- `-p, --port, --http-port <number>`: HTTP port (default: 10080)
- `--https-port <number>`: HTTPS port (default: 10443)
- `--dns-port <number>`: Classic UDP port (default: 53)
- `--dot-port <number>`: DoT port (default: 853)
- `--dot-domain <domain>`: Base domain name
- `-u, --user <username>`: Service execution user

---

## Status & Diagnostics: `status`

```bash
dns-worker status
```

Inspects active listeners, port availability, TLS certificate validity, and SQLite database connectivity.

---

## Configuration Management: `config`

```bash
# Print active configuration and persistent paths
dns-worker config show

# Print absolute path of active .env file
dns-worker config path

# Scaffold clean .env template in standard directory
dns-worker config init

# Print raw default template
dns-worker config template
```

---

## Factory Reset: `reset`

```bash
# Interactive factory reset (prompts for secondary confirmation)
dns-worker reset

# Force reset without interactive confirmation (CI/automation)
dns-worker reset --force
# or
dns-worker reset -y
```

Restores the system to factory defaults:
- **Restores Configuration**: Overwrites `.env` with the factory default configuration template.
- **Wipes Database**: Permanently drops all tables and unlinks the SQLite database files (`*.sqlite`, `*-wal`, `*-shm`).
- **Reapplies Migrations**: Automatically runs all D1/SQLite schema migrations from scratch, producing a pristine empty database ready for first-time onboarding.
- **Two-Step Safety Confirmation**: In interactive mode, prompts the user with `Are you sure you want to proceed with factory reset? (yes/no): ` to prevent accidental data loss in production environments.

---

## Service Lifecycle: `service`

```bash
# Install system service (optional --user <username>)
sudo dns-worker service install [--user <username>]

# Control service execution
sudo dns-worker service start
sudo dns-worker service stop
sudo dns-worker service restart

# Enable / Disable autostart on system boot
sudo dns-worker service enable
sudo dns-worker service disable

# Live diagnostics & logs
sudo dns-worker service status
sudo dns-worker service logs

# Completely remove service
sudo dns-worker service uninstall
```
