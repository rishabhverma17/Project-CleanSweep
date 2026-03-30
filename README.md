# CleanSweep

> Personal media storage for families — self-hosted on Azure, inspired by Google Photos.

**Live:** [cleansweep-app.azurewebsites.net](https://cleansweep-app.azurewebsites.net)

---

## Features

- **Photo & video upload** — drag-and-drop, file picker, or **folder upload** (filters supported types automatically)
- **Auto-retry uploads** — exponential backoff, up to 3 retries per file
- **Background processing** — metadata extraction, thumbnail generation, HEVC transcode queue
- **Real-time sync** — SignalR broadcasts: all connected clients auto-refresh when media changes
- **Gallery view** — date-grouped grid, sort by date captured/uploaded/size, filter by type
- **Lightbox viewer** — full-screen playback with arrow-key navigation
- **Batch operations** — multi-select, batch delete, batch download (ZIP)
- **Albums** — create, add/remove media, cover thumbnails
- **Families** — create groups, invite via code/link, share media to family, browse family library
- **Family media browser** — sort, select, batch download, any member can unshare media
- **Public share links** — time-limited anonymous access (1h/24h/7d/30d expiry picker)
- **Join via invite link** — `/join/:code` route with auth prompt for anonymous visitors
- **Per-user quotas** — admin-configurable storage limits (default: 500 GB)
- **Admin panel** — user management, quota adjustment, reprocess all media, factory reset
- **Global drag-to-upload** — drop files anywhere in the app
- **Background task panel** — live progress for uploads and batch operations
- **Toast notifications** — top-bar slide-down alerts for errors and success
- **Dark theme** — Google Photos–inspired dark UI with Tailwind CSS
- **Lucide React icons** — consistent icon set across all UI
- **Azure AD authentication** — MSAL.js redirect flow, role-based access (owner/viewer)
- **Dev auth bypass** — local development without Azure AD

## Screenshots

> _Coming soon — add screenshots to `docs/screenshots/`._

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, React Router 7, React Query 5, Zustand |
| Backend | C# .NET 8, ASP.NET Core, Clean Architecture |
| Database | PostgreSQL (Azure Flexible Server B1ms) |
| Storage | Azure Blob Storage (StorageV2 LRS, Cool tier) |
| Auth | Azure AD (MSAL.js + Microsoft.Identity.Web), JWT Bearer |
| Hosting | Azure App Service (B2 Linux) |
| Queues | Azure Storage Queues |
| Real-time | SignalR |
| Secrets | Azure Key Vault (Standard) |
| Icons | Lucide React |

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- [Node.js 20+](https://nodejs.org/) and npm
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/install-azure-cli)
- PostgreSQL (local or Azure)
- [Azurite](https://learn.microsoft.com/en-us/azure/storage/common/storage-use-azurite) (for local blob/queue emulation)

## Quick Start

```bash
# 1. Clone
git clone https://github.com/your-org/CleanSweep.git
cd CleanSweep

# 2. Install frontend dependencies
cd client && npm install && cd ..

# 3. Start Azurite (separate terminal)
azurite --silent

# 4. Configure backend
cp src/CleanSweep.API/appsettings.Development.template.json \
   src/CleanSweep.API/appsettings.Development.json
# Edit appsettings.Development.json with your Postgres connection string

# 5. Apply EF Core migrations
cd src/CleanSweep.API
dotnet ef database update --project ../CleanSweep.Infrastructure
cd ../..

# 6. Run backend (port 5000)
cd src/CleanSweep.API && dotnet run &

# 7. Run frontend (port 3000)
cd client && npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Dev auth is auto-enabled when `AzureAd:Enabled` is `false`.

## Deployment

The included script builds frontend, bundles into `wwwroot`, publishes the .NET app, and deploys to Azure:

```bash
./scripts/deploy.sh
```

**First-time setup:** provision Azure resources (App Service, Storage, Postgres, Key Vault, App Registration) using `./scripts/setup-azure-env.sh` or manually via the Azure Portal. See the [TechSpec](TechSpec.md) section 4 for detailed resource configuration.

## Environment Variables

| Key | Section | Description | Example |
|-----|---------|-------------|---------|
| `ConnectionStrings__Postgres` | — | PostgreSQL connection string | `Host=...;Database=cleansweep;...` |
| `AzureAd__Enabled` | AzureAd | Enable Azure AD auth | `true` |
| `AzureAd__Instance` | AzureAd | Azure AD instance URL | `https://login.microsoftonline.com/` |
| `AzureAd__TenantId` | AzureAd | Azure AD tenant ID | `142f4152-...` |
| `AzureAd__ClientId` | AzureAd | App registration client ID | `572f7365-...` |
| `AzureAd__Audience` | AzureAd | API audience URI | `api://572f7365-...` |
| `Storage__ConnectionString` | Storage | Azure Blob connection string | `DefaultEndpointsProtocol=https;...` |
| `Storage__OriginalsContainer` | Storage | Original files container | `originals` |
| `Storage__PlaybackContainer` | Storage | Transcoded playback container | `playback` |
| `Storage__ThumbnailsContainer` | Storage | Thumbnails container | `thumbnails` |
| `Storage__ReadSasExpiryMinutes` | Storage | Read SAS token lifetime | `15` |
| `Storage__WriteSasExpiryMinutes` | Storage | Write SAS token lifetime | `30` |
| `Queue__ConnectionString` | Queue | Azure Storage Queue connection | same as Storage |
| `Queue__MediaProcessingQueue` | Queue | Processing queue name | `media-processing` |
| `Queue__TranscodeQueue` | Queue | Transcode queue name | `transcode-jobs` |
| `Queue__ProcessingVisibilityTimeoutSeconds` | Queue | Processing message timeout | `300` |
| `Queue__TranscodeVisibilityTimeoutSeconds` | Queue | Transcode message timeout | `1800` |
| `Queue__MaxDequeueCount` | Queue | Max retry attempts | `5` |
| `Transcode__ResourceGroup` | Transcode | ACI resource group | `rv-storage` |
| `Transcode__Location` | Transcode | ACI region | `centralindia` |
| `Transcode__FfmpegImage` | Transcode | FFmpeg Docker image | `jrottenberg/ffmpeg:latest` |
| `Transcode__CpuCores` | Transcode | ACI CPU cores | `1` |
| `Transcode__MemoryGb` | Transcode | ACI memory GB | `1.5` |
| `Transcode__Crf` | Transcode | FFmpeg CRF value | `23` |
| `Transcode__Preset` | Transcode | FFmpeg preset | `medium` |
| `Upload__MaxFileSizeBytes` | Upload | Max upload size | `5368709120` (5 GB) |
| `Quota__DefaultUserQuotaBytes` | Quota | Default per-user quota | `536870912000` (500 GB) |
| `Quota__DefaultFamilyQuotaBytes` | Quota | Default family quota | `536870912000` (500 GB) |
| `VITE_API_BASE_URL` | Frontend | API base URL (client `.env`) | `http://localhost:5000` |

## Project Structure

```
CleanSweep/
├── client/                          # React SPA
│   ├── src/
│   │   ├── api/                     # Axios client, mediaApi, albumApi, familyApi
│   │   ├── auth/                    # MSAL config
│   │   ├── components/layout/       # AppShell, TaskPanel, GlobalDropZone
│   │   ├── components/media/        # MediaGrid, MediaCard, MediaUploader, MediaViewer
│   │   ├── hooks/                   # useMedia, useUpload, useSignalR, useTrackedTask
│   │   ├── pages/                   # Gallery, Upload, Albums, AlbumDetail, Families, Admin
│   │   ├── stores/                  # Zustand task store
│   │   └── types/                   # TypeScript interfaces
│   └── vite.config.ts
├── src/
│   ├── CleanSweep.Domain/          # Entities & enums (zero dependencies)
│   ├── CleanSweep.Application/     # Interfaces, DTOs, services, config
│   ├── CleanSweep.Infrastructure/  # EF Core, Azure Blob, queues, processors
│   └── CleanSweep.API/             # Controllers, middleware, background services, hubs
├── scripts/
│   ├── deploy.sh                    # Build & deploy to Azure
│   └── setup-azure-env.sh          # First-time Azure provisioning
└── CleanSweep.sln
```

## Architecture

```
┌────────────────┐    HTTPS     ┌──────────────────────────────────────────────┐
│                │─────────────▶│  ASP.NET Core API  (App Service B2 Linux)    │
│   Browser      │◀─── SignalR ─│                                              │
│   React SPA    │              │  Controllers ─▶ Application Services          │
│                │              │       │              │            │           │
└────────────────┘              │       ▼              ▼            ▼           │
                                │  ┌─────────┐  ┌──────────┐  ┌──────────┐    │
                                │  │ Postgres │  │ Azure    │  │ Storage  │    │
                                │  │   DB     │  │ Blob     │  │ Queues   │    │
                                │  └─────────┘  └──────────┘  └──────────┘    │
                                │                                              │
                                │  BackgroundServices (Processing + Transcode) │
                                └──────────────────────────────────────────────┘
                                                      │
                                                      ▼
                                               ┌──────────────┐
                                               │ ACI (FFmpeg)  │
                                               │  (placeholder)│
                                               └──────────────┘
```

## API Reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/media/upload/request` | Bearer | Get SAS URL for direct upload |
| POST | `/api/media/upload/complete` | Bearer | Confirm upload, enqueue processing |
| GET | `/api/media` | Bearer | Browse media (paginated, filterable) |
| GET | `/api/media/{id}/download` | Bearer | Get download SAS URL |
| DELETE | `/api/media/{id}` | Owner | Delete media + blobs |
| POST | `/api/media/delete-batch` | Owner | Batch delete media + blobs |
| POST | `/api/media/download-batch` | Bearer | Batch download (ZIP or single) |
| GET | `/api/album` | Bearer | List user albums |
| GET | `/api/album/{id}` | Bearer | Album detail with media + SAS URLs |
| POST | `/api/album` | Bearer | Create album |
| POST | `/api/album/{id}/media` | Bearer | Add media to album |
| DELETE | `/api/album/{id}/media/{mediaId}` | Bearer | Remove media from album |
| DELETE | `/api/album/{id}` | Owner | Delete album |
| POST | `/api/share` | Bearer | Create share link |
| GET | `/api/share/{token}` | Anonymous | Access shared content (returns media with SAS URLs) |
| GET | `/api/family` | Bearer | List my families |
| POST | `/api/family` | Bearer | Create family |
| POST | `/api/family/join` | Bearer | Join family by invite code |
| POST | `/api/family/{id}/share` | Bearer | Share media to family |
| DELETE | `/api/family/{id}/media/{mediaId}` | Bearer | Unshare media from family (any member) |
| GET | `/api/family/{id}/media` | Bearer | Browse family media (paginated) |
| DELETE | `/api/family/{id}/members/{userId}` | Bearer | Remove family member |
| DELETE | `/api/family/{id}` | Owner | Delete family |
| POST | `/api/family/{id}/invite` | Bearer | Regenerate invite code |
| GET | `/api/quota` | Bearer | Get my storage usage |
| PUT | `/api/quota/users/{id}/quota` | Owner | Set user quota |
| GET | `/api/admin/users` | Owner | List all users with stats |
| POST | `/api/admin/reset` | Owner | Delete all data + blobs |
| POST | `/api/admin/reprocess` | Owner | Requeue all for processing |
| — | `/hubs/media` | Bearer | SignalR hub (real-time: `MediaStatusChanged`, `MediaChanged` broadcast) |

## Adding a New User

CleanSweep uses **Azure AD (Entra ID)** for authentication. To add a new user:

### For users in your Azure AD tenant
1. Go to [entra.microsoft.com](https://entra.microsoft.com) → **Identity** → **Enterprise Applications** → **CleanSweep**
2. **Users and groups** → **+ Add user/group**
3. Select the user → assign role (`owner` for admin, `viewer` for standard)
4. Click **Assign**

### For external users (personal Microsoft/Gmail accounts)
1. Go to **Entra ID** → **Users** → **+ New user** → **Invite external user**
2. Enter email address (e.g. `user@gmail.com`) → **Invite**
3. User receives an email → clicks **Accept invitation** → signs in with their Microsoft account
4. After they accept, go to **Enterprise Applications** → **CleanSweep** → **Users and groups** → assign their role

### Via Azure CLI
```bash
# Invite external user
az rest --method POST --uri "https://graph.microsoft.com/v1.0/invitations" \
  --body '{"invitedUserEmailAddress":"user@example.com","inviteRedirectUrl":"https://cleansweep-app.azurewebsites.net","sendInvitationMessage":true}'
```

**Note:** On first sign-in, the backend auto-creates the user's `AppUser` record with default quota (500 GB). Admins can adjust quota from the Admin page.

## Backlog

- **Share album to family** — share an entire album as a first-class object (not just individual media). Album appears in family view, auto-syncs when owner adds new media. Family members can browse/download but only unshare the whole album.
- **HEVC → H.264 transcoding** via Azure Container Instances (ACI with FFmpeg)

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

## License

[MIT](LICENSE)
