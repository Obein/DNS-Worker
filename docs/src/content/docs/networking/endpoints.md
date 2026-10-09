---
title: Endpoints & Client Setup
description: Comprehensive guide to creating profiles (endpoints), connection protocols, and multi-platform client configuration in DNS Worker.
sidebar:
  order: 1
---

In DNS Worker, an **Endpoint** (also referred to as a **Profile** or **接入点**) is an isolated policy domain. Each endpoint possesses its own unique routing key, custom filtering rules, upstream resolvers, and query logging retention settings.

By configuring distinct profiles, you can separate policies across different environments — for example, applying strict ad-blocking to mobile phones, enabling SafeSearch on children's devices, and maintaining an unfiltered profile for development servers.

---

## 1. Creating and Managing Profiles in Web UI

### Step 1: Access the Dashboard
1. Open your DNS Worker Web Dashboard (e.g., `https://dns.example.com` or `http://<server-ip>:10080`).
2. Log in with your administrator credentials.
3. In the sidebar navigation, click **Profiles** (接入点管理).

### Step 2: Create a New Profile
1. Click the **+ New Profile** button in the top right corner.
2. Enter a descriptive name for your profile (e.g., `Phone-Mobile`, `Living-Room-Router`, `Kids-Tablet`).
3. Click **Create Profile**.

```
┌────────────────────────────────────────────────────────┐
│ Profile: Phone-Mobile                                  │
│ Profile Key: a8f9c2d14e...                             │
│ Status: Active                                         │
│ Block Mode: Zero IP (0.0.0.0 / ::)                     │
│ Logging: Enabled (Retention: 30 Days)                  │
└────────────────────────────────────────────────────────┘
```

### Step 3: Inspect the Generated Profile Key
Each newly generated profile is assigned a unique cryptographic **Profile Key** (e.g., `a8f9c2d14e...`). This key acts as the routing identifier in DoH paths and DoT SNI handshakes.

---

## 2. Protocol Matrix & Connection URLs

DNS Worker supports all major modern encrypted DNS protocols alongside classic UDP DNS.

| Protocol | Endpoint Format | Applicable Environments |
| :--- | :--- | :--- |
| **DoH (DNS over HTTPS)** | `https://<domain>/dns-query/<profileKey>` | Browsers, Windows 11, iOS/macOS profiles, curl |
| **DoT (DNS over TLS)** | `tls://<profileKey>.<dotDomain>:853` | Linux `systemd-resolved`, Stubby, Android Private DNS |
| **Android Private DNS** | `<profileKey>.<dotDomain>` | Android 9+ native Private DNS |
| **Classic UDP (Do53)** | `udp://<server-ip>:53` | Legacy routers, IoT devices, local testing |

> [!NOTE]
> In Serverfull mode, DoT profile routing utilizes **TLS Server Name Indication (SNI)**. When connecting via `<profileKey>.<dotDomain>`, the server parses the sub-hostname during the TLS ClientHello before decrypting traffic, routing queries directly to the target profile.

---

## 3. Client Configuration Guide

### Android 9+ (Native Private DNS)
Android features built-in support for DNS over TLS (DoT) via the Private DNS setting:

1. Open **Settings** on your Android device.
2. Navigate to **Network & Internet** → **Private DNS** (or search for "Private DNS").
3. Select **Private DNS provider hostname**.
4. Enter your endpoint hostname:
   ```text
   <profileKey>.<dotDomain>
   ```
   *Example:* `a8f9c2d14e.dns.example.com`
5. Tap **Save**. Android will automatically validate the TLS handshake.

---

### Apple iOS / iPadOS / macOS

Apple operating systems natively support Encrypted DNS (DoH and DoT) through signed configuration profiles (`.mobileconfig`).

#### Method A: Web UI Mobileconfig Download
1. In the DNS Worker Web Dashboard, navigate to the target profile.
2. Click **Export Client Config** → **Apple Configuration Profile (.mobileconfig)**.
3. Open the downloaded `.mobileconfig` file on your Apple device.
4. Go to **Settings** → **Profile Downloaded** and click **Install**.

#### Method B: Manual App Integration
You can also use apps such as **AdGuard**, **DNSCloak**, or **Shadowrocket**:
- Select upstream type as **DNS-over-HTTPS**.
- Enter your profile DoH URL: `https://<domain>/dns-query/<profileKey>`.

---

### Windows 11 (Native DoH)

Windows 11 natively supports DNS over HTTPS in system network settings:

1. Open **Settings** (`Win + I`) → **Network & Internet**.
2. Select your active connection (**Wi-Fi** or **Ethernet**).
3. Under **DNS server assignment**, click **Edit**.
4. Switch from *Automatic (DHCP)* to **Manual**, and turn on **IPv4**.
5. In **Preferred DNS**, enter your DNS Worker server IP (or a local loopback/proxy IP).
6. Under **DNS over HTTPS**, select **On (automatic template)** or enter your DoH template:
   ```text
   https://<domain>/dns-query/<profileKey>
   ```
7. Click **Save**.

---

### Linux (`systemd-resolved`)

For Linux systems using `systemd-resolved` (Ubuntu, Debian, Fedora, Arch):

1. Edit `/etc/systemd/resolved.conf`:
   ```ini
   [Resolve]
   DNS=<server-ip>#<profileKey>.<dotDomain>
   DNSOverTLS=yes
   Domains=~.
   ```
2. Restart `systemd-resolved`:
   ```bash
   sudo systemctl restart systemd-resolved
   ```
3. Test resolution using `resolvectl status`.

---

### Routers & Gateways (SmartDNS / OpenWrt / AdGuard Home)

If you run a local gateway or router, you can forward all LAN DNS requests to your DNS Worker profile:

#### SmartDNS Configuration (`/etc/smartdns/smartdns.conf`):
```ini
server-tls <dotDomain>:853 -tls-host-verify <profileKey>.<dotDomain> -group worker
server-https https://<domain>/dns-query/<profileKey> -group worker
```

#### AdGuard Home Upstream:
In AdGuard Home **Settings** → **DNS Settings** → **Upstream DNS servers**, add:
```text
tls://<profileKey>.<dotDomain>
https://<domain>/dns-query/<profileKey>
```
