---
title: 常見問題與排錯指引
description: 覆蓋許可權問題 (EACCES)、DoT 證書要求、401 會話過期等常見場景。
---

## 1. TLS 證書顯示 Permission denied (EACCES)

### 現象
後臺服務日誌中顯示：
`• DoT (TLS DNS) : Disabled (Files Inaccessible: Permission denied (EACCES))`

### 原因
後臺服務預設以普通使用者（非 root）降權執行，無法直接讀取 Certbot 生成在 `/etc/letsencrypt/` 下預設許可權為 `0600 (root:root)` 的私鑰。

### 解決方法
推薦使用系統 `ssl-cert` 使用者組授權（無需提升至 root，安全規範）：
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

## 2. DoT 顯示 Paused (Requires Wildcard Certificate *.domain)

### 現象
HTTPS Web 儀表盤能正常啟動，但 DoT 處於暫停狀態。

### 原因
DoT 需要基於 TLS SNI 識別並路由不同的配置 Profile（`<profileKey>.dns.example.com`）。單域名證書無法覆蓋子域名，因此必須使用萬用字元證書。

### 解決方法
使用 Certbot 通過 DNS 挑戰重新申請萬用字元證書：
```bash
certbot certonly -d *.your.domain -d your.domain --manual --preferred-challenges dns
```

---

## 3. 為什麼後臺服務修改了當前目錄的 .env 沒有生效？

### 現象
在個人目錄編輯了 `.env` 並重啟了服務，但服務顯示未配置。

### 原因
通過 `systemd` 託管的 Service 模式下，系統載入的環境變數檔案固定為 **/etc/dns-worker/.env**。請確保配置已寫入 `/etc/dns-worker/.env`。
