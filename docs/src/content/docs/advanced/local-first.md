---
title: Local-First Architecture (OPFS)
description: In-browser WebAssembly SQLite + Origin Private File System for zero-latency log analytics.
---

Traditional DNS dashboards continually send heavy analytical SQL queries to cloud databases, which increases latency and quickly consumes database billing quotas.

## Architecture Highlights

* **Embedded In-Browser SQLite (WASM + OPFS)**:
  The dashboard runs a compiled WebAssembly SQLite database inside a dedicated Web Worker, persisting data to the Origin Private File System (OPFS).
* **0ms Real-Time Queries & Chart Aggregations**:
  Filter tens of thousands of query logs and aggregate dimensions (client IPs, status codes, block reasons, countries) locally in 0 milliseconds.
* **Bidirectional Delta Synchronization**:
  Only newly recorded encrypted logs are incrementally fetched from the server and decrypted locally, minimizing bandwidth and database queries.
