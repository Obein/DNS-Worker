---
title: 接入點配置與客戶端設定
description: DNS Worker 接入點（Profile）建立管理、連線協議矩陣及多平臺客戶端配置完整指南。
sidebar:
  order: 1
---

在 DNS Worker 中，**接入點**（也稱 **Profile** 或配置策略）是一個相互隔離的安全策略域。每個接入點擁有獨立的路由金鑰、自定義過濾規則、上游解析器以及查詢日誌留存時長。

通過配置不同的接入點，您可以輕鬆實現精細化分流管理——例如為手機配置強力去廣告策略，為兒童平板開啟安全搜尋保護，同時為開發伺服器保留無攔截直連通道。

---

## 1. Web 面板中建立與管理接入點

![接入點管理面板](/DNS-Worker/screenshots/dns.obex-endpoints.webp)

### 步驟 1：訪問管理面板
1. 開啟 DNS Worker Web 控制面板（例如 `https://dns.example.com` 或 `http://<server-ip>:10080`）。
2. 使用管理員憑據登入系統。
3. 在左側導航欄中，點選 **Profiles**（接入點管理）。

### 步驟 2：新建接入點
1. 點選右上角 **+ New Profile**（新建接入點）按鈕。
2. 輸入接入點名稱（例如 `Phone-Mobile`、`Living-Room-Router`、`Kids-Tablet`）。
3. 點選 **Create Profile**（建立接入點）。

```
┌────────────────────────────────────────────────────────┐
│ 接入点名称: Phone-Mobile                                 │
│ 路由密钥: a8f9c2d14e...                                │
│ 状态: 激活 (Active)                                     │
│ 拦截响应: Zero IP (0.0.0.0 / ::)                        │
│ 日志策略: 启用 (保留 30 天)                             │
└────────────────────────────────────────────────────────┘
```

### 步驟 3：多接入點快速切換

在 Web 控制面板的任意頁面，都可以通過頂部或左側的下拉選單極速切換當前檢視與操作的接入點：

![多接入點快速切換](/DNS-Worker/screenshots/dns.obex-profile_select.webp)

### 步驟 4：檢視接入點金鑰
系統會自動為每個新建接入點生成唯一的加密 **Profile Key**（如 `a8f9c2d14e...`）。該金鑰在 DoH 請求路徑與 DoT SNI 握手過程中作為精確路由標識。

---

## 2. 協議支援與接入 URL 矩陣

DNS Worker 支援所有主流現代加密 DNS 協議以及傳統 UDP DNS。

| 協議 | 接入點地址格式 | 適用場景 |
| :--- | :--- | :--- |
| **DoH (DNS over HTTPS)** | `https://<domain>/dns-query/<profileKey>` | 瀏覽器、Windows 11、iOS/macOS 描述檔案、curl |
| **DoT (DNS over TLS)** | `tls://<profileKey>.<dotDomain>:853` | Linux `systemd-resolved`、Stubby、Android 原生私有 DNS |
| **Android 私有 DNS** | `<profileKey>.<dotDomain>` | Android 9+ 系統自帶私有 DNS |
| **傳統 UDP (Do53)** | `udp://<server-ip>:53` | 傳統路由器、IoT 物聯網裝置、區域網測試 |

> [!NOTE]
> 在 Serverfull 模式下，DoT 接入點路由依賴 **TLS 伺服器名稱指示 (SNI)**。客戶端填入 `<profileKey>.<dotDomain>` 連線時，服務端在解密資料前即可從 TLS ClientHello 中提取子域名，實現 0 額外開銷的精準接入點分流。

---

## 3. 客戶端互動式配置引導

Web 控制面板內建了針對各個作業系統的互動式客戶端配置指南：

![客戶端互動式配置引導](/DNS-Worker/screenshots/dns.obex-setup.webp)

### Android 9+（原生私有 DNS）
Android 原生支援通過 853 埠發起 DNS over TLS：

1. 開啟 Android 裝置 **設定 (Settings)**。
2. 進入 **網路和網際網路 (Network & Internet)** → **私有 DNS (Private DNS)**。
3. 選擇 **私有 DNS 提供商主機名 (Private DNS provider hostname)**。
4. 填入您的接入點主機名：
   ```text
   <profileKey>.<dotDomain>
   ```
   *示例：* `a8f9c2d14e.dns.example.com`
5. 點選 **儲存**。系統將自動完成 TLS 校驗並接管全域性 DNS。

---

### Apple iOS / iPadOS / macOS

Apple 生態系統通過簽名描述檔案（`.mobileconfig`）原生支援加密 DNS（DoH 與 DoT）。

#### 方式 A：直接下載移動配置檔案 (.mobileconfig)
1. 在 Web 管理面板中，進入目標接入點頁面。
2. 點選 **Export Client Config** → **Apple Configuration Profile (.mobileconfig)**。
3. 在 Apple 裝置上開啟下載的檔案。
4. 前往系統 **設定** → **已下載描述檔案**，點選 **安裝** 即可。

#### 方式 B：第三方工具整合
亦可在 **AdGuard**、**DNSCloak** 或 **Shadowrocket** 中配置：
- 上游型別選擇 **DNS-over-HTTPS**。
- 填入對應 DoH 地址：`https://<domain>/dns-query/<profileKey>`。

---

### Windows 11（原生 DoH）

Windows 11 系統網路設定原生支援 DNS over HTTPS：

1. 開啟 **設定** (`Win + I`) → **網路和 Internet**。
2. 點選正在連線的網路（**Wi-Fi** 或 **乙太網路**）。
3. 在 **DNS 伺服器分配** 處，點選 **編輯**。
4. 從 *自動 (DHCP)* 切換為 **手動**，並啟用 **IPv4**。
5. 在 **首選 DNS** 中輸入伺服器 IP。
6. 在 **DNS over HTTPS** 下拉選單中選擇 **開 (自動模板)**，或填入 DoH 模板：
   ```text
   https://<domain>/dns-query/<profileKey>
   ```
7. 點選 **儲存**。

---

### Linux (`systemd-resolved`)

在搭載 `systemd-resolved` 的系統（Ubuntu、Debian、Fedora、Arch）中：

1. 編輯 `/etc/systemd/resolved.conf`：
   ```ini
   [Resolve]
   DNS=<server-ip>#<profileKey>.<dotDomain>
   DNSOverTLS=yes
   Domains=~.
   ```
2. 重啟服務生效：
   ```bash
   sudo systemctl restart systemd-resolved
   ```
3. 執行 `resolvectl status` 驗證加密狀態。

---

### 路由器與閘道器裝置 (SmartDNS / OpenWrt / AdGuard Home)

在區域網主路由或軟路由上將 DNS 轉發至 DNS Worker：

#### SmartDNS 配置示例 (`/etc/smartdns/smartdns.conf`)：
```ini
server-tls <dotDomain>:853 -tls-host-verify <profileKey>.<dotDomain> -group worker
server-https https://<domain>/dns-query/<profileKey> -group worker
```

#### AdGuard Home 上游伺服器設定：
在 AdGuard Home **設定** → **DNS 設定** → **上游 DNS 伺服器** 中填入：
```text
tls://<profileKey>.<dotDomain>
https://<domain>/dns-query/<profileKey>
```
