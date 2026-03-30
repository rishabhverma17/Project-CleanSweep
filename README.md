# CleanSweep

> **A near-unlimited personal media server for families at pennies a month** — powered by Azure Blob Storage's Cool tier (~$0.01/GB/month), turning cheap cloud storage into a full-featured Google Photos alternative.

**Live:** [cleansweep.rishabhverma.in](https://cleansweep.rishabhverma.in)

---

## Why CleanSweep?

Google Photos charges $2.99/month for 100 GB. iCloud charges $9.99/month for 2 TB.

CleanSweep stores **1 TB for ~$10/month** on Azure Blob Cool tier — with no per-user fees, no AI scanning your photos, and full control over your data. The entire infrastructure (compute, database, storage, auth) runs under **~$15/month** for a family with terabytes of media.

**How it works:** Files upload directly from the browser to Azure Blob Storage via SAS tokens — the API server never touches the bytes. Metadata extraction, thumbnail generation, and video transcoding happen asynchronously in background workers. The result: a snappy UI with virtually unlimited storage at commodity cloud prices.

---

## Features

- **Direct-to-blob uploads** — SAS token upload bypasses the server entirely, auto-retry 3x
- **Folder upload** — select entire folders, auto-filters to supported media types
- **Gallery** — date-grouped grid, sort by date/size/type, multi-select, batch delete/download (ZIP)
- **Albums** — create, add/remove media, cover thumbnails
- **Family sharing** — invite via code/link, share media, browse family library, any member can unshare
- **Public share links** — anonymous viewer page with expiry picker (1h / 24h / 7d / 30d)
- **Real-time sync** — SignalR broadcasts keep all connected clients in sync
- **Background processing** — EXIF metadata extraction, thumbnail generation, video thumbnails via FFmpeg
- **Per-user quotas** — admin-configurable (default 500 GB), sidebar usage bar
- **Admin panel** — user management, quota editing, reprocess/reset
- **Lightbox** — full-screen viewer with keyboard nav, video playback, inline share
- **Dark theme** — Google Photos–inspired UI with Lucide React icons
- **Azure AD auth** — Microsoft login, role-based access (owner / viewer)
- **CI/CD** — GitHub Actions builds on PR, auto-deploys to Azure on merge to main

## Screenshots

> _Coming soon_

---

## Cost Breakdown

For a family with ~500 GB of photos and videos:

| Resource | Monthly Cost |
|----------|-------------|
| Blob Storage (500 GB Cool tier) | ~$5 |
| App Service (B2 Linux) | ~$7 |
| PostgreSQL (B1ms, shared) | ~$0 |
| Key Vault, App Insights | ~$0 |
| **Total** | **~$12/month** |

Scale to 2 TB for ~$25/month. Storage is the only cost that grows.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, React Query 5, Zustand |
| Backend | C# .NET 8, ASP.NET Core, Clean Architecture |
| Database | PostgreSQL (Azure Flexible Server) |
| Storage | Azure Blob Storage (Cool tier, LRS) |
| Auth | Azure AD / Entra ID (MSAL.js + JWT Bearer) |
| Hosting | Azure App Service (B2 Linux) |
| Real-time | SignalR |
| CI/CD | GitHub Actions |

---

## Architecture

```
┌────────────────┐              ┌──────────────────────────────────────────────┐
│   Browser      │── HTTPS ───▶│  ASP.NET Core API  (App Service B2 Linux)    │
│   React SPA    │◀── SignalR ──│                                              │
│                │              │  Controllers ─▶ Application Services          │
│                │── SAS PUT ──▶│       │              │            │           │
└────────────────┘              │  ┌─────────┐  ┌──────────┐  ┌──────────┐    │
                                │  │ Postgres │  │ Azure    │  │ Storage  │    │
                                │  │   DB     │  │ Blob     │  │ Queues   │    │
                                │  └─────────┘  └──────────┘  └──────────┘    │
                                │                                              │
                                │  BackgroundServices (Processing + Transcode) │
                                └──────────────────────────────────────────────┘
```

**Key insight:** Uploads go directly from browser → Azure Blob via short-lived SAS URLs. The API generates a write-only token, the client PUTs the file, then notifies the server. This means the server handles thousands of concurrent uploads on a tiny VM — the bytes never flow through it.

---

## Project Structure

```
Project-CleanSweep/
├── client/                          # React SPA (Vite + TypeScript)
│   └── src/
│       ├── api/                     # API clients (media, album, family, share)
│       ├── components/              # AppShell, MediaGrid, MediaCard, MediaViewer, etc.
│       ├── pages/                   # Gallery, Upload, Albums, Families, Shared, Join, Admin
│       ├── stores/                  # Zustand (tasks, toasts)
│       └── hooks/                   # useMedia, useUpload, useSignalR
├── src/
│   ├── CleanSweep.Domain/          # Entities & enums (zero dependencies)
│   ├── CleanSweep.Application/     # Interfaces, DTOs, services, config
│   ├── CleanSweep.Infrastructure/  # EF Core, Azure Blob, queues, SignalR, processors
│   └── CleanSweep.API/             # Controllers, middleware, background services
├── .github/workflows/              # CI (build/lint) + CD (deploy to Azure)
├── scripts/deploy.sh               # Manual deploy script
├── TechSpec.md                      # Full technical specification
└── README.md
```

---

## Quick Start

```bash
git clone https://github.com/rishabhverma17/Project-CleanSweep.git
cd Project-CleanSweep

# Frontend
cd client && npm install && cd ..

# Backend config (fill in your Postgres connection string)
cp src/CleanSweep.API/appsettings.Development.template.json \
   src/CleanSweep.API/appsettings.Development.json

# Local blob/queue emulation
azurite --silent &

# Migrate + run
dotnet ef database update --project src/CleanSweep.Infrastructure --startup-project src/CleanSweep.API
cd src/CleanSweep.API && dotnet run &
cd ../../client && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Dev auth is auto-enabled when `AzureAd:Enabled` is `false`.

## Deployment

Push to `main` → GitHub Actions builds frontend + backend → deploys to Azure automatically.

Manual: `./scripts/deploy.sh`

---

## Adding a New User

CleanSweep uses **Azure AD (Entra ID)** for authentication.

- **Tenant users:** Entra ID → Enterprise Applications → CleanSweep → Users & Groups → Add → assign `owner` or `viewer` role
- **External users (Gmail, etc.):** Entra ID → Users → Invite external user → after they accept, assign to the app

On first sign-in, the backend auto-creates the user with 500 GB default quota.

---

## Documentation

| Doc | Contents |
|-----|----------|
| [TechSpec.md](TechSpec.md) | Full technical spec — architecture, entities, API reference, environment variables, Azure setup |
| [Implementation.md](Implementation.md) | Step-by-step implementation guide |
| [Plan.md](Plan.md) | Original project plan |

---

## Backlog

- **Share album to family** — share an entire album as a first-class object, auto-syncs when owner adds media
- **HEVC → H.264 transcoding** via Azure Container Instances (FFmpeg)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit (`git commit -m 'Add my feature'`)
4. Push and open a Pull Request

## License

[MIT](LICENSE)
