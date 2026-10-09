---
title: 接入點配置與客戶端設定
description: 詳細指導如何在 DNS Worker 中建立接入點（Profile）、各類解析協議地址規範以及多平臺客戶端連線設定。
sidebar:
  order: 1
---

在 DNS Worker 中，**接入點**（也稱 **Profile** 或 **配置方案**）是一個獨立的策略隔離單元。每個接入點擁有唯一的路由金鑰、獨立的過濾規則訂閱、自定義上游解析器以及專屬的查詢日誌保留策略。

通過建立不同的接入點，您可以為不同裝置場景實施差異化防護——例如為隨身手機配置強力廣告過濾、為兒童平板啟用安全搜尋，同時為開發測試伺服器保留原生直通環境。

---

## 1. Web 儀表盤接入點建立與管理

### 步驟 1：進入接入點列表
1. 開啟 DNS Worker 管理面板（如 `https://dns.example.com` 或 `http://<服务器IP>:10080`）。
2. 輸入管理員憑據登入。
3. 在左側導航欄點選 **接入點管理**（Profiles）。

### 步驟 2：新建接入點
1. 點選右上角 **+ 新建接入點**（New Profile）按鈕。
2. 輸入便於識別的接入點名稱（例如：`随身手机`、`客厅路由器`、`办公笔记本`）。
3. 點選 **確認建立**。

```
┌────────────────────────────────────────────────────────┐
│ 接入点名称: 随身手机                                    │
│ 路由密钥 (Profile Key): a8f9c2d14e...                  │
│ 运行状态: 活跃 (Active)                                 │
│ 拦截动作: 零 IP 拦截 (0.0.0.0 / ::)                     │
│ 查询日志: 已启用 (保留周期: 30 天)                      │
└────────────────────────────────────────────────────────┘
```

### 步驟 3：獲取專屬路由金鑰 (Profile Key)
每個新接入點建立後都會生成一個高強度的隨機 **Profile Key**（例如 `a8f9c2d14e...`）。該金鑰充當 DoH 路徑分發與 DoT SNI 握手的唯一路由憑據。

---

## 2. 協議矩陣與連線地址規範

DNS Worker 全面支援主流現代加密 DNS 協議與經典 UDP DNS。

| 協議型別 | 連線地址格式 | 適用場景 |
| :--- | :--- | :--- |
| **DoH (DNS over HTTPS)** | `https://<域名>/dns-query/<profileKey>` | 桌面瀏覽器、Windows 11、iOS/macOS 描述檔案、curl |
| **DoT (DNS over TLS)** | `tls://<profileKey>.<dotDomain>:853` | Linux `systemd-resolved`、Stubby、安卓私密 DNS |
| **安卓私密 DNS (Private DNS)** | `<profileKey>.<dotDomain>` | Android 9+ 原生系統設定 |
| **經典 UDP (Do53)** | `udp://<服务器IP>:53` | 傳統路由器、IoT 物聯網裝置、本地測試 |

> [!NOTE]
> 在獨立伺服器（Serverfull）模式下，DoT 接入點路由依賴 **TLS 伺服器名稱指示（SNI）**。當客戶端發起 `<profileKey>.<dotDomain>` 握手時，服務端在解密 TLS 前即可識別目標接入點，直接應用對應規則。

---

## 3. 全平臺客戶端連線配置指南

### Android 9+（原生私密 DNS）
Android 系統內建對 DNS over TLS (DoT) 的原生支援：

1. 開啟手機 **設定**。
2. 進入 **網路和網際網路** → **私密 DNS**（或直接在設定中搜索“私密 DNS”）。
3. 選擇 **私密 DNS 提供商主機名**。
4. 輸入您的專屬接入點域名：
   ```text
   <profileKey>.<dotDomain>
   ```
   *示例：* `a8f9c2d14e.dns.example.com`
5. 點選 **儲存**。系統將自動發起 TLS 握手驗證，驗證通過後所有系統流量即刻生效。

---

### Apple iOS / iPadOS / macOS

Apple 裝置原生支援通過簽名描述檔案（`.mobileconfig`）接入加密 DNS：

#### 方案 A：Web 儀表盤直接匯出描述檔案
1. 在 DNS Worker 管理面板中，進入對應的接入點詳情頁。
2. 點選 **匯出客戶端配置** → **Apple 配置檔案 (.mobileconfig)**。
3. 在 Apple 裝置上開啟下載的 `.mobileconfig` 檔案。
4. 前往系統 **設定** → **已下載描述檔案**，點選 **安裝** 並信任。

#### 方案 B：使用第三方客戶端 App
您也可以使用 **AdGuard**、**DNSCloak**、**Surge** 或 **Shadowrocket**：
- 上游型別選擇 **DNS-over-HTTPS**。
- 輸入您的 DoH 地址：`https://<域名>/dns-query/<profileKey>`。

---

### Windows 11（原生 DoH）

Windows 11 系統設定已完整支援原生 DoH：

1. 按下 `Win + I` 開啟 **設定** → **網路和 Internet**。
2. 點選當前連線的 **Wi-Fi** 或 **乙太網路**。
3. 在 **DNS 伺服器分配** 處點選 **編輯**。
4. 將模式切換為 **手動**，並啟用 **IPv4**。
5. 在 **首選 DNS** 中輸入您的 DNS Worker 伺服器 IP。
6. 在 **DNS over HTTPS** 下拉選單選擇 **開 (自動模板)**，或填入模板 URL：
   ```text
   https://<域名>/dns-query/<profileKey>
   ```
7. 點選 **儲存**。

---

### Linux (`systemd-resolved`)

在現代 Linux 系統（Ubuntu、Debian、Fedora、Arch）中配置：

1. 編輯 `/etc/systemd/resolved.conf`：
   ```ini
   [Resolve]
   DNS=<服务器IP>#<profileKey>.<dotDomain>
   DNSOverTLS=yes
   Domains=~.
   ```
2. 重啟解析服務：
   ```bash
   sudo systemctl restart systemd-resolved
   ```
3. 使用 `resolvectl status` 檢驗連線與加密狀態。

---

### 路由器與本地閘道器（SmartDNS / OpenWrt / AdGuard Home）

如果您在區域網內執行主路由或旁路由，可將所有內網 DNS 轉發至 DNS Worker：

#### SmartDNS 配置示例 (`/etc/smartdns/smartdns.conf`)：
```ini
server-tls <dotDomain>:853 -tls-host-verify <profileKey>.<dotDomain> -group worker
server-https https://<域名>/dns-query/<profileKey> -group worker
```

#### AdGuard Home 上游配置：
在 AdGuard Home 的 **設定** → **DNS 設定** → **上游 DNS 伺服器** 中填入：
```text
tls://<profileKey>.<dotDomain>
https://<域名>/dns-query/<profileKey>
```
