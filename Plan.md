# Project CleanSweep — Plan

> Personal media cold-storage archive and media server built on Azure Blob Storage.
> Browse, upload, stream, and share photos & videos from iPhone/Mac via a web app.

---

## 1. Vision

A lightweight, personal "Google Photos" replacement backed by Azure Blob Storage (Cool tier).
Store all media originals cheaply. Browse via a responsive web gallery. Stream videos directly
in the browser. Share albums with family/friends via time-limited links.

---

## 2. Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18 + Vite + TypeScript |
| **Backend** | C# / .NET 8 LTS (ASP.NET Core Web API) |
| **Database** | PostgreSQL (existing B1ms — new `cleansweep` database alongside n8n) |
| **Blob Storage** | Azure Blob Storage — Cool tier (existing StorageV2 account, LRS, Central India) |
| **Hosting** | Azure App Service B1 Linux (new plan, ~$13/mo) |
| **Transcoding** | Azure Container Instances (ACI) — on-demand FFmpeg (pay-per-second) |
| **Auth** | Azure AD App Registration + MSAL.js (frontend) + `Microsoft.Identity.Web` (.NET backend) |
| **Architecture** | Clean Architecture (4 layers, strict dependency direction) |

---

## 3. Existing Azure Infrastructure

| Resource | Details | Resource Group |
|----------|---------|----------------|
| **Postgres DB** | Burstable B1ms, 1 vCore, 2 GiB RAM, 32 GiB storage | rv-storage |
| **Storage Account** | StorageV2, Standard, LRS, Central India | rv-storage |
| **Cosmos DB Free Tier** | 1000 RU/s, Central India (available, not used — relational model doesn't fit NoSQL) | rv-storage |

**Need to create:**
| Resource | Details | Estimated Cost |
|----------|---------|---------------|
| **App Service Plan** | B1 Linux, Central India | ~$13/mo |
| **App Service** | .NET 8 API (deployed on above plan) | $0 (included) |
| **Blob Containers** | `originals`, `playback`, `thumbnails` in existing storage account | $0 (part of existing account) |
| **Postgres Database** | `CREATE DATABASE cleansweep;` on existing server | $0 |

---

## 4. Feature Requirements

### Phase 1 — MVP

| # | Feature | Description |
|---|---------|-------------|
| 1.1 | **Auth** | Azure AD App Registration. Users sign in with Microsoft account. Roles (`owner`/`viewer`) assigned via Azure AD App Roles + RBAC in Azure Portal. No user management in app. |
| 1.2 | **Upload (Web UI)** | Drag-and-drop / file picker. Browser uploads **directly to Azure Blob via SAS URL** (API generates write-only SAS, transfers zero file bytes). Chunked upload for large files via Azure Block Blob API from browser. Bulk upload with per-file progress, retry on throttle (HTTP 429/503), and configurable concurrency. |
| 1.3 | **Download** | Download originals via backend-generated SAS tokens (302 redirect — API serves zero bytes). |
| 1.4 | **Gallery / Browse** | Paginated grid view with lazy-loaded thumbnails. Filter by date range, media type. |
| 1.5 | **Timeline View** | Auto-organize by EXIF capture date → year/month groups. |
| 1.6 | **Thumbnail Generation** | Async via Azure Storage Queue + BackgroundService. Triggered after upload completes. ImageSharp for JPEG/PNG, Magick.NET for HEIC, FFmpeg keyframe for video. |
| 1.7 | **Real-time Status (SignalR)** | WebSocket push for processing status updates. Thumbnail ready, transcode complete/failed — no polling. |
| 1.7 | **HEIC → JPEG** | Convert iPhone HEIC photos to JPEG on upload for browser compatibility. Original preserved. |
| 1.8 | **HEVC → H.264** | Background transcoding via ACI + FFmpeg. Direct MP4 streaming (no HLS). Original preserved. |
| 1.9 | **Video Playback** | HTML5 `<video>` with range-request support from blob. Seeking works natively. |

### Phase 2 — Albums, Search & Sharing

| # | Feature | Description |
|---|---------|-------------|
| 2.1 | **Custom Albums** | Create named albums, add/remove media. Cover thumbnail denormalized on album row. |
| 2.2 | **Search & Filter** | By date range, media type, album. |
| 2.3 | **Sharing Links** | Time-limited tokens for individual files or albums. No login required for shared content. |
| 2.4 | **Bulk Upload Progress** | Per-file and overall progress for multi-file uploads. |

### Phase 3 — Polish

| # | Feature | Description |
|---|---------|-------------|
| 3.1 | **Lifecycle Management** | Auto-tier blobs Cool → Cold → Archive by age via Azure Lifecycle policies. |
| 3.2 | **Duplicate Detection** | Content hash stored in DB. Check before upload. |
| 3.3 | **PWA** | Installable on iPhone/Mac. Offline thumbnail cache. |

---

## 5. Blob Path Strategy — Hash-Partitioned Naming

Inspired by production systems handling billions of files. The media item's **GUID** serves as
the blob filename. First 8 hex characters define directory depth (4 levels × 2 chars).

```
On upload:
  1. Generate:  Guid.NewGuid().ToString("N")  →  "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
  2. Extension: from original filename         →  ".jpg"
  3. Blob path:
     originals/a1/b2/c3/d4/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.jpg
     thumbnails/a1/b2/c3/d4/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.jpg
     playback/a1/b2/c3/d4/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.mp4
```

**Benefits:**
- No filename collisions — GUID is unique
- No sanitization needed — no special chars, unicode, spaces
- Even blob partition distribution — prevents hot partitions at scale
- Same GUID = DB primary key + blob path base (one ID, three containers)
- Original human-readable filename stored in `media_items.file_name` column only

---

## 6. Architecture

```
┌─────────────────┐    REST: request SAS URL     ┌────────────────────────────────┐
│   React+Vite    │────────────────────────────▶│   C# .NET API (App Service B1) │
│   (SPA)         │◀── REST: browse, albums ────│                                │
│                 │◀── WS: SignalR status push ─│   Controllers (REST)           │
└────────┬────────┘                             │   MediaHub (SignalR)           │
         │                                      │   ProcessingBackgroundService  │
         │  Direct upload                       │   TranscodeBackgroundService   │
         │  (SAS URL,                           └───────────┬──────────────────┘
         │   zero bytes                                     │
         │   through API)                                   │
         │                                      ┌───────────┴──────────────────┐
         ▼                                      │                              │
┌─────────────────┐                             │   EF Core (Npgsql) ──▶ Postgres
│   Azure Blob    │◀── Queue: media-processing ─│                              │
│   (Cool Tier)   │◀── Queue: transcode-jobs ───│   Azure Storage Queues       │
│   originals/    │                             └──────────────────────────────┘
│   playback/     │                                         │
│   thumbnails/   │                              ┌──────────┴─────────────┐
└─────────────────┘                              │   ACI (FFmpeg)         │
                                                 │   HEVC → H.264         │
                                                 │   (on-demand, pay/sec) │
                                                 └────────────────────────┘
```

**Key patterns:**
- **Upload:** Browser → Blob directly (SAS URL). API transfers zero file bytes.
- **Download/View:** API generates SAS URL → browser fetches from Blob directly.
- **Processing:** Queue-driven BackgroundService (metadata, thumbnails, transcoding).
- **Status updates:** SignalR WebSocket push (no polling).
- **Queues:** Azure Storage Queues (built into existing storage account, $0).

---

## 7. Cost Estimation

| Component | $/month | Notes |
|-----------|---------|-------|
| Postgres B1ms | ~$12 | Shared with n8n (sunk cost) |
| App Service B1 (Linux) | ~$13 | New plan |
| Blob Storage (Cool, 200 GB) | ~$2.50 | Existing account |
| Blob Transactions | ~$0.50 | |
| ACI (FFmpeg, on-demand) | ~$0.50–2.00 | Pay-per-second, $0 when idle |
| Egress bandwidth | ~$1–3 | |
| **Total** | **~$30/mo** | |
| **Incremental (excl. Postgres)** | **~$18/mo** | |

---

## 8. Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Database | Postgres (existing) | Already paying, relational model, EF Core support |
| Video strategy | Direct MP4, HEVC→H.264 transcode | No HLS complexity. Range requests handle seeking. |
| Photo strategy | HEIC→JPEG on upload | Universal browser compat. Originals preserved. |
| Blob naming | Hash-partitioned GUID paths | Scale-proof, no collisions, even distribution |
| JOINs | Minimal — 1 JOIN only (album→media) | Album cover denormalized. All other queries are single-table. |
| Auth | Azure AD App Registration | Microsoft handles login, MFA, tokens. Roles via App Roles + RBAC. No user management code in app. Users need Microsoft account. |
| Upload pattern | SAS direct-to-blob | Browser uploads to Blob directly. API generates write-only SAS URL, transfers zero bytes. |
| Processing | Queue-driven BackgroundService | Azure Storage Queues (media-processing + transcode-jobs). Visibility timeout for retry. No DB polling. |
| Real-time updates | SignalR WebSocket | Push status changes (thumbnail ready, transcode done). No frontend polling. |
| Bulk upload | Concurrency-limited + retry | Max 3 parallel uploads. Exponential backoff on HTTP 429/503 (blob throttling). |
| Functions | Removed | Unnecessary complexity for personal use. BackgroundService suffices. |
| Docker | Not used | Unnecessary for personal project. Zip deploy to App Service. FFmpeg via brew (local) / startup command (prod). |
| Cosmos DB | Not used | Free tier available but NoSQL doesn't fit relational model |
| ImageSharp license | Split License v1.0 | Free for personal/open-source use |

---

## 9. Out of Scope

- Native mobile app
- AI tagging / face recognition
- Geo-map view
- CLI upload tool
- Backup/sync automation
- HLS adaptive streaming
- Multi-region replication

---

## 10. Key Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| HEVC transcoding time | Users see "processing" state for 5–15 min per video | Original always downloadable immediately. UI shows clear status. |
| Large file uploads (4K, 1–5 GB) | Timeouts, dropped connections | Chunked upload (4 MB blocks), resume support, B1 has 230s request timeout per chunk (fine). |
| B1 memory (1.75 GB) with inline processing | OOM on large files | Stream uploads directly to blob (never buffer full file). Thumbnail gen uses bounded memory. |
| ACI cold start | First transcode after idle takes 30–60s | Acceptable for personal use. DB marks job as "Processing". |

---

*See [Implementation.md](Implementation.md) for detailed implementation guide.*