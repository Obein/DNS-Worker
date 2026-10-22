---
title: 獨立伺服器 / VPS 部署指南
description: 詳細講解在 Linux / Windows 物理機或 VPS 上獨立部署 DNS Worker。
---

DNS Worker 可以完全脫離 Cloudflare Workers，直接在 Linux、Windows、macOS 伺服器或虛擬機器上以獨立服務模式執行。

## 系統要求
- **執行時 (Node.js / Bun)**：
  - **Node.js**：`>= 22.5.0`（推薦首選，活躍 LTS 版本原生內建 `node:sqlite`）
  - **Bun**：`>= 1.4.0`（實驗性支援，需具備 `node:sqlite` 相容層）
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

## 容器化部署 (Docker / Bun LTS 執行時)

DNS Worker 提供官方容器映象構建流程，基於 **Bun LTS** (`oven/bun:1-slim`) 最小化執行基底，具備極低記憶體佔用與毫秒級冷啟動特性。

### Docker 極速執行

以後臺分離模式執行容器，直接對映 443 埠並掛載持久化資料、配置與 TLS 證書卷：

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
> **HTTPS 自動重定向**：生產環境中不建議直接通過純 HTTP 埠訪問。當在 `/etc/ssl/dns-worker` 掛載 TLS 證書（或配置 `SERVERFULL_TLS_CERT_PATH`）後，DNS Worker 將自動啟用 443 埠的 HTTPS 服務，並且 **所有訪問 80 埠的純 HTTP 請求將自動 301/307 跳轉至 HTTPS**。

### 埠與資料卷對映規範

- **網路埠**：
  - `53:53/udp`：經典 UDP DNS（RFC 1035）
  - `853:853/tcp`：加密 DoT（RFC 7858，相容 DoQ）
  - `80:80/tcp`：HTTP Web 控制台（配置證書後自動跳轉至 HTTPS 443）
  - `443:443/tcp`：HTTPS Web 控制台與 DoH 解析介面（主要/推薦訪問方式）
- **持久化資料卷**：
  - `/var/lib/dns-worker`：儲存 SQLite 資料庫檔案（`dns_worker.sqlite`）與自動持久化的 JWT 金鑰
  - `/etc/dns-worker`：掛載宿主機目錄以提供自定義 `.env` 配置檔案
  - `/etc/ssl/dns-worker`：掛載 TLS 證書鏈與私鑰（`fullchain.pem` 與 `privkey.pem`），系統啟動時自動識別並激活 HTTPS / DoT

### 打包與釋出至 Docker Hub

映象在推送 Git 發版標籤（`v*`）時會自動通過 GitHub Actions 構建併發布至 Docker Hub，亦可在本地通過指令碼手動構建釋出：

```bash
# 本地构建镜像（自动读取 package.json 版本并打标签）
npm run docker:build

# 多架构打包（linux/amd64, linux/arm64）并发布至 Docker Hub
npm run docker:multiarch -- --push

# 推送本地标签至 Docker Hub
npm run docker:push
```

---

## 埠與網路配置

在 `.env` 中可自由指定監聽的埠和繫結地址：

```ini
# 绑定主机地址（默认 0.0.0.0 监听所有接口，或设为 127.0.0.1 仅限本地访问）
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

## 使用 Caddy 或 Nginx 反向代理 HTTP（10080 埠）

在實際生產部署中，除了直接暴露 `10080` 埠或在 DNS Worker 內部配置證書監聽 `10443`（HTTPS）外，**強烈推薦使用 Caddy 或 Nginx 等成熟的反向代理服務**置於 DNS Worker 前端。由反向代理統一監聽標準 `443` 埠並處理自動化 SSL 證書申請與續期，隨後將流量轉發至內網 `http://127.0.0.1:10080`。

> [!TIP]
> 啟用反向代理後，可在 `.env` 中設定 `SERVERFULL_DISABLE_HTTPS=true` 停用內建的 10443 HTTPS 監聽器以節省資源，亦可設定 `SERVERFULL_HOST=127.0.0.1` 僅允許本地內網訪問 10080 埠以提升安全性。

### 方案 1：Caddy 反向代理配置 (推薦首選)

Caddy 原生支援全自動申請和續期 Let's Encrypt / ZeroSSL 證書，配置極其簡潔。編輯 `/etc/caddy/Caddyfile`：

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
> DNS Worker 會自動識別並解析反代請求中的 `CF-Connecting-IP`、`X-Real-IP` 以及 `X-Forwarded-For`（最左側源 IP）。無論使用 Caddy 還是 Nginx，DNS 查詢日誌、活躍登入會話與安全審計記錄均會準確記錄客戶端真實外網 IP，而非 `127.0.0.1`。

過載 Caddy 即可生效：
```bash
sudo systemctl reload caddy
```

### 方案 2：Nginx 反向代理配置

若您使用 Nginx，可在站點配置檔案（如 `/etc/nginx/sites-available/dns-worker`）中新增以下配置：

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

    # DoH 与 Web 控制面板反向代理
    location / {
        proxy_pass http://127.0.0.1:10080;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持（管理面板实时通信）
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

測試並重載 Nginx：
```bash
sudo nginx -t && sudo systemctl reload nginx
```

> [!NOTE]
> **透傳客戶端真實 IP**：務必在反向代理中正確傳遞 `X-Real-IP` 和 `X-Forwarded-For` 請求頭，確保 DNS Worker 在查詢日誌審計、地理位置解析及速率限制（Rate Limiting）中能夠精準識別客戶端真實 IP，而非反向代理的 `127.0.0.1`。

---

## 系統維護與出廠重置

若需要將系統完全重置為初始狀態，可使用 `reset` 命令：

```bash
# 交互式重置（需要终端二次输入 yes 确认）
dns-worker reset

# 自动化/脚本强制重置（跳过确认）
dns-worker reset --force
```

該操作將會：
1. 將 `.env` 配置檔案重置恢復為內建預設模板。
2. 徹底清空 SQLite 資料庫，並從第 1 項遷移起重新初始化所有空資料表。

---

## 後續步驟

- [配置 Linux systemd 後臺常駐服務](/DNS-Worker/deployment/service/)
- [配置 Let's Encrypt TLS 證書以開啟 HTTPS 與 DoT](/DNS-Worker/advanced/tls-certs/)
