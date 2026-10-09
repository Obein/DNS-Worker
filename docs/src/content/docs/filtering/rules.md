---
title: Domain Filtering & Blocklists
description: Subscription management, custom domain rules, Bloom filter acceleration engine, and filtering environment variables reference.
sidebar:
  order: 1
---

DNS Worker features an enterprise-grade protective domain filtering engine capable of evaluating hundreds of thousands of blocking rules with sub-millisecond latency. This guide covers subscription management, custom rules, match engine architecture, and environment variables.

---

## 1. Web UI Filter Rule Management

### Subscribing to External Blocklists
1. Navigate to **Filters** (规则订阅) in the Web Dashboard.
2. Under **External Blocklists**, click **Add Subscription**.
3. Enter the subscription URL (supports standard Adblock Plus, Hosts, or domain list formats).
4. Popular pre-tested lists include:
   - **OISD Big**: `https://big.oisd.nl`
   - **AdGuard Base**: `https://adguardteam.github.io/HostlistsRegistry/assets/filter_1.txt`
   - **HaGeZi Multi PRO**: `https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt`
5. Click **Save & Sync**. DNS Worker parses the rules into optimized memory buffers.

### Custom Allowlist & Blocklist
You can define specific overrides on a per-profile or global basis:
- **Allowlist (白名单)**: Domains that bypass all blocking rules (e.g., corporate subdomains or false positives).
- **Blocklist (黑名单)**: Explicitly banned domains.
- **Supported Syntax**:
  - Plain domains: `ad.example.com`
  - Wildcards: `*.tracking.company.com`
  - Regular expressions: `^analytics-[0-9]+\..*$`

### Block Action Modes
In your profile settings, select how blocked queries are handled:

| Block Mode | Response Behavior | Advantages |
| :--- | :--- | :--- |
| **Zero IP (0.0.0.0 / ::)** | Returns `0.0.0.0` for IPv4 and `::` for IPv6 | **Recommended**. Fastest client termination, prevents timeout retries. |
| **NXDOMAIN** | Returns RCODE 3 (Domain Not Found) | Standards-compliant, signals client that the domain does not exist. |
| **Refused** | Returns RCODE 5 (Query Refused) | Distinguishes blocked requests from non-existent domains. |

---

## 2. Match Engine Architecture: Bloom Filters & Trie

To maintain high throughput on lightweight environments (such as VPS instances with 512MB RAM or Cloudflare Workers edge nodes with 128MB memory caps), DNS Worker uses a **Dual-Layer Bloom Filter** architecture:

```
Incoming Query (e.g. adserver.tracker.com)
                │
                ▼
┌─────────────────────────────────┐
│ Bloom Filter Fast Check         │
│ (Compact Bitset in RAM / KV)    │
└─────────────────────────────────┘
        │                 │
    (Negative)        (Positive)
        │                 ▼
        │     ┌─────────────────────────────────┐
        │     │ Exact Trie Verification Check   │
        │     │ (Prevents false positive blocks)│
        │     └─────────────────────────────────┘
        │                 │                 │
        ▼                 ▼                 ▼
   [ ALLOWED ]       [ BLOCKED ]       [ ALLOWED ]
```

1. **Bloom Filter Layer**: Queries are hashed across a compact bitset. Over 99% of non-blocked domains are instantly validated in $O(1)$ time without database I/O.
2. **Exact Verification Layer**: If the Bloom filter detects a possible match, the query is checked against an exact memory Trie to eliminate false positives.

---

---

## 3. Filtering Environment Variables Reference

Configure these variables in `.env` (Serverfull) or `wrangler.toml` (Cloudflare Workers).

### `PRESET_EXTERNAL_FILTERS`
- **Supported in**: Serverless & Serverfull
- **Format in `wrangler.toml`**: Multi-line TOML string containing a JSON array of `{ label, url }` objects.
- **Format in `.env.serverfull`**: JSON string.
- **Default**: Curated default subscriptions including OISD Big (`https://big.oisd.nl`), OISD NSFW, AdGuard Base, and StevenBlack hosts.

### `BLOOM_FALSE_POSITIVE_RATE`
- **Supported in**: Serverless & Serverfull
- **Default (`wrangler.toml`)**: `0.0001` (1 in 10,000)
- **Default (`.env.serverfull`)**: `0.0001`
- **Description**: Configures bitset size calculation for Bloom filters. The lower threshold (0.0001) minimizes false positives and eliminates CPU spikes during rule evaluation.

### `MAX_SYNC_DOMAINS` & `MAX_LIST_DOMAINS`
- **Supported in**: Serverless & Serverfull
- **Defaults**: `MAX_SYNC_DOMAINS=1000000` (1 million total) & `MAX_LIST_DOMAINS=500000` (500k per list).
- **Description**: Safety boundaries to prevent unbounded memory allocation during external filter fetching.

### `BLOOM_MEM_TTL` & `SYNC_TIMEOUT_MS`
- **Defaults**: `BLOOM_MEM_TTL=600000` (10 minutes in-memory cache) & `SYNC_TIMEOUT_MS=30000` (30s download timeout).
- **Description**: Cache retention time for compiled bloom filters in memory and maximum network timeout when downloading upstream blocklists.

### `SUBSTITUTE_DOMAIN`
- **Supported in**: Serverless & Serverfull
- **Default**: `www.okx.com`
- **Description**: Probing domain used for latency benchmarking and fail-open detection against upstreams.

### `BLOCK_MODE`
- **Supported in**: Serverless & Serverfull
- **Default**: `zero_ip` (`0.0.0.0` / `::`)
- **Options**: `zero_ip`, `nxdomain`, `refused`
- **Description**: Global fallback blocking behavior when not overridden in per-profile settings.
