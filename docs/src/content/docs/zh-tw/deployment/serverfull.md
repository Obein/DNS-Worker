---
title: 獨立伺服器 / VPS 部署指南
description: 詳細講解在 Linux / Windows 物理機或 VPS 上獨立部署 DNS Worker。
---

DNS Worker 可以完全脫離 Cloudflare Workers，直接在 Linux、Windows、macOS 伺服器或虛擬機器上以獨立服務模式執行。

## 系統要求
- **Node.js**：`>= 22.5.0`（推薦使用當前活躍的 LTS 版本，內建 `node:sqlite`）
- **記憶體**：最低 256MB，推薦 512MB 以上
- **埠要求**：
  - UDP 53（傳統 DNS，可選）
  - TCP 853（DoT，可選，需萬用字元證書）
  - TCP 10080（HTTP Web 面板 & DoH）
  - TCP 10443（HTTPS Web 面板 & DoH，可選，需證書）

---

## 配置檔案路徑規範

DNS Worker 在獨立執行時自動維護標準持久化儲存目錄：

- **Linux**：
  - 配置目錄：`/etc/dns-worker/`（配置檔案：`/etc/dns-worker/.env`）
  - 資料目錄：`/var/lib/dns-worker/`（SQLite 檔案：`/var/lib/dns-worker/dns_worker.sqlite`）
- **Windows**：
  - 配置與資料目錄：`%ProgramData%\DNS-Worker\`（如 `C:\ProgramData\DNS-Worker\.env`）

您可以使用 CLI 快速管理配置：
```bash
# 查看当前活跃的路径
dns-worker config show

# 生成标准默认 .env 模板
dns-worker config init
```

---

## 埠與網路配置

在 `.env` 中可自由指定監聽的埠和繫結地址：

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

## 後續步驟

- [配置 Linux systemd 後臺常駐服務](/DNS-Worker/deployment/service/)
- [配置 Let's Encrypt TLS 證書以開啟 HTTPS 與 DoT](/DNS-Worker/advanced/tls-certs/)
