---
title: Background Service Management
description: Manage background services with Linux systemd and Windows Scheduled Tasks.
---

DNS Worker includes built-in service lifecycle management to register, control, and autostart background daemons.

## Linux systemd Service

### 1. Installation & Registration

```bash
# Installs service running unprivileged as the invoking user (recommended)
sudo dns-worker service install

# Or explicitly designate a specific user (e.g. root)
sudo dns-worker service install --user root
```

:::tip[Security Architecture]
To follow the Principle of Least Privilege, the service runs as an unprivileged user by default, while Linux kernel capabilities (`CAP_NET_BIND_SERVICE`) permit binding privileged ports 53 and 853 without full root execution.
:::

### 2. Common Service Actions

```bash
# Check service status
sudo dns-worker service status

# Tail real-time service logs (journalctl)
sudo dns-worker service logs

# Restart service
sudo dns-worker service restart

# Enable autostart on system boot
sudo dns-worker service enable

# Disable autostart on system boot
sudo dns-worker service disable

# Stop service
sudo dns-worker service stop

# Completely remove service
sudo dns-worker service uninstall
```

---

## Windows Scheduled Tasks

Run PowerShell or Command Prompt as Administrator:

```powershell
# Install scheduled task with autostart on boot
dns-worker service install

# Check task status
dns-worker service status

# Start / Stop / Restart
dns-worker service start
dns-worker service stop
dns-worker service restart
```
