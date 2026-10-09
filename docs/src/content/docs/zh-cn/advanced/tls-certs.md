---
title: TLS 证书配置与权限安全最佳实践
description: 配置 Let's Encrypt 证书、普通用户权限安全、ssl-cert 组授权与通配符要求。
---

启用 HTTPS Web 控制台（端口 10443）与 DoT（端口 853）需要配置 TLS 证书。

## 环境变量配置

在 `/etc/dns-worker/.env` 中配置证书与私钥路径：

```ini
SERVERFULL_TLS_CERT_PATH=/etc/letsencrypt/live/example.com/fullchain.pem
SERVERFULL_TLS_KEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem
SERVERFULL_DOT_DOMAIN=example.com
```

---

## 权限安全问题与最佳实践

### 为什么会出现 Permission Denied (EACCES)？
Certbot 默认生成的私钥文件权限为 `0600 (root:root)`，父目录为 `0700`。
而 DNS Worker 的后台守护进程默认以普通用户（如 `hugo`）运行以降低安全风险，直接访问会导致操作系统拒绝访问。

:::caution[警惕安全隐患]
**绝不推荐将私钥设置为全局可读（如 `chmod 644`）**！这样会让主机上的其他进程或脚本都能窃取 TLS 私钥。
:::

### 推荐方案 1：使用标准 `ssl-cert` 用户组授权（最优雅）

Debian / Ubuntu 原生提供了专用的 `ssl-cert` 组，可在不提升至 root 的前提下安全授权私钥：

```bash
# 1. 确保系统存在 ssl-cert 用户组
sudo groupadd -f ssl-cert

# 2. 将运行服务的普通用户加入该组
sudo usermod -a -G ssl-cert <username>

# 3. 将证书私钥属组设为 ssl-cert，并严格限制为组只读 (0640)
sudo chgrp ssl-cert /etc/letsencrypt/live/<your-domain>/privkey.pem
sudo chmod 640 /etc/letsencrypt/live/<your-domain>/privkey.pem

# 4. 允许 ssl-cert 组进入 live 和 archive 目录检索
sudo chgrp ssl-cert /etc/letsencrypt/live /etc/letsencrypt/archive
sudo chmod 750 /etc/letsencrypt/live /etc/letsencrypt/archive

# 5. 重启服务生效
sudo dns-worker service restart
```

### 推荐方案 2：专有目录隔离 + Certbot Hook（强隔离性）

将证书部署到专用目录 `/etc/dns-worker/certs/`，属主直接设为该运行用户并将权限严格锁定为 `0600`。并通过 Certbot 钩子自动化同步：

```bash
sudo mkdir -p /etc/dns-worker/certs
sudo chown -R <username>:<username> /etc/dns-worker/certs
sudo chmod 700 /etc/dns-worker/certs

sudo cp /etc/letsencrypt/live/<domain>/fullchain.pem /etc/dns-worker/certs/
sudo cp /etc/letsencrypt/live/<domain>/privkey.pem /etc/dns-worker/certs/
sudo chown <username>:<username> /etc/dns-worker/certs/*
sudo chmod 600 /etc/dns-worker/certs/privkey.pem
```

### 备选方案 3：独立单机 VPS 直接以 root 运行

如果该服务器是专门运行 DNS Worker 的单机环境（无多用户共享风险），可在安装时直接以 root 运行：

```bash
sudo dns-worker service install --user root
```

---

## DoT 通配符证书要求

DoT 协议通过 TLS SNI 识别并路由不同的配置 Profile（格式为 `<profileKey>.dns.example.com`）。
- **必须配置通配符证书**（同时覆盖 `*.your.domain` 和 `your.domain`）。
- 若配置单域名证书，HTTPS Web 面板正常工作，但 DoT 将处于暂停保护状态（`Paused (Requires Wildcard Certificate *.domain)`）。

### Certbot DNS 挑战申请通配符证书示例

```bash
certbot certonly -d *.your.domain -d your.domain --manual --preferred-challenges dns
```
