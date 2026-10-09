---
title: TLS 證書配置與許可權安全最佳實踐
description: 配置 Let's Encrypt 證書、普通使用者許可權安全、ssl-cert 組授權與萬用字元要求。
---

啟用 HTTPS Web 控制台（埠 10443）與 DoT（埠 853）需要配置 TLS 證書。

## 環境變數配置

在 `/etc/dns-worker/.env` 中配置證書與私鑰路徑：

```ini
SERVERFULL_TLS_CERT_PATH=/etc/letsencrypt/live/example.com/fullchain.pem
SERVERFULL_TLS_KEY_PATH=/etc/letsencrypt/live/example.com/privkey.pem
SERVERFULL_DOT_DOMAIN=example.com
```

---

## 許可權安全問題與最佳實踐

### 為什麼會出現 Permission Denied (EACCES)？
Certbot 預設生成的私鑰檔案許可權為 `0600 (root:root)`，父目錄為 `0700`。
而 DNS Worker 的後臺守護程序預設以普通使用者（如 `hugo`）執行以降低安全風險，直接訪問會導致作業系統拒絕訪問。

:::caution[警惕安全隱患]
**絕不推薦將私鑰設定為全域性可讀（如 `chmod 644`）**！這樣會讓主機上的其他程序或指令碼都能竊取 TLS 私鑰。
:::

### 推薦方案 1：使用標準 `ssl-cert` 使用者組授權（最優雅）

Debian / Ubuntu 原生提供了專用的 `ssl-cert` 組，可在不提升至 root 的前提下安全授權私鑰：

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

### 推薦方案 2：專有目錄隔離 + Certbot Hook（強隔離性）

將證書部署到專用目錄 `/etc/dns-worker/certs/`，屬主直接設為該執行使用者並將許可權嚴格鎖定為 `0600`。並通過 Certbot 鉤子自動化同步：

```bash
sudo mkdir -p /etc/dns-worker/certs
sudo chown -R <username>:<username> /etc/dns-worker/certs
sudo chmod 700 /etc/dns-worker/certs

sudo cp /etc/letsencrypt/live/<domain>/fullchain.pem /etc/dns-worker/certs/
sudo cp /etc/letsencrypt/live/<domain>/privkey.pem /etc/dns-worker/certs/
sudo chown <username>:<username> /etc/dns-worker/certs/*
sudo chmod 600 /etc/dns-worker/certs/privkey.pem
```

### 備選方案 3：獨立單機 VPS 直接以 root 執行

如果該伺服器是專門執行 DNS Worker 的單機環境（無多使用者共享風險），可在安裝時直接以 root 執行：

```bash
sudo dns-worker service install --user root
```

---

## DoT 萬用字元證書要求

DoT 協議通過 TLS SNI 識別並路由不同的配置 Profile（格式為 `<profileKey>.dns.example.com`）。
- **必須配置萬用字元證書**（同時覆蓋 `*.your.domain` 和 `your.domain`）。
- 若配置單域名證書，HTTPS Web 面板正常工作，但 DoT 將處於暫停保護狀態（`Paused (Requires Wildcard Certificate *.domain)`）。

### Certbot DNS 挑戰申請萬用字元證書示例

```bash
certbot certonly -d *.your.domain -d your.domain --manual --preferred-challenges dns
```
