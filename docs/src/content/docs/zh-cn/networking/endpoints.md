---
title: 接入点配置与客户端设置
description: 详细指导如何在 DNS Worker 中创建接入点（Profile）、各类解析协议地址规范以及多平台客户端连接设置。
sidebar:
  order: 1
---

在 DNS Worker 中，**接入点**（也称 **Profile** 或 **配置方案**）是一个独立的策略隔离单元。每个接入点拥有唯一的路由密钥、独立的过滤规则订阅、自定义上游解析器以及专属的查询日志保留策略。

通过创建不同的接入点，您可以为不同设备场景实施差异化防护——例如为随身手机配置强力广告过滤、为儿童平板启用安全搜索，同时为开发测试服务器保留原生直通环境。

---

## 1. Web 仪表盘接入点创建与管理

### 步骤 1：进入接入点列表
1. 打开 DNS Worker 管理面板（如 `https://dns.example.com` 或 `http://<服务器IP>:10080`）。
2. 输入管理员凭据登录。
3. 在左侧导航栏点击 **接入点管理**（Profiles）。

### 步骤 2：新建接入点
1. 点击右上角 **+ 新建接入点**（New Profile）按钮。
2. 输入便于识别的接入点名称（例如：`随身手机`、`客厅路由器`、`办公笔记本`）。
3. 点击 **确认创建**。

```
┌────────────────────────────────────────────────────────┐
│ 接入点名称: 随身手机                                    │
│ 路由密钥 (Profile Key): a8f9c2d14e...                  │
│ 运行状态: 活跃 (Active)                                 │
│ 拦截动作: 零 IP 拦截 (0.0.0.0 / ::)                     │
│ 查询日志: 已启用 (保留周期: 30 天)                      │
└────────────────────────────────────────────────────────┘
```

### 步骤 3：获取专属路由密钥 (Profile Key)
每个新接入点创建后都会生成一个高强度的随机 **Profile Key**（例如 `a8f9c2d14e...`）。该密钥充当 DoH 路径分发与 DoT SNI 握手的唯一路由凭据。

---

## 2. 协议矩阵与连接地址规范

DNS Worker 全面支持主流现代加密 DNS 协议与经典 UDP DNS。

| 协议类型 | 连接地址格式 | 适用场景 |
| :--- | :--- | :--- |
| **DoH (DNS over HTTPS)** | `https://<域名>/dns-query/<profileKey>` | 桌面浏览器、Windows 11、iOS/macOS 描述文件、curl |
| **DoT (DNS over TLS)** | `tls://<profileKey>.<dotDomain>:853` | Linux `systemd-resolved`、Stubby、安卓私密 DNS |
| **安卓私密 DNS (Private DNS)** | `<profileKey>.<dotDomain>` | Android 9+ 原生系统设置 |
| **经典 UDP (Do53)** | `udp://<服务器IP>:53` | 传统路由器、IoT 物联网设备、本地测试 |

> [!NOTE]
> 在独立服务器（Serverfull）模式下，DoT 接入点路由依赖 **TLS 服务器名称指示（SNI）**。当客户端发起 `<profileKey>.<dotDomain>` 握手时，服务端在解密 TLS 前即可识别目标接入点，直接应用对应规则。

---

## 3. 全平台客户端连接配置指南

### Android 9+（原生私密 DNS）
Android 系统内置对 DNS over TLS (DoT) 的原生支持：

1. 打开手机 **设置**。
2. 进入 **网络和互联网** → **私密 DNS**（或直接在设置中搜索“私密 DNS”）。
3. 选择 **私密 DNS 提供商主机名**。
4. 输入您的专属接入点域名：
   ```text
   <profileKey>.<dotDomain>
   ```
   *示例：* `a8f9c2d14e.dns.example.com`
5. 点击 **保存**。系统将自动发起 TLS 握手验证，验证通过后所有系统流量即刻生效。

---

### Apple iOS / iPadOS / macOS

Apple 设备原生支持通过签名描述文件（`.mobileconfig`）接入加密 DNS：

#### 方案 A：Web 仪表盘直接导出描述文件
1. 在 DNS Worker 管理面板中，进入对应的接入点详情页。
2. 点击 **导出客户端配置** → **Apple 配置文件 (.mobileconfig)**。
3. 在 Apple 设备上打开下载的 `.mobileconfig` 文件。
4. 前往系统 **设置** → **已下载描述文件**，点击 **安装** 并信任。

#### 方案 B：使用第三方客户端 App
您也可以使用 **AdGuard**、**DNSCloak**、**Surge** 或 **Shadowrocket**：
- 上游类型选择 **DNS-over-HTTPS**。
- 输入您的 DoH 地址：`https://<域名>/dns-query/<profileKey>`。

---

### Windows 11（原生 DoH）

Windows 11 系统设置已完整支持原生 DoH：

1. 按下 `Win + I` 打开 **设置** → **网络和 Internet**。
2. 点击当前连接的 **Wi-Fi** 或 **以太网**。
3. 在 **DNS 服务器分配** 处点击 **编辑**。
4. 将模式切换为 **手动**，并启用 **IPv4**。
5. 在 **首选 DNS** 中输入您的 DNS Worker 服务器 IP。
6. 在 **DNS over HTTPS** 下拉菜单选择 **开 (自动模板)**，或填入模板 URL：
   ```text
   https://<域名>/dns-query/<profileKey>
   ```
7. 点击 **保存**。

---

### Linux (`systemd-resolved`)

在现代 Linux 系统（Ubuntu、Debian、Fedora、Arch）中配置：

1. 编辑 `/etc/systemd/resolved.conf`：
   ```ini
   [Resolve]
   DNS=<服务器IP>#<profileKey>.<dotDomain>
   DNSOverTLS=yes
   Domains=~.
   ```
2. 重启解析服务：
   ```bash
   sudo systemctl restart systemd-resolved
   ```
3. 使用 `resolvectl status` 检验连接与加密状态。

---

### 路由器与本地网关（SmartDNS / OpenWrt / AdGuard Home）

如果您在局域网内运行主路由或旁路由，可将所有内网 DNS 转发至 DNS Worker：

#### SmartDNS 配置示例 (`/etc/smartdns/smartdns.conf`)：
```ini
server-tls <dotDomain>:853 -tls-host-verify <profileKey>.<dotDomain> -group worker
server-https https://<域名>/dns-query/<profileKey> -group worker
```

#### AdGuard Home 上游配置：
在 AdGuard Home 的 **设置** → **DNS 设置** → **上游 DNS 服务器** 中填入：
```text
tls://<profileKey>.<dotDomain>
https://<域名>/dns-query/<profileKey>
```
