---
title: 独立服务器 / VPS 部署指南
description: 详细讲解在 Linux / Windows 物理机或 VPS 上独立部署 DNS Worker。
---

DNS Worker 可以完全脱离 Cloudflare Workers，直接在 Linux、Windows、macOS 服务器或虚拟机上以独立服务模式运行。

## 系统要求
- **Node.js**：`>= 22.5.0`（推荐使用当前活跃的 LTS 版本，内建 `node:sqlite`）
- **内存**：最低 256MB，推荐 512MB 以上
- **端口要求**：
  - UDP 53（传统 DNS，可选）
  - TCP 853（DoT，可选，需通配符证书）
  - TCP 10080（HTTP Web 面板 & DoH）
  - TCP 10443（HTTPS Web 面板 & DoH，可选，需证书）

---

## 配置文件路径规范

DNS Worker 在独立运行时自动维护标准持久化存储目录：

- **Linux**：
  - 配置目录：`/etc/dns-worker/`（配置文件：`/etc/dns-worker/.env`）
  - 数据目录：`/var/lib/dns-worker/`（SQLite 文件：`/var/lib/dns-worker/dns_worker.sqlite`）
- **Windows**：
  - 配置与数据目录：`%ProgramData%\DNS-Worker\`（如 `C:\ProgramData\DNS-Worker\.env`）

您可以使用 CLI 快速管理配置：
```bash
# 查看当前活跃的路径
dns-worker config show

# 生成标准默认 .env 模板
dns-worker config init
```

---

## 端口与网络配置

在 `.env` 中可自由指定监听的端口和绑定地址：

```ini
# 绑定主机地址（默认 0.0.0.0 监听所有接口）
SERVERFULL_HOST=0.0.0.0

# 端口配置
SERVERFULL_UDP_PORT=53
SERVERFULL_DOT_PORT=853
SERVERFULL_HTTP_PORT=10080
SERVERFULL_HTTPS_PORT=10443

# 是否禁用特定服务
SERVERFULL_DISABLE_HTTPS=false
```

---

## 系统维护与出厂重置

若需要将系统完全重置为初始状态，可使用 `reset` 命令：

```bash
# 交互式重置（需要终端二次输入 yes 确认）
dns-worker reset

# 自动化/脚本强制重置（跳过确认）
dns-worker reset --force
```

该操作将会：
1. 将 `.env` 配置文件重置恢复为内置默认模板。
2. 彻底清空 SQLite 数据库，并从第 1 项迁移起重新初始化所有空数据表。

---

## 后续步骤

- [配置 Linux systemd 后台常驻服务](/DNS-Worker/deployment/service/)
- [配置 Let's Encrypt TLS 证书以开启 HTTPS 与 DoT](/DNS-Worker/advanced/tls-certs/)
