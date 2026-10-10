---
title: 独立服务器 / VPS 部署指南
description: 详细讲解在 Linux / Windows 物理机或 VPS 上独立部署 DNS Worker。
---

DNS Worker 可以完全脱离 Cloudflare Workers，直接在 Linux、Windows、macOS 服务器或虚拟机上以独立服务模式运行。

## 系统要求
- **运行时 (Node.js / Bun)**：
  - **Node.js**：`>= 22.5.0`（推荐首选，活跃 LTS 版本原生内建 `node:sqlite`）
  - **Bun**：`>= 1.4.0`（实验性支持，需具备 `node:sqlite` 兼容层）
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

## 使用 Caddy 或 Nginx 反向代理 HTTP（10080 端口）

在实际生产部署中，除了直接暴露 `10080` 端口或在 DNS Worker 内部配置证书监听 `10443`（HTTPS）外，**强烈推荐使用 Caddy 或 Nginx 等成熟的反向代理服务**置于 DNS Worker 前端。由反向代理统一监听标准 `443` 端口并处理自动化 SSL 证书申请与续期，随后将流量转发至内网 `http://127.0.0.1:10080`。

> [!TIP]
> 启用反向代理后，可在 `.env` 中设置 `SERVERFULL_DISABLE_HTTPS=true` 停用内置的 10443 HTTPS 监听器以节省资源，亦可设置 `SERVERFULL_HOST=127.0.0.1` 仅允许本地内网访问 10080 端口以提升安全性。

### 方案 1：Caddy 反向代理配置 (推荐首选)

Caddy 原生支持全自动申请和续期 Let's Encrypt / ZeroSSL 证书，配置极其简洁。编辑 `/etc/caddy/Caddyfile`：

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
> DNS Worker 会自动识别并解析反代请求中的 `CF-Connecting-IP`、`X-Real-IP` 以及 `X-Forwarded-For`（最左侧源 IP）。无论使用 Caddy 还是 Nginx，DNS 查询日志、活跃登录会话与安全审计记录均会准确记录客户端真实外网 IP，而非 `127.0.0.1`。

重载 Caddy 即可生效：
```bash
sudo systemctl reload caddy
```

### 方案 2：Nginx 反向代理配置

若您使用 Nginx，可在站点配置文件（如 `/etc/nginx/sites-available/dns-worker`）中添加以下配置：

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

测试并重载 Nginx：
```bash
sudo nginx -t && sudo systemctl reload nginx
```

> [!NOTE]
> **透传客户端真实 IP**：务必在反向代理中正确传递 `X-Real-IP` 和 `X-Forwarded-For` 请求头，确保 DNS Worker 在查询日志审计、地理位置解析及速率限制（Rate Limiting）中能够精准识别客户端真实 IP，而非反向代理的 `127.0.0.1`。

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
