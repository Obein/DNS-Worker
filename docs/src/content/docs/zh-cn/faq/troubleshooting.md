---
title: 常见问题与排错指引
description: 覆盖权限问题 (EACCES)、DoT 证书要求、401 会话过期等常见场景。
---

## 1. TLS 证书显示 Permission denied (EACCES)

### 现象
后台服务日志中显示：
`• DoT (TLS DNS) : Disabled (Files Inaccessible: Permission denied (EACCES))`

### 原因
后台服务默认以普通用户（非 root）降权运行，无法直接读取 Certbot 生成在 `/etc/letsencrypt/` 下默认权限为 `0600 (root:root)` 的私钥。

### 解决方法
推荐使用系统 `ssl-cert` 用户组授权（无需提升至 root，安全规范）：
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

## 2. DoT 显示 Paused (Requires Wildcard Certificate *.domain)

### 现象
HTTPS Web 仪表盘能正常启动，但 DoT 处于暂停状态。

### 原因
DoT 需要基于 TLS SNI 识别并路由不同的配置 Profile（`<profileKey>.dns.example.com`）。单域名证书无法覆盖子域名，因此必须使用通配符证书。

### 解决方法
使用 Certbot 通过 DNS 挑战重新申请通配符证书：
```bash
certbot certonly -d *.your.domain -d your.domain --manual --preferred-challenges dns
```

---

## 3. 为什么后台服务修改了当前目录的 .env 没有生效？

### 现象
在个人目录编辑了 `.env` 并重启了服务，但服务显示未配置。

### 原因
通过 `systemd` 托管的 Service 模式下，系统加载的环境变量文件固定为 **/etc/dns-worker/.env**。请确保配置已写入 `/etc/dns-worker/.env`。
