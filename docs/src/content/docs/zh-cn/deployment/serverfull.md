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

## CLI 模式 (NPM，推荐)

独立运行 DNS Worker，该模式直接运行在宿主机操作系统上，不仅具备最佳的 I/O 吞吐性能与极低内存开销，而且自带跨平台系统服务管理器，可一键完成守护进程注册、开机自启与配置管理。

### 1. 全局安装与快速启动

通过 npm 进行全局安装并启动：

```bash
# 全局安装 CLI
npm install -g dns-worker

# 生成标准默认 .env 配置文件模板
dns-worker config init

# 启动服务
dns-worker
```

或者无需全局安装，直接通过 `npx` 极速试用运行：

```bash
npx dns-worker
```

启动成功后，通过浏览器访问 `http://localhost:10080`（或服务器 IP:10080）即可进入 Web 控制台进行初始化配置。

### 2. 常用管理命令

DNS Worker CLI 内置了完善的运维管理指令：

```bash
# 查看服务运行时状态与数据库健康度
dns-worker status

# 查看或初始化配置文件路径
dns-worker config show
dns-worker config init

# 查看当前活跃的 ECH 密钥配置与外层 SNI 域名
dns-worker ech

# 恢复默认 .env 配置并清空数据库（出厂重置）
dns-worker reset
```

### 3. 一键注册为常驻后台服务

为保证服务器开机自启并在崩溃时自动拉起重启，可一键注册为系统后台常驻服务：

- **Linux (systemd)**：
  ```bash
  # 一键安装为 systemd 守护进程
  sudo dns-worker service install

  # 启动并查看状态
  sudo dns-worker service start
  sudo dns-worker service status
  ```
- **Windows (计划任务)**：
  ```powershell
  # 以管理员身份安装计划任务服务
  dns-worker service install
  dns-worker service status
  ```

更多服务管理命令详见 [常驻后台服务管理](/DNS-Worker/zh-cn/deployment/service/)。

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

## 容器化部署 (Docker，Beta)

DNS Worker 提供官方容器镜像构建流程，基于 **Bun LTS** (`oven/bun:1-slim`) 最小化运行基底，具备极低内存占用与毫秒级冷启动特性。

### Docker 极速运行

以后台分离模式运行容器，直接映射 443 端口并挂载持久化数据、配置与 TLS 证书卷：

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
> **HTTPS 自动重定向**：生产环境中不建议直接通过纯 HTTP 端口访问。当在 `/etc/ssl/dns-worker` 挂载 TLS 证书（或配置 `SERVERFULL_TLS_CERT_PATH`）后，DNS Worker 将自动启用 443 端口的 HTTPS 服务，并且 **所有访问 80 端口的纯 HTTP 请求将自动 301/307 跳转至 HTTPS**。

### 端口与数据卷映射规范

- **网络端口**：
  - `53:53/udp`：经典 UDP DNS（RFC 1035）
  - `853:853/tcp`：加密 DoT（RFC 7858，兼容 DoQ）
  - `80:80/tcp`：HTTP Web 控制台（配置证书后自动跳转至 HTTPS 443）
  - `443:443/tcp`：HTTPS Web 控制台与 DoH 解析接口（主要/推荐访问方式）
- **持久化数据卷**：
  - `/var/lib/dns-worker`：存储 SQLite 数据库文件（`dns_worker.sqlite`）与自动持久化的 JWT 密钥
  - `/etc/dns-worker`：挂载宿主机目录以提供自定义 `.env` 配置文件
  - `/etc/ssl/dns-worker`：挂载 TLS 证书链与私钥（`fullchain.pem` 与 `privkey.pem`），系统启动时自动识别并激活 HTTPS / DoT

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

- [配置 Linux systemd 后台常驻服务](/DNS-Worker/zh-cn/deployment/service/)
- [配置 Let's Encrypt TLS 证书以开启 HTTPS 与 DoT](/DNS-Worker/zh-cn/advanced/tls-certs/)
