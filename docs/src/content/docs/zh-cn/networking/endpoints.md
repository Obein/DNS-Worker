---
title: 接入点配置与客户端设置
description: DNS Worker 接入点（Profile）创建管理、连接协议矩阵及多平台客户端配置完整指南。
sidebar:
  order: 1
---

在 DNS Worker 中，**接入点**（也称 **Profile** 或配置策略）是一个相互隔离的安全策略域。每个接入点拥有独立的路由密钥、自定义过滤规则、上游解析器以及查询日志留存时长。

通过配置不同的接入点，您可以轻松实现精细化分流管理——例如为手机配置强力去广告策略，为儿童平板开启安全搜索保护，同时为开发服务器保留无拦截直连通道。

---

## 1. Web 面板中创建与管理接入点

![接入点管理面板](/DNS-Worker/screenshots/dns.obex-endpoints.webp)

### 步骤 1：访问管理面板
1. 打开 DNS Worker Web 控制面板（例如 `https://dns.example.com` 或 `http://<server-ip>:10080`）。
2. 使用管理员凭据登录系统。
3. 在左侧导航栏中，点击 **Profiles**（接入点管理）。

### 步骤 2：新建接入点
1. 点击右上角 **+ New Profile**（新建接入点）按钮。
2. 输入接入点名称（例如 `Phone-Mobile`、`Living-Room-Router`、`Kids-Tablet`）。
3. 点击 **Create Profile**（创建接入点）。

```
┌────────────────────────────────────────────────────────┐
│ 接入点名称: Phone-Mobile                                 │
│ 路由密钥: a8f9c2d14e...                                │
│ 状态: 激活 (Active)                                     │
│ 拦截响应: Zero IP (0.0.0.0 / ::)                        │
│ 日志策略: 启用 (保留 30 天)                             │
└────────────────────────────────────────────────────────┘
```

### 步骤 3：多接入点快速切换

在 Web 控制面板的任意页面，都可以通过顶部或左侧的下拉菜单极速切换当前查看与操作的接入点：

![多接入点快速切换](/DNS-Worker/screenshots/dns.obex-profile_select.webp)

### 步骤 4：查看接入点密钥
系统会自动为每个新建接入点生成唯一的加密 **Profile Key**（如 `a8f9c2d14e...`）。该密钥在 DoH 请求路径与 DoT SNI 握手过程中作为精确路由标识。

---

## 2. 协议支持与接入 URL 矩阵

DNS Worker 支持所有主流现代加密 DNS 协议以及传统 UDP DNS。

| 协议 | 接入点地址格式 | 适用场景 |
| :--- | :--- | :--- |
| **DoH (DNS over HTTPS)** | `https://<domain>/dns-query/<profileKey>` | 浏览器、Windows 11、iOS/macOS 描述文件、curl |
| **DoT (DNS over TLS)** | `tls://<profileKey>.<dotDomain>:853` | Linux `systemd-resolved`、Stubby、Android 原生私有 DNS |
| **Android 私有 DNS** | `<profileKey>.<dotDomain>` | Android 9+ 系统自带私有 DNS |
| **传统 UDP (Do53)** | `udp://<server-ip>:53` | 传统路由器、IoT 物联网设备、局域网测试 |

> [!NOTE]
> 在 Serverfull 模式下，DoT 接入点路由依赖 **TLS 服务器名称指示 (SNI)**。客户端填入 `<profileKey>.<dotDomain>` 连接时，服务端在解密数据前即可从 TLS ClientHello 中提取子域名，实现 0 额外开销的精准接入点分流。

---

## 3. 客户端交互式配置引导

Web 控制面板内置了针对各个操作系统的交互式客户端配置指南：

![客户端交互式配置引导](/DNS-Worker/screenshots/dns.obex-setup.webp)

### Android 9+（原生私有 DNS）
Android 原生支持通过 853 端口发起 DNS over TLS：

1. 打开 Android 设备 **设置 (Settings)**。
2. 进入 **网络和互联网 (Network & Internet)** → **私有 DNS (Private DNS)**。
3. 选择 **私有 DNS 提供商主机名 (Private DNS provider hostname)**。
4. 填入您的接入点主机名：
   ```text
   <profileKey>.<dotDomain>
   ```
   *示例：* `a8f9c2d14e.dns.example.com`
5. 点击 **保存**。系统将自动完成 TLS 校验并接管全局 DNS。

---

### Apple iOS / iPadOS / macOS

Apple 生态系统通过签名描述文件（`.mobileconfig`）原生支持加密 DNS（DoH 与 DoT）。

#### 方式 A：直接下载移动配置文件 (.mobileconfig)
1. 在 Web 管理面板中，进入目标接入点页面。
2. 点击 **Export Client Config** → **Apple Configuration Profile (.mobileconfig)**。
3. 在 Apple 设备上打开下载的文件。
4. 前往系统 **设置** → **已下载描述文件**，点击 **安装** 即可。

#### 方式 B：第三方工具集成
亦可在 **AdGuard**、**DNSCloak** 或 **Shadowrocket** 中配置：
- 上游类型选择 **DNS-over-HTTPS**。
- 填入对应 DoH 地址：`https://<domain>/dns-query/<profileKey>`。

---

### Windows 11（原生 DoH）

Windows 11 系统网络设置原生支持 DNS over HTTPS：

1. 打开 **设置** (`Win + I`) → **网络和 Internet**。
2. 点击正在连接的网络（**Wi-Fi** 或 **以太网**）。
3. 在 **DNS 服务器分配** 处，点击 **编辑**。
4. 从 *自动 (DHCP)* 切换为 **手动**，并启用 **IPv4**。
5. 在 **首选 DNS** 中输入服务器 IP。
6. 在 **DNS over HTTPS** 下拉菜单中选择 **开 (自动模板)**，或填入 DoH 模板：
   ```text
   https://<domain>/dns-query/<profileKey>
   ```
7. 点击 **保存**。

---

### Linux (`systemd-resolved`)

在搭载 `systemd-resolved` 的系统（Ubuntu、Debian、Fedora、Arch）中：

1. 编辑 `/etc/systemd/resolved.conf`：
   ```ini
   [Resolve]
   DNS=<server-ip>#<profileKey>.<dotDomain>
   DNSOverTLS=yes
   Domains=~.
   ```
2. 重启服务生效：
   ```bash
   sudo systemctl restart systemd-resolved
   ```
3. 执行 `resolvectl status` 验证加密状态。

---

### 路由器与网关设备 (SmartDNS / OpenWrt / AdGuard Home)

在局域网主路由或软路由上将 DNS 转发至 DNS Worker：

#### SmartDNS 配置示例 (`/etc/smartdns/smartdns.conf`)：
```ini
server-tls <dotDomain>:853 -tls-host-verify <profileKey>.<dotDomain> -group worker
server-https https://<domain>/dns-query/<profileKey> -group worker
```

#### AdGuard Home 上游服务器设置：
在 AdGuard Home **设置** → **DNS 设置** → **上游 DNS 服务器** 中填入：
```text
tls://<profileKey>.<dotDomain>
https://<domain>/dns-query/<profileKey>
```
