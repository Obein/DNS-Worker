---
title: Retention, Maintenance & Lifecycle
description: Query log retention caps, 30-day inactivity pruning, log batching performance tuning, and maintenance environment variables reference.
sidebar:
  order: 1
---

To balance auditability with user privacy and storage performance, DNS Worker incorporates an automated lifecycle and retention engine. This document covers query log retention rules, background compaction tasks, and maintenance environment variables.

---

## 1. Query Log Retention & Privacy Policies

### Maximum Retention Cap (`MAX_LOG_RETENTION_DAYS`)
Query log retention is capped by the administrator's `MAX_LOG_RETENTION_DAYS` setting (defaults to **30 days** in Serverless D1, and **360 days** in Serverfull mode).
- **Privacy Principle**: DNS resolution logs contain personal browsing trails. Configurable log retention allows operators to balance audit compliance requirements with privacy preservation.
- **Storage Efficiency**: Limiting log tables ensures database indices fit comfortably in RAM, preventing query degradation and storage exhaustion.

### 30-Day Inactivity Auto-Purge
To protect privacy and conserve disk space:
- If a profile has **no DNS resolution activity for 30 consecutive days**, its historical query logs are automatically pruned.
- **Configurations Preserved**: The user account, custom blocklists, allowlists, and profile routing keys remain intact. Only historical query log records are removed.

---

## 2. Background Task Automation

DNS Worker maintains database health through scheduled background tasks:

```
┌────────────────────────────────────────────────────────┐
│ Scheduled Maintenance Phase                            │
│  ├─ 1. Expire query logs older than retentionDays      │
│  ├─ 2. Prune query logs for inactive accounts (30d)    │
│  ├─ 3. Invalidate expired web sessions & refresh tokens │
│  └─ 4. Periodic SQLite WAL checkpointing & VACUUM      │
└────────────────────────────────────────────────────────┘
```

- **Cloudflare Workers Mode**: Executed via Cloudflare Cron Triggers (`scheduled(event, env, ctx)` handler).
- **Serverfull Node.js / Bun Mode**: Executed via background interval timers managed directly within the process.

---

## 3. High-Throughput Log Batcher Architecture

Inserting individual log rows for thousands of DNS queries per second would saturate database transaction locks. DNS Worker buffers logs in memory:

- Queries accumulate in an asynchronous memory queue.
- Logs are flushed in bulk transactions when either the batch size threshold (`LOG_BATCH_SIZE`) or timeout window (`LOG_FLUSH_INTERVAL_MS`) is met.
- In-memory buffers are protected against memory exhaustion using bounded queue limits.

---

---

## 4. Maintenance & Quotas: Serverless vs Serverfull

Because Cloudflare D1 imposes database storage and daily write quota limits (500 MB storage in the free tier, 100k daily write operations), retention caps and log budgets are calibrated differently between Serverless (`wrangler.toml`) and Serverfull (`.env.serverfull`).

| Maintenance Parameter | Serverless (`wrangler.toml`) | Serverfull (`.env.serverfull`) | Rationale & Constraint |
| :--- | :--- | :--- | :--- |
| **Admin Max Retention** (`MAX_LOG_RETENTION_DAYS`) | **30 Days** | **360 Days** | Protects D1 from storage exhaustion on Edge; permits long-term auditing on Serverfull. |
| **Admin Default Retention** (`DEFAULT_LOG_RETENTION_DAYS`) | **7 Days** | **180 Days** | High default storage allowance on local disks. |
| **Normal User Max Retention** (`NORMAL_USER_MAX_LOG_RETENTION_DAYS`) | **7 Days** | **30 Days** | Restricts non-admin user storage footprint. |
| **Normal User Default** (`NORMAL_USER_DEFAULT_LOG_RETENTION_DAYS`) | **1 Day** | **7 Days** | Minimal retention default for multi-tenant accounts. |
| **Max Log Rows per Profile** (`MAX_LOGS_PER_PROFILE`) | **500,000** | **5,000,000** | Circuit-breaker when query rates exceed deletion rate. |
| **Cleanup Batch Limit** (`LOG_CLEANUP_BATCH_LIMIT`) | `1000` rows/run | `1000` rows/run | Prevents database transaction timeouts during cron runs. |
| **Daily Deletion Budget** (`LOG_CLEANUP_DAILY_BUDGET`) | `20,000` rows/day | `20,000` rows/day | Conservatively preserves 80% of D1's 100k daily write quota. |
| **Account Inactivity Threshold** (`INACTIVITY_THRESHOLD_DAYS`) | `180` Days | `180` Days | Period before dormant accounts are considered abandoned. |
| **Inactivity Log Purge** | **30 Days** | **30 Days** | Prunes historical query logs for 30d inactive accounts. |

---

## 5. Maintenance Environment Variables Reference

### Retention & Quota Variables

#### `MAX_LOG_RETENTION_DAYS` & `DEFAULT_LOG_RETENTION_DAYS`
- **Supported in**: Serverless & Serverfull
- **Defaults**:
  - `wrangler.toml`: Max `30`, Default `7`
  - `.env.serverfull`: Max `360`, Default `180`
- **Description**: Upper bound and default lifetime for query logs of administrator profiles.

#### `NORMAL_USER_MAX_LOG_RETENTION_DAYS` & `NORMAL_USER_DEFAULT_LOG_RETENTION_DAYS`
- **Supported in**: Serverless & Serverfull
- **Defaults**:
  - `wrangler.toml`: Max `7`, Default `1`
  - `.env.serverfull`: Max `30`, Default `7`
- **Description**: Storage quotas applied to standard non-administrator users.

#### `MAX_LOGS_PER_PROFILE`
- **Supported in**: Serverless & Serverfull
- **Defaults**: `500000` (Serverless) vs `5000000` (Serverfull)
- **Description**: Hard ceiling on total query rows preserved per profile. Protects database health during sustained query surges.

---

### Batching & Session Lifetimes

#### `LOG_CLEANUP_BATCH_LIMIT` & `LOG_CLEANUP_DAILY_BUDGET`
- **Defaults**: `1000` (Batch Limit) and `20000` (Daily Budget)
- **Description**: Regulates the deletion velocity during scheduled maintenance runs to ensure operations stay well within database transaction quotas.

#### `DEFAULT_SESSION_EXPIRATION_MINUTES` & `OPTIONAL_SESSION_EXPIRATION_DAYS`
- **Defaults**: `1440` (24 Hours default session) and `7` (7 Days when "Remember Me" is checked)
- **Description**: Controls JWT and database authentication session lifetimes.

#### `ACCESS_TOKEN_EXPIRATION_MINUTES` & `RTR_GRACE_WINDOW_MS`
- **Defaults**: `1` minute (short-lived Access Token) and `15000` ms (15s Refresh Token Rotation concurrency grace window).
- **Description**: Zero-trust token rotation parameters preventing stale token reuse while avoiding unexpected multi-tab logouts.

#### `AUTO_VACUUM` & `SQLITE_JOURNAL_MODE` *(Serverfull Only)*
- **Defaults**: `WAL` (Write-Ahead Logging)
- **Description**: Direct SQLite engine flags in Serverfull mode for concurrent reads and resilient crash recovery.
