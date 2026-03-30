# CleanSweep — Technical Specification

> Comprehensive technical documentation for the CleanSweep personal media storage platform.
> Last updated: 2026-03-30

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Backend](#2-backend)
3. [Frontend](#3-frontend)
4. [Deployment & Infrastructure Configuration](#4-deployment--infrastructure-configuration)
5. [API Reference](#5-api-reference)
6. [Enumerations & Constants](#6-enumerations--constants)

---

## 1. Architecture Overview

### 1.1 Clean Architecture

CleanSweep follows **Clean Architecture** (Onion Architecture) with four .NET projects:

```
CleanSweep.Domain          (innermost — zero dependencies)
    ↑
CleanSweep.Application     (depends on Domain only)
    ↑
CleanSweep.Infrastructure  (depends on Application + Domain)
    ↑
CleanSweep.API             (depends on all — composition root)
```

**Dependency rule:** inner layers never reference outer layers. The Application layer defines interfaces; the Infrastructure layer provides implementations.

### 1.2 Dependency Graph

```
CleanSweep.API
├── CleanSweep.Application
│   └── CleanSweep.Domain
├── CleanSweep.Infrastructure
│   ├── CleanSweep.Application
│   │   └── CleanSweep.Domain
│   └── CleanSweep.Domain
└── CleanSweep.Domain
```

### 1.3 Data Flow

```
Browser (React SPA)
  │
  ├─── HTTPS ───► ASP.NET Core API (App Service B2 Linux)
  │                   │
  │                   ├── Controllers
  │                   │      │
  │                   │      ▼
  │                   ├── Application Services
  │                   │      │
  │                   │      ├──► IMediaRepository ──► PostgreSQL
  │                   │      ├──► IBlobStorageService ──► Azure Blob Storage
  │                   │      └──► IMediaProcessingQueue ──► Azure Storage Queue
  │                   │
  │                   ├── BackgroundServices
  │                   │      ├── ProcessingBackgroundService ◄── media-processing queue
  │                   │      │      ├──► IMetadataExtractor
  │                   │      │      ├──► IThumbnailGenerator
  │                   │      │      └──► ITranscodeQueue (if HEVC)
  │                   │      └── TranscodeBackgroundService ◄── transcode-jobs queue
  │                   │             └──► ITranscoder (ACI FFmpeg — placeholder)
  │                   │
  │                   └── SignalR Hub (/hubs/media)
  │                          │
  ◄───── WebSocket ──────────┘
```

### 1.4 Upload Sequence

1. Client requests SAS URL via `POST /api/media/upload/request`
2. Client uploads file directly to Azure Blob Storage via SAS PUT
3. Client confirms via `POST /api/media/upload/complete`
4. API enqueues `ProcessingMessage` to `media-processing` queue
5. `ProcessingBackgroundService` dequeues, downloads to temp file, extracts metadata, generates thumbnail
6. If HEVC video → enqueues `TranscodeMessage` to `transcode-jobs` queue
7. Otherwise → sets `PlaybackBlobPath = OriginalBlobPath`, status = `Complete`
8. SignalR notifies client of status change

---

## 2. Backend

### 2.1 Solution Structure

```
CleanSweep.sln
├── src/CleanSweep.Domain/
│   ├── Entities/
│   │   ├── MediaItem.cs
│   │   ├── Album.cs
│   │   ├── AlbumMedia.cs
│   │   ├── AppUser.cs
│   │   ├── ShareLink.cs
│   │   ├── Family.cs
│   │   ├── FamilyMember.cs
│   │   └── FamilyMedia.cs
│   └── Enums/
│       ├── MediaType.cs
│       └── ProcessingStatus.cs
├── src/CleanSweep.Application/
│   ├── Interfaces/
│   │   ├── IBlobStorageService.cs
│   │   ├── IMediaRepository.cs
│   │   ├── IAlbumRepository.cs
│   │   ├── IShareLinkRepository.cs
│   │   ├── IUserRepository.cs
│   │   ├── IFamilyRepository.cs
│   │   ├── IMediaProcessingQueue.cs
│   │   ├── ITranscodeQueue.cs
│   │   ├── ITranscoder.cs
│   │   ├── IMetadataExtractor.cs
│   │   ├── IThumbnailGenerator.cs
│   │   ├── INotificationService.cs
│   │   └── ICurrentUserService.cs
│   ├── DTOs/
│   │   ├── MediaItemDto.cs
│   │   ├── AlbumDto.cs
│   │   ├── FamilyDto.cs
│   │   ├── StorageUsageDto.cs
│   │   ├── MediaMetadata.cs
│   │   ├── MediaStatusUpdate.cs
│   │   ├── PaginatedResult.cs
│   │   ├── ProcessingMessage.cs
│   │   ├── TranscodeMessage.cs
│   │   ├── TranscodeResult.cs
│   │   ├── QueueItem.cs
│   │   ├── UploadRequest.cs
│   │   └── UploadCompleteResult.cs
│   ├── Services/
│   │   ├── UploadService.cs
│   │   ├── MediaService.cs
│   │   ├── BrowseService.cs
│   │   ├── AlbumService.cs
│   │   ├── ShareService.cs
│   │   └── FamilyService.cs
│   ├── Configuration/
│   │   ├── StorageOptions.cs
│   │   ├── QueueOptions.cs
│   │   ├── TranscodeOptions.cs
│   │   ├── UploadOptions.cs
│   │   └── QuotaOptions.cs
│   ├── Helpers/
│   │   └── BlobPathGenerator.cs
│   └── DependencyInjection.cs
├── src/CleanSweep.Infrastructure/
│   ├── Persistence/
│   │   ├── AppDbContext.cs
│   │   ├── Configurations/ (8 EF configs)
│   │   └── Repositories/
│   │       ├── MediaRepository.cs
│   │       ├── AlbumRepository.cs
│   │       ├── ShareLinkRepository.cs
│   │       ├── UserRepository.cs
│   │       └── FamilyRepository.cs
│   ├── Storage/
│   │   └── AzureBlobStorageService.cs
│   ├── Queue/
│   │   ├── AzureMediaProcessingQueue.cs
│   │   └── AzureTranscodeQueue.cs
│   ├── Processing/
│   │   ├── ExifMetadataExtractor.cs
│   │   ├── ImageThumbnailGenerator.cs
│   │   ├── HeicThumbnailGenerator.cs
│   │   ├── VideoThumbnailGenerator.cs
│   │   └── AciTranscoder.cs
│   ├── Notifications/
│   │   ├── SignalRNotificationService.cs
│   │   └── MediaHub.cs (base hub)
│   ├── Identity/
│   │   └── CurrentUserService.cs
│   ├── Migrations/
│   └── DependencyInjection.cs
└── src/CleanSweep.API/
    ├── Program.cs
    ├── Controllers/
    │   ├── MediaController.cs
    │   ├── AlbumController.cs
    │   ├── ShareController.cs
    │   ├── FamilyController.cs
    │   ├── QuotaController.cs
    │   └── AdminController.cs
    ├── BackgroundServices/
    │   ├── ProcessingBackgroundService.cs
    │   └── TranscodeBackgroundService.cs
    ├── Hubs/
    │   └── MediaHub.cs (authorized, inherits Infrastructure MediaHub)
    ├── Middleware/
    │   ├── CorrelationIdMiddleware.cs
    │   ├── RequestLoggingMiddleware.cs
    │   └── ExceptionHandlingMiddleware.cs
    ├── Auth/
    │   └── DevAuthHandler.cs
    └── Properties/
        └── launchSettings.json
```

### 2.2 Domain

#### Entities

**MediaItem**

| Field | Type | Notes |
|-------|------|-------|
| Id | Guid | PK |
| UserId | string | FK → AppUser |
| FileName | string | Original filename |
| MediaType | MediaType | Photo=0, Video=1 |
| OriginalBlobPath | string | Path in `originals` container |
| PlaybackBlobPath | string? | Path in `playback` (or same as original) |
| ThumbnailBlobPath | string? | Path in `thumbnails` |
| ContentType | string | MIME type |
| FileSizeBytes | long | Original file size |
| Width | int? | Pixels, extracted from metadata |
| Height | int? | Pixels, extracted from metadata |
| DurationSeconds | double? | Video duration |
| SourceCodec | string? | e.g. "h264", "hevc" |
| ContentHash | string? | Reserved for dedup |
| CapturedAt | DateTimeOffset? | EXIF date taken |
| UploadedAt | DateTimeOffset | Server timestamp |
| ProcessingStatus | ProcessingStatus | State machine |
| IsDeleted | bool | Soft delete flag |

**Album**

| Field | Type | Notes |
|-------|------|-------|
| Id | Guid | PK |
| UserId | string | FK → AppUser (creator) |
| Name | string | Album title |
| Description | string? | Optional |
| CoverMediaId | Guid? | FK → MediaItem |
| CoverThumbnailUrl | string? | Cached cover URL |
| FamilyId | Guid? | FK → Family (null = personal) |
| CreatedAt | DateTimeOffset | |

**AlbumMedia** (join table)

| Field | Type | Notes |
|-------|------|-------|
| AlbumId | Guid | Composite PK, FK → Album |
| MediaId | Guid | Composite PK, FK → MediaItem |
| SortOrder | int | Position in album |

**AppUser**

| Field | Type | Notes |
|-------|------|-------|
| Id | string | PK (Azure AD Object ID) |
| Email | string | |
| DisplayName | string | |
| FirstSeenAt | DateTimeOffset | First login |
| LastSeenAt | DateTimeOffset | Last login |
| QuotaBytes | long | Default 50 GB (53,687,091,200) |

**ShareLink**

| Field | Type | Notes |
|-------|------|-------|
| Id | Guid | PK |
| Token | string | Unique URL-safe token |
| AlbumId | Guid? | FK → Album (one of album/media must be set) |
| MediaId | Guid? | FK → MediaItem |
| CreatedByUserId | string | FK → AppUser |
| ExpiresAt | DateTimeOffset | Expiry timestamp |
| CreatedAt | DateTimeOffset | |

**Family**

| Field | Type | Notes |
|-------|------|-------|
| Id | Guid | PK |
| Name | string | Family group name |
| CreatedByUserId | string | FK → AppUser |
| InviteCode | string? | 8-char code for joining |
| InviteExpiresAt | DateTimeOffset? | Invite expiry |
| QuotaBytes | long | Default 200 GB |
| CreatedAt | DateTimeOffset | |

**FamilyMember** (join table)

| Field | Type | Notes |
|-------|------|-------|
| FamilyId | Guid | Composite PK, FK → Family |
| UserId | string | Composite PK, FK → AppUser |
| Role | string | "admin" or "member" |
| JoinedAt | DateTimeOffset | |

**FamilyMedia** (join table)

| Field | Type | Notes |
|-------|------|-------|
| FamilyId | Guid | Composite PK, FK → Family |
| MediaId | Guid | Composite PK, FK → MediaItem |
| SharedByUserId | string | FK → AppUser |
| SharedAt | DateTimeOffset | |

#### Enums

**MediaType**

| Value | Name |
|-------|------|
| 0 | Photo |
| 1 | Video |

**ProcessingStatus**

| Value | Name | Description |
|-------|------|-------------|
| 0 | Uploading | SAS URL issued, client uploading |
| 1 | Pending | Upload confirmed, queued for processing |
| 2 | Processing | Metadata extraction + thumbnail generation |
| 3 | Transcoding | HEVC → H.264 via ACI |
| 4 | Complete | Ready for playback |
| 5 | Failed | Processing or transcode failed |

### 2.3 Application

#### Interfaces (13)

**IBlobStorageService**
```csharp
Task<Uri> GenerateWriteSasUriAsync(string containerName, string blobPath, string contentType, TimeSpan expiry, CancellationToken ct);
Task<Uri> GenerateReadSasUriAsync(string containerName, string blobPath, TimeSpan expiry, CancellationToken ct);
Task UploadAsync(Stream content, string containerName, string blobPath, string contentType, CancellationToken ct);
Task<Stream> DownloadAsync(string containerName, string blobPath, CancellationToken ct);
Task DeleteAsync(string containerName, string blobPath, CancellationToken ct);
Task<bool> ExistsAsync(string containerName, string blobPath, CancellationToken ct);
Task<long> GetBlobSizeAsync(string containerName, string blobPath, CancellationToken ct);
```

**IMediaRepository**
```csharp
Task<MediaItem> AddAsync(MediaItem item, CancellationToken ct);
Task<MediaItem?> GetByIdAsync(Guid id, CancellationToken ct);
Task<PaginatedResult<MediaItem>> BrowseAsync(string userId, int page, int pageSize, MediaType? type, DateTimeOffset? from, DateTimeOffset? to, string? sort, CancellationToken ct);
Task<List<MediaItem>> GetStuckItemsAsync(TimeSpan stuckThreshold, int limit, CancellationToken ct);
Task UpdateAsync(MediaItem item, CancellationToken ct);
Task SoftDeleteAsync(Guid id, CancellationToken ct);
Task<long> GetUserStorageUsageAsync(string userId, CancellationToken ct);
```

**IAlbumRepository**
```csharp
Task<Album> AddAsync(Album album, CancellationToken ct);
Task<Album?> GetByIdWithMediaAsync(Guid id, CancellationToken ct);
Task<List<Album>> GetByUserIdAsync(string userId, CancellationToken ct);
Task UpdateAsync(Album album, CancellationToken ct);
Task DeleteAsync(Guid id, CancellationToken ct);
Task AddMediaAsync(Guid albumId, Guid mediaId, int sortOrder, CancellationToken ct);
Task RemoveMediaAsync(Guid albumId, Guid mediaId, CancellationToken ct);
```

**IShareLinkRepository**
```csharp
Task<ShareLink> AddAsync(ShareLink link, CancellationToken ct);
Task<ShareLink?> GetByTokenAsync(string token, CancellationToken ct);
Task DeleteExpiredAsync(CancellationToken ct);
```

**IUserRepository**
```csharp
Task<AppUser?> GetByIdAsync(string azureAdObjectId, CancellationToken ct);
Task<AppUser> UpsertAsync(string azureAdObjectId, string email, string displayName, CancellationToken ct);
Task<List<AppUser>> GetAllAsync(CancellationToken ct);
```

**IFamilyRepository**
```csharp
Task<Family> AddAsync(Family family, CancellationToken ct);
Task<Family?> GetByIdAsync(Guid id, CancellationToken ct);
Task<Family?> GetByIdWithMembersAsync(Guid id, CancellationToken ct);
Task<Family?> GetByInviteCodeAsync(string code, CancellationToken ct);
Task<List<Family>> GetByUserIdAsync(string userId, CancellationToken ct);
Task UpdateAsync(Family family, CancellationToken ct);
Task DeleteAsync(Guid id, CancellationToken ct);
Task AddMemberAsync(FamilyMember member, CancellationToken ct);
Task RemoveMemberAsync(Guid familyId, string userId, CancellationToken ct);
Task AddMediaAsync(FamilyMedia media, CancellationToken ct);
Task RemoveMediaAsync(Guid familyId, Guid mediaId, CancellationToken ct);
Task<List<FamilyMedia>> GetFamilyMediaAsync(Guid familyId, int page, int pageSize, CancellationToken ct);
Task<int> GetFamilyMediaCountAsync(Guid familyId, CancellationToken ct);
Task<long> GetFamilyStorageUsageAsync(Guid familyId, CancellationToken ct);
Task<bool> IsMemberAsync(Guid familyId, string userId, CancellationToken ct);
```

**IMediaProcessingQueue**
```csharp
Task EnqueueAsync(ProcessingMessage message, CancellationToken ct);
Task<QueueItem<ProcessingMessage>?> DequeueAsync(TimeSpan visibilityTimeout, CancellationToken ct);
Task CompleteAsync(string messageId, string popReceipt, CancellationToken ct);
```

**ITranscodeQueue**
```csharp
Task EnqueueAsync(TranscodeMessage message, CancellationToken ct);
Task<QueueItem<TranscodeMessage>?> DequeueAsync(TimeSpan visibilityTimeout, CancellationToken ct);
Task CompleteAsync(string messageId, string popReceipt, CancellationToken ct);
```

**ITranscoder**
```csharp
Task<TranscodeResult> TranscodeAsync(string sourceBlobPath, string targetBlobPath, CancellationToken ct);
```

**IMetadataExtractor**
```csharp
Task<MediaMetadata> ExtractAsync(Stream fileStream, string fileName, CancellationToken ct);
```

**IThumbnailGenerator**
```csharp
Task<Stream> GenerateAsync(Stream source, string contentType, int maxDimension = 300, CancellationToken ct);
bool CanHandle(string contentType);
```

**INotificationService**
```csharp
Task NotifyMediaStatusChangedAsync(string userId, MediaStatusUpdate update, CancellationToken ct);
```

**ICurrentUserService**
```csharp
string? UserId { get; }
string? Email { get; }
string? DisplayName { get; }
bool IsAuthenticated { get; }
bool IsOwner { get; }
```

#### DTOs (13)

| DTO | Key Fields |
|-----|-----------|
| MediaItemDto | Id, FileName, MediaType, ContentType, FileSizeBytes, Width, Height, DurationSeconds, CapturedAt, UploadedAt, ProcessingStatus, ThumbnailUrl, PlaybackUrl |
| AlbumDto | Id, Name, Description, CoverThumbnailUrl, MediaCount, CreatedAt |
| FamilyDto | Id, Name, InviteCode, MemberCount, MediaCount, StorageUsedBytes, QuotaBytes, Role, CreatedAt |
| StorageUsageDto | UsedBytes, QuotaBytes, UsedPercent (computed), UsedFormatted, QuotaFormatted |
| MediaMetadata | DateTaken, Width, Height, DurationSeconds, Codec |
| MediaStatusUpdate | MediaId, Status, ThumbnailUrl, PlaybackUrl |
| PaginatedResult\<T\> | Items, TotalCount, Page, PageSize, HasNextPage (computed) |
| ProcessingMessage | MediaId, BlobPath, ContentType, FileName, UserId, CorrelationId |
| TranscodeMessage | MediaId, SourceBlobPath, TargetBlobPath, SourceContainer, TargetContainer, UserId, CorrelationId |
| TranscodeResult | Success, OutputBlobPath, ErrorMessage |
| QueueItem\<T\> | Message, MessageId, PopReceipt |
| UploadRequest | MediaId, UploadUrl, BlobPath |
| UploadCompleteResult | MediaId, Status |

#### Services (6)

| Service | Responsibility |
|---------|---------------|
| UploadService | `RequestUploadAsync` — validates file, checks quota, generates blob path via `BlobPathGenerator`, creates `MediaItem` (status=Uploading), returns SAS URL. `CompleteUploadAsync` — verifies blob exists, updates status to Pending, enqueues `ProcessingMessage`. |
| MediaService | `DeleteMediaWithBlobsAsync` — soft-deletes record, removes original/thumbnail/playback blobs from Azure. |
| BrowseService | `BrowseAsync` — delegates to `IMediaRepository.BrowseAsync`, generates SAS URLs for thumbnail and playback of each item. |
| AlbumService | `GetAllAsync`, `CreateAsync`, `AddMediaAsync`, `RemoveMediaAsync`, `DeleteAlbumAsync` — CRUD operations on albums with optional cascading media deletion. |
| ShareService | `CreateShareLinkAsync` — generates a unique token with configurable expiry. `ValidateTokenAsync` — looks up and validates non-expired token. |
| FamilyService | `GetMyFamiliesAsync`, `CreateAsync`, `JoinByInviteCodeAsync`, `ShareMediaToFamilyAsync`, `UnshareMediaFromFamilyAsync`, `RemoveMemberAsync`, `DeleteFamilyAsync`, `RegenerateInviteCodeAsync` — full family lifecycle and media sharing. |

#### Configuration Classes (5)

**StorageOptions** (section: `Storage`)
- `ConnectionString` — Azure Storage connection string
- `OriginalsContainer` — default: `originals`
- `PlaybackContainer` — default: `playback`
- `ThumbnailsContainer` — default: `thumbnails`
- `ReadSasExpiryMinutes` — default: `15`
- `WriteSasExpiryMinutes` — default: `30`

**QueueOptions** (section: `Queue`)
- `ConnectionString` — Azure Storage connection string
- `MediaProcessingQueue` — default: `media-processing`
- `TranscodeQueue` — default: `transcode-jobs`
- `ProcessingVisibilityTimeoutSeconds` — default: `300` (5 min)
- `TranscodeVisibilityTimeoutSeconds` — default: `1800` (30 min)
- `MaxDequeueCount` — default: `5`

**TranscodeOptions** (section: `Transcode`)
- `ResourceGroup` — ACI resource group
- `Location` — default: `centralindia`
- `FfmpegImage` — default: `jrottenberg/ffmpeg:latest`
- `CpuCores` — default: `1`
- `MemoryGb` — default: `1.5`
- `Crf` — default: `23`
- `Preset` — default: `medium`

**UploadOptions** (section: `Upload`)
- `MaxFileSizeBytes` — default: `5,368,709,120` (5 GB)
- `AllowedExtensions` — `.jpg`, `.jpeg`, `.png`, `.heic`, `.heif`, `.mp4`, `.mov`, `.m4v`
- `AllowedContentTypes` — `image/jpeg`, `image/png`, `image/heic`, `image/heif`, `video/mp4`, `video/quicktime`, `video/x-m4v`

**QuotaOptions** (section: `Quota`)
- `DefaultUserQuotaBytes` — default: `53,687,091,200` (50 GB)
- `DefaultFamilyQuotaBytes` — default: `214,748,364,800` (200 GB)

#### BlobPathGenerator

Static helper that produces hash-partitioned blob paths:

```csharp
public static string Generate(Guid id, string extension)
{
    var hex = id.ToString("N");
    return $"{hex[0..2]}/{hex[2..4]}/{hex[4..6]}/{hex[6..8]}/{hex}{extension}";
}
```

Example: `a1/b2/c3/d4/a1b2c3d4e5f678901234567890abcdef.jpg`

### 2.4 Infrastructure

#### Persistence

**AppDbContext** — EF Core `DbContext` with `DbSet<>` for all 8 entity types. Uses `UseSnakeCaseNamingConvention()` for PostgreSQL column names.

**Entity Configurations (8):** One `IEntityTypeConfiguration<T>` per entity, defining:
- Table names (snake_case)
- Primary keys (composite for join tables)
- Indexes (e.g., `UserId` on `media_items`, `Token` on `share_links`)
- Foreign key relationships and cascade behavior
- Value conversions (e.g., enum → integer storage)

**Repositories (5):**

| Repository | Interface | Key Operations |
|-----------|-----------|----------------|
| MediaRepository | IMediaRepository | Paginated browse with sort/filter, soft delete, storage usage aggregation |
| AlbumRepository | IAlbumRepository | CRUD with eager-loading of `AlbumMedia.Media` |
| ShareLinkRepository | IShareLinkRepository | Token lookup, expired link cleanup |
| UserRepository | IUserRepository | Upsert on login (creates or updates user) |
| FamilyRepository | IFamilyRepository | Full CRUD, member/media management, storage aggregation |

#### Storage

**AzureBlobStorageService** — implements `IBlobStorageService` using `Azure.Storage.Blobs`. Creates `BlobServiceClient` from connection string, generates SAS tokens using `BlobSasBuilder` with read/write permissions and configurable expiry.

#### Queues

**AzureMediaProcessingQueue** — implements `IMediaProcessingQueue`. Uses `Azure.Storage.Queues.QueueClient` for the `media-processing` queue. Messages serialized as JSON with Base64 encoding.

**AzureTranscodeQueue** — implements `ITranscodeQueue`. Same pattern, uses `transcode-jobs` queue.

#### Processing

**ExifMetadataExtractor** — implements `IMetadataExtractor`. Uses `MetadataExtractor` NuGet package to read EXIF from JPEG/PNG/HEIC. Returns `MediaMetadata` with date taken, dimensions, codec.

**ImageThumbnailGenerator** — implements `IThumbnailGenerator`. Handles `image/jpeg`, `image/png`. Uses `SkiaSharp` to resize to max 300px dimension, outputs JPEG.

**HeicThumbnailGenerator** — implements `IThumbnailGenerator`. Handles `image/heic`, `image/heif`. Uses `Magick.NET` for HEIC decoding + thumbnail generation.

**VideoThumbnailGenerator** — implements `IThumbnailGenerator`. Handles `video/mp4`, `video/quicktime`, `video/x-m4v`. Extracts a frame using `FFMediaToolkit` and outputs a JPEG thumbnail.

**AciTranscoder** — implements `ITranscoder`. Placeholder implementation for Azure Container Instances (ACI) FFmpeg transcoding. Currently returns `TranscodeResult { Success = false, ErrorMessage = "ACI transcoding not yet implemented" }`.

#### Notifications

**SignalRNotificationService** — implements `INotificationService`. Uses `IHubContext<MediaHub>` to send `MediaStatusChanged` events to specific users via their user ID group.

**MediaHub** (Infrastructure) — base SignalR hub class. The API project's `MediaHub` inherits from this and applies `[Authorize]`.

#### Identity

**CurrentUserService** — implements `ICurrentUserService`. Reads claims from `HttpContext.User`:
- `UserId` from `objectidentifier` or `NameIdentifier` claim
- `Email` from `preferred_username` claim
- `DisplayName` from `name` claim
- `IsOwner` from `role == "owner"` claim

#### DI Registration

`AddInfrastructure(IConfiguration)` registers:
- `AppDbContext` via `UseNpgsql` + `UseSnakeCaseNamingConvention`
- 5 repositories (scoped)
- `AzureBlobStorageService` (singleton)
- 2 queue services (singleton)
- `AciTranscoder` (scoped)
- `SignalRNotificationService` (scoped)
- `ExifMetadataExtractor` (scoped)
- 3 thumbnail generators — `ImageThumbnailGenerator`, `HeicThumbnailGenerator`, `VideoThumbnailGenerator` (all scoped, all registered as `IThumbnailGenerator`)
- `CurrentUserService` (scoped)

### 2.5 API

#### Program.cs Bootloader

Seven-step startup sequence:

1. **Configuration** — Binds `StorageOptions`, `QueueOptions`, `TranscodeOptions`, `UploadOptions`, `QuotaOptions` to `IOptions<T>`
2. **Logging** — Clears providers, adds Console; adds `AzureWebAppDiagnostics` in production
3. **Application + Infrastructure DI** — Calls `AddApplication()` and `AddInfrastructure(config)`
4. **Background Services** — Registers `ProcessingBackgroundService` and `TranscodeBackgroundService` as hosted services
5. **Auth** — Checks `AzureAd:Enabled`; if true → `AddMicrosoftIdentityWebApi`; if false → `AddScheme<DevAuthHandler>`
6. **SignalR + Controllers + CORS** — Adds SignalR, controllers, Swagger, CORS (localhost:3000)
7. **Middleware Pipeline** — CorrelationId → RequestLogging → ExceptionHandling → CORS → Swagger (dev) → Auth → StaticFiles → MapControllers → MapHub → MapFallback

#### Controllers (6)

**MediaController** (`/api/media`, `[Authorize]`)
- `POST upload/request` — body: `{ fileName, contentType, sizeBytes }` → `UploadRequest`
- `POST upload/complete` — body: `{ mediaId }` → `UploadCompleteResult`
- `GET` — query: `page, pageSize, type, from, to, sort` → `PaginatedResult<MediaItemDto>`
- `GET {id}/download` → `{ downloadUrl, fileName }`
- `DELETE {id}` — `[Authorize(Roles = "owner")]` → 204
- `POST delete-batch` — `[Authorize(Roles = "owner")]`, body: `{ mediaIds }` → 204
- `POST download-batch` — body: `{ mediaIds }` → `{ downloadUrl, fileName }` (ZIP if multiple)

**AlbumController** (`/api/album`, `[Authorize]`)
- `GET` → `List<AlbumDto>`
- `GET {albumId}` → `{ album: AlbumDto, media: MediaItemDto[] }` (with SAS URLs)
- `POST` — body: `{ name, description }` → `AlbumDto`
- `POST {albumId}/media` — body: `{ mediaIds }` → 200
- `DELETE {albumId}/media/{mediaId}` → 204
- `DELETE {albumId}?deleteMedia=bool` — `[Authorize(Roles = "owner")]` → 204

**ShareController** (`/api/share`)
- `POST` — `[Authorize]`, body: `{ albumId?, mediaId?, expiryHours }` → `{ token }`
- `GET {token}` — `[AllowAnonymous]` → `{ albumId, mediaId, expiresAt }`

**FamilyController** (`/api/family`, `[Authorize]`)
- `GET` → `List<FamilyDto>`
- `POST` — body: `{ name }` → `FamilyDto`
- `POST join` — body: `{ inviteCode }` → `{ familyName }`
- `POST {familyId}/share` — body: `{ mediaIds }` → 200
- `DELETE {familyId}/media/{mediaId}` → 204
- `GET {familyId}/media` — query: `page, pageSize` → `PaginatedResult<MediaItemDto>` (with SAS URLs)
- `DELETE {familyId}/members/{userId}` → 204
- `DELETE {familyId}` — `[Authorize(Roles = "owner")]` → 204
- `POST {familyId}/invite` — body: `{ expiryDays }` → `{ inviteCode }`

**QuotaController** (`/api/quota`, `[Authorize]`)
- `GET` → `StorageUsageDto`
- `PUT users/{userId}/quota` — `[Authorize(Roles = "owner")]`, body: `{ quotaBytes }` → `{ userId, quotaBytes }`

**AdminController** (`/api/admin`, `[Authorize(Roles = "owner")]`)
- `GET users` → list of `{ id, email, displayName, firstSeenAt, lastSeenAt, quotaBytes, usedBytes, mediaCount }`
- `POST reset` — deletes all blobs + all DB data → `{ message }`
- `POST reprocess` — sets Complete/Failed items to Pending, re-enqueues → `{ message }`

#### Middleware (3)

| Middleware | Purpose |
|-----------|---------|
| CorrelationIdMiddleware | Reads `X-Correlation-ID` header or generates one; stores in `HttpContext.Items`; adds to response headers; creates log scope |
| RequestLoggingMiddleware | Logs `→ METHOD /path` on entry and `← METHOD /path STATUS ms` on exit with `Stopwatch` timing |
| ExceptionHandlingMiddleware | Catches exceptions and maps to HTTP status codes: `ArgumentException` → 400, `KeyNotFoundException` → 404, `UnauthorizedAccessException` → 401, `InvalidOperationException` → 409, unhandled → 500 |

#### Background Services (2)

**ProcessingBackgroundService** — `BackgroundService` that polls `media-processing` queue:
1. Dequeues message with configurable visibility timeout (default 300s)
2. Looks up `MediaItem`, sets status to `Processing`
3. Downloads blob to temp file on disk (not RAM — handles large files)
4. Extracts metadata via `IMetadataExtractor` (date taken, dimensions, codec)
5. Generates thumbnail via `IThumbnailGenerator` (selects handler by content type), uploads to `thumbnails` container
6. If HEVC video → sets status to `Transcoding`, enqueues `TranscodeMessage`
7. Otherwise → sets `PlaybackBlobPath = OriginalBlobPath`, status to `Complete`
8. Sends SignalR notification via `INotificationService`
9. Cleans up temp file in `finally` block
10. On empty queue, waits 2 seconds before polling again

**TranscodeBackgroundService** — `BackgroundService` that polls `transcode-jobs` queue:
1. Dequeues message with configurable visibility timeout (default 1800s)
2. Invokes `ITranscoder.TranscodeAsync`
3. On success → sets `PlaybackBlobPath`, status to `Complete`
4. On failure → sets status to `Failed`
5. Sends SignalR notification
6. On empty queue, waits 5 seconds

#### MediaHub

The API's `MediaHub` inherits from `Infrastructure.Notifications.MediaHub` and applies `[Authorize]`. Mapped to `/hubs/media`. The SignalR notification service sends events to user-specific groups.

#### DevAuthHandler

Custom `AuthenticationHandler<AuthenticationSchemeOptions>` that auto-authenticates every request with a fixed identity:
- UserId: `dev-user-001`
- Email: `dev@cleansweep.local`
- DisplayName: `Dev User`
- Role: `owner`

Activated when `AzureAd:Enabled = false`.

### 2.6 Database Schema

All tables use snake_case naming. PostgreSQL with EF Core + `UseSnakeCaseNamingConvention()`.

#### Table: `users`

| Column | Type | Constraints |
|--------|------|-------------|
| id | text | PK |
| email | text | NOT NULL |
| display_name | text | NOT NULL |
| first_seen_at | timestamptz | NOT NULL |
| last_seen_at | timestamptz | NOT NULL |
| quota_bytes | bigint | NOT NULL, DEFAULT 53687091200 |

#### Table: `media_items`

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| user_id | text | NOT NULL, FK → users(id) |
| file_name | text | NOT NULL |
| media_type | integer | NOT NULL |
| original_blob_path | text | NOT NULL |
| playback_blob_path | text | |
| thumbnail_blob_path | text | |
| content_type | text | NOT NULL |
| file_size_bytes | bigint | NOT NULL |
| width | integer | |
| height | integer | |
| duration_seconds | double precision | |
| source_codec | text | |
| content_hash | text | |
| captured_at | timestamptz | |
| uploaded_at | timestamptz | NOT NULL |
| processing_status | integer | NOT NULL |
| is_deleted | boolean | NOT NULL, DEFAULT false |

Indexes: `ix_media_items_user_id`

#### Table: `albums`

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| user_id | text | NOT NULL, FK → users(id) |
| name | text | NOT NULL |
| description | text | |
| cover_media_id | uuid | FK → media_items(id) |
| cover_thumbnail_url | text | |
| family_id | uuid | FK → families(id) |
| created_at | timestamptz | NOT NULL |

#### Table: `album_media`

| Column | Type | Constraints |
|--------|------|-------------|
| album_id | uuid | PK (composite), FK → albums(id) ON DELETE CASCADE |
| media_id | uuid | PK (composite), FK → media_items(id) |
| sort_order | integer | NOT NULL |

#### Table: `share_links`

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| token | text | NOT NULL, UNIQUE |
| album_id | uuid | FK → albums(id) |
| media_id | uuid | FK → media_items(id) |
| created_by_user_id | text | NOT NULL, FK → users(id) |
| expires_at | timestamptz | NOT NULL |
| created_at | timestamptz | NOT NULL |

Indexes: `ix_share_links_token` (unique)

#### Table: `families`

| Column | Type | Constraints |
|--------|------|-------------|
| id | uuid | PK |
| name | text | NOT NULL |
| created_by_user_id | text | NOT NULL, FK → users(id) |
| invite_code | text | |
| invite_expires_at | timestamptz | |
| quota_bytes | bigint | NOT NULL, DEFAULT 214748364800 |
| created_at | timestamptz | NOT NULL |

#### Table: `family_members`

| Column | Type | Constraints |
|--------|------|-------------|
| family_id | uuid | PK (composite), FK → families(id) ON DELETE CASCADE |
| user_id | text | PK (composite), FK → users(id) |
| role | text | NOT NULL, DEFAULT 'member' |
| joined_at | timestamptz | NOT NULL |

#### Table: `family_media`

| Column | Type | Constraints |
|--------|------|-------------|
| family_id | uuid | PK (composite), FK → families(id) ON DELETE CASCADE |
| media_id | uuid | PK (composite), FK → media_items(id) |
| shared_by_user_id | text | NOT NULL, FK → users(id) |
| shared_at | timestamptz | NOT NULL |

### 2.7 Blob Storage

**Account:** `sacleansweep` (StorageV2, LRS, Central India, Cool tier)

**Containers:**

| Container | Purpose | Access |
|-----------|---------|--------|
| `originals` | Original uploaded files | Private (SAS only) |
| `playback` | Transcoded playback files (H.264) | Private (SAS only) |
| `thumbnails` | Generated thumbnail JPEGs (300px max) | Private (SAS only) |

**Path strategy:** Hash-partitioned using first 8 hex chars of the media GUID:
```
{hex[0..2]}/{hex[2..4]}/{hex[4..6]}/{hex[6..8]}/{guid}.{ext}
Example: a1/b2/c3/d4/a1b2c3d4e5f678901234567890abcdef.jpg
```

**Lifecycle policy:** None configured yet. Recommended: delete blobs in `temp-downloads/` after 1 day.

### 2.8 Queue Design

**Queue: `media-processing`**

Triggered by `POST /api/media/upload/complete`. Consumed by `ProcessingBackgroundService`.

Message payload (`ProcessingMessage`):
```json
{
  "mediaId": "guid",
  "blobPath": "a1/b2/c3/d4/guid.jpg",
  "contentType": "image/jpeg",
  "fileName": "photo.jpg",
  "userId": "azure-ad-oid",
  "correlationId": "hex32"
}
```

- Visibility timeout: 300 seconds (5 min)
- Max dequeue count: 5

**Queue: `transcode-jobs`**

Triggered by `ProcessingBackgroundService` when HEVC video detected. Consumed by `TranscodeBackgroundService`.

Message payload (`TranscodeMessage`):
```json
{
  "mediaId": "guid",
  "sourceBlobPath": "a1/b2/c3/d4/guid.mov",
  "targetBlobPath": "a1/b2/c3/d4/guid.mp4",
  "sourceContainer": "originals",
  "targetContainer": "playback",
  "userId": "azure-ad-oid",
  "correlationId": "hex32"
}
```

- Visibility timeout: 1800 seconds (30 min)
- Max dequeue count: 5

### 2.9 Processing Pipeline

State machine for `ProcessingStatus`:

```
Uploading ──(upload/complete)──► Pending ──(dequeue)──► Processing
                                                            │
                                    ┌───────────────────────┤
                                    │                       │
                                    ▼                       ▼
                               Transcoding             Complete
                                    │                  (non-HEVC: PlaybackBlobPath = OriginalBlobPath)
                                    │
                              ┌─────┴─────┐
                              ▼           ▼
                          Complete     Failed
                     (PlaybackBlobPath
                      = transcoded MP4)
```

Processing step details:
1. Download original blob to temp file on disk (`/tmp/cleansweep/{id}.ext`)
2. Extract metadata: EXIF date taken, width, height, duration, codec
3. Generate thumbnail: select handler by content type → resize to 300px max → upload JPEG to `thumbnails` container
4. Determine if transcoding needed: `MediaType == Video && SourceCodec contains "hevc"`
5. If yes → enqueue `TranscodeMessage`, set status = `Transcoding`
6. If no → set `PlaybackBlobPath = OriginalBlobPath`, status = `Complete`
7. Clean up temp file (`finally` block)
8. Send SignalR notification

### 2.10 Auth

#### Azure AD Flow

1. User opens app → MSAL.js checks localStorage for cached token
2. If no token → redirect to `login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`
3. User authenticates → redirect back with auth code
4. MSAL.js exchanges code for tokens → stores in localStorage
5. Every API call → axios interceptor calls `acquireTokenSilent` → attaches Bearer token
6. API validates JWT via `Microsoft.Identity.Web` (`AddMicrosoftIdentityWebApi`)

#### DevAuth

When `AzureAd:Enabled = false`, `DevAuthHandler` authenticates all requests with a fixed identity (userId: `dev-user-001`, role: `owner`).

#### Role-Based Access Matrix

| Endpoint | owner | viewer (authenticated) | anonymous |
|----------|-------|----------------------|-----------|
| Upload, browse, download | ✓ | ✓ | ✗ |
| Delete media, batch delete | ✓ | ✗ | ✗ |
| Delete album | ✓ | ✗ | ✗ |
| Delete family | ✓ | ✗ | ✗ |
| Admin (users, reset, reprocess) | ✓ | ✗ | ✗ |
| Set quota | ✓ | ✗ | ✗ |
| Albums CRUD (non-delete) | ✓ | ✓ | ✗ |
| Families CRUD (non-delete) | ✓ | ✓ | ✗ |
| Share link creation | ✓ | ✓ | ✗ |
| Access share link | ✓ | ✓ | ✓ |

---

## 3. Frontend

### 3.1 Structure

```
client/src/
├── App.tsx                      # MsalProvider + routing + auth gate
├── main.tsx                     # React entry point
├── index.css                    # Tailwind CSS imports
├── auth/
│   └── msalConfig.ts            # MSAL PublicClientApplication config
├── api/
│   ├── client.ts                # Axios instance + MSAL token interceptor
│   ├── mediaApi.ts              # Media CRUD + upload + download functions
│   ├── albumApi.ts              # Album CRUD functions
│   └── familyApi.ts             # Family, quota, admin API functions
├── stores/
│   ├── taskStore.ts             # Zustand background task store
│   └── toastStore.ts            # Zustand toast notification store
├── hooks/
│   ├── useMedia.ts              # React Query infinite scroll hook
│   ├── useUpload.ts             # Upload with SAS + auto-retry
│   ├── useSignalR.ts            # SignalR connection + query invalidation
│   └── useTrackedTask.ts        # Background task wrapper
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx         # Sidebar nav (Lucide icons) + quota bar + user menu
│   │   ├── TaskPanel.tsx        # Floating task progress panel
│   │   ├── ToastBar.tsx         # Top-bar slide-down toast notifications
│   │   └── GlobalDropZone.tsx   # App-wide drag-and-drop overlay
│   └── media/
│       ├── MediaGrid.tsx        # Date-grouped photo/video grid
│       ├── MediaCard.tsx        # Thumbnail card with hover actions
│       ├── MediaUploader.tsx    # File picker + folder upload + progress UI
│       └── MediaViewer.tsx      # Full-screen lightbox with arrow nav + share button
├── pages/
│   ├── GalleryPage.tsx          # Main gallery with sort/select/batch
│   ├── UploadPage.tsx           # Upload interface
│   ├── AlbumsPage.tsx           # Album list + create
│   ├── AlbumDetailPage.tsx      # Album media view
│   ├── FamiliesPage.tsx         # Family management
│   ├── FamilyMediaPage.tsx      # Family shared media browser with sort/select
│   ├── SharedPage.tsx           # Public anonymous shared media viewer
│   ├── JoinPage.tsx             # Invite link handler (/join/:code)
│   └── AdminPage.tsx            # Admin panel
└── types/
    └── media.ts                 # TypeScript interfaces
```

### 3.2 Auth

**msalConfig.ts:**
- `clientId`: `572f7365-b23b-4ec7-b5bd-979c51eca7b4`
- `authority`: `https://login.microsoftonline.com/142f4152-4ed6-4d13-8909-1af6bfa0b659`
- `redirectUri`: `window.location.origin`
- `cacheLocation`: `localStorage`
- Login scope: `api://572f7365-b23b-4ec7-b5bd-979c51eca7b4/access`

**Token interceptor** (client.ts): Axios request interceptor calls `msalInstance.acquireTokenSilent()` for the first account, sets `Authorization: Bearer {token}` header.

**App.tsx:** Wraps app in `MsalProvider`. Uses `AuthenticatedTemplate` for the main app and `UnauthenticatedTemplate` for a login page with `loginRedirect()`.

### 3.3 API Client

**mediaApi** (mediaApi.ts):
- `browse(page, pageSize, type?, from?, to?, sort?)` → `PaginatedResult<MediaItem>`
- `requestUpload(fileName, contentType, sizeBytes)` → `UploadRequestResponse`
- `completeUpload(mediaId)` → response data
- `download(id)` → force-downloads via blob fetch + object URL
- `deleteMedia(id)` → DELETE
- `deleteBatch(ids)` → POST delete-batch
- `downloadBatch(ids)` → POST download-batch + force-download
- `resetAll()` → POST admin/reset

**albumApi** (albumApi.ts):
- `getAll()` → `Album[]`
- `getById(albumId)` → `AlbumDetail { album, media }`
- `create(name, description?)` → `Album`
- `deleteAlbum(albumId, deleteMedia)` → DELETE
- `addMedia(albumId, mediaIds)` → POST
- `removeMedia(albumId, mediaId)` → DELETE

**familyApi** (familyApi.ts):
- `getMyFamilies()` → `FamilyDto[]`
- `create(name)` → `FamilyDto`
- `join(inviteCode)` → `{ familyName }`
- `shareMedia(familyId, mediaIds)` → POST
- `unshareMedia(familyId, mediaId)` → DELETE
- `getFamilyMedia(familyId, page, pageSize)` → paginated response
- `removeMember(familyId, userId)` → DELETE
- `deleteFamily(familyId)` → DELETE
- `regenerateInvite(familyId, expiryDays)` → `{ inviteCode }`

**shareApi** (mediaApi.ts):
- `create(mediaId?, albumId?, expiryHours?)` → `{ token }` — creates a public share link
- `getByToken(token)` → `{ albumId?, mediaId?, expiresAt }` — validates a share token

**quotaApi** (familyApi.ts):
- `getMyUsage()` → `StorageUsageDto`
- `setUserQuota(userId, quotaBytes)` → PUT

**adminApi** (familyApi.ts):
- `getUsers()` → user list with stats
- `resetAll()` → POST
- `reprocess()` → `{ message }`

### 3.4 State Management

**React Query** (TanStack Query v5):
- `useMediaBrowse(pageSize, type?, sort?)` — infinite scroll query with `getNextPageParam`
- Query key: `['media', { pageSize, type, sort }]`
- SignalR `MediaStatusChanged` events invalidate `['media']` queries

**Zustand** (`taskStore.ts`):
- `BackgroundTask { id, label, status, progress, error, createdAt }`
- `TaskStatus`: `running` | `done` | `error`
- Actions: `addTask`, `updateTask`, `removeTask`, `clearDone`, `toggle`, `setOpen`
- `isOpen` auto-opens when a new task is added

### 3.5 Components

| Component | Purpose | Key Props/Behavior |
|-----------|---------|-------------------|
| AppShell | Layout wrapper | Sidebar with nav links, quota progress bar, user menu with logout |
| TaskPanel | Floating panel | Shows background task list (uploads, batch ops), progress bars, clear done |
| GlobalDropZone | Drag overlay | Wraps entire app, detects file drops, triggers upload flow |
| MediaGrid | Photo grid | Groups items by date, renders MediaCard for each, handles selection |
| MediaCard | Thumbnail card | Shows thumbnail, hover reveals download/delete/share actions, click opens viewer |
| MediaUploader | Upload UI | File picker, **folder upload** (webkitdirectory), drag area, filters unsupported files, upload progress |
| MediaViewer | Lightbox | Full-screen overlay, arrow key navigation, video playback, **share button with expiry picker**, clipboard fallback |

### 3.6 Pages

| Page | Route | Data Fetching | Key Interactions |
|------|-------|--------------|-----------------|
| GalleryPage | `/` | `useMediaBrowse` with infinite scroll | Sort dropdown, multi-select, batch delete/download, share to album/family |
| UploadPage | `/upload` | — | MediaUploader with file & folder upload, progress tracking |
| AlbumsPage | `/albums` | `albumApi.getAll()` | Create album dialog, album grid with cover thumbnails |
| AlbumDetailPage | `/albums/:id` | `albumApi.getById()` | Media grid, add/remove media, delete album |
| FamiliesPage | `/families` | `familyApi.getMyFamilies()` | Create/join family, copy invite code/link, browse family media |
| FamilyMediaPage | `/families/:id` | `familyApi.getFamilyMedia()` | Sort, select, batch download, unshare media (any member) |
| SharedPage | `/shared/:token` | `shareApi.getByToken()` | Anonymous view of shared media with download |
| JoinPage | `/join/:code` | `familyApi.join()` | Auto-join family on auth, login prompt for anonymous |
| AdminPage | `/admin` | `adminApi.getUsers()` | User table with quota editing, reprocess button, reset button |

### 3.7 Upload Flow

1. User drops/selects files → `useUpload` hook creates `UploadItem[]` with status `queued`
2. Up to `MAX_CONCURRENT = 3` uploads run simultaneously
3. Per file: `mediaApi.requestUpload()` → SAS URL returned
4. XHR PUT to SAS URL with `x-ms-blob-type: BlockBlob` header, progress events update UI
5. `mediaApi.completeUpload(mediaId)` → API enqueues processing
6. On error → automatic retry with exponential backoff (`INITIAL_RETRY_DELAY = 1000ms`, doubles each attempt)
7. After `MAX_RETRIES = 3` failures → status set to `error` with message

### 3.8 SignalR

`useSignalR()` hook:
- Creates `HubConnection` to `{VITE_API_BASE_URL}/hubs/media`
- Auto-reconnect schedule: `[0, 2000, 5000, 10000, 30000]` ms
- Listens for:
  - `MediaStatusChanged` → invalidates `['media']`, `['album']`, `['quota']`
  - `MediaChanged` (broadcast) → invalidates all data queries (`media`, `albums`, `families`, `family-media`, `quota`, `admin-users`)
- Cleanup: stops connection on unmount

The backend broadcasts `MediaChanged` via `INotificationService.BroadcastMediaChangedAsync()` after: upload complete, media delete, family share/unshare.

### 3.9 Task Panel

`useTrackedTask()` hook wraps async operations:
- `runTask(label, fn)` — creates task in store, runs `fn`, updates status on completion/error
- `setProgress(taskId, progress)` — manual progress updates (0-100)
- `TaskPanel` component renders floating panel bottom-right showing all tasks with:
  - Running: spinner + progress bar
  - Done: checkmark
  - Error: red icon + message
  - "Clear done" button

---

## 4. Deployment & Infrastructure Configuration

### 4.1 Azure Resources

| Resource | Type | SKU | Region | Resource Group | Purpose |
|----------|------|-----|--------|---------------|---------|
| cleansweep-app | App Service | B2 Linux | Central India | rg-cleansweep | Hosts API + SPA |
| appserviceplan-linux | App Service Plan | B2 (2 vCPU, 3.5 GB) | Central India | rg-cleansweep | Compute plan |
| sacleansweep | Storage Account | StorageV2, LRS | Central India | rg-cleansweep | Blobs + queues |
| n8n-postgress | PostgreSQL Flexible Server | B1ms | East US | (shared) | Database (shared with n8n) |
| kv-cleansweep | Key Vault | Standard | Central India | rg-cleansweep | Secrets management |
| CleanSweep | App Registration | — | — | — | Azure AD auth |

### 4.2 Storage Configuration

**Containers:**
```bash
az storage container create -n originals --account-name sacleansweep
az storage container create -n playback  --account-name sacleansweep
az storage container create -n thumbnails --account-name sacleansweep
```

**CORS (for direct SAS uploads from browser):**
```bash
az storage cors add \
  --account-name sacleansweep \
  --services b \
  --methods PUT GET HEAD OPTIONS \
  --origins "https://cleansweep-app.azurewebsites.net" "http://localhost:3000" \
  --allowed-headers "*" \
  --exposed-headers "*" \
  --max-age 3600
```

**Lifecycle policy (recommended):**
```bash
az storage account management-policy create \
  --account-name sacleansweep \
  --policy '{"rules":[{"name":"cleanup-temp","type":"Lifecycle","definition":{"actions":{"baseBlob":{"delete":{"daysAfterCreationGreaterThan":1}}},"filters":{"blobTypes":["blockBlob"],"prefixMatch":["originals/temp-downloads/"]}}}]}'
```

### 4.3 PostgreSQL

**Server:** `n8n-postgress` (East US, B1ms, shared with n8n)
**Database:** `cleansweep`
**Auth:** Password-based (`dbadmin` user)

```bash
# Create database
az postgres flexible-server db create \
  --resource-group <rg> \
  --server-name n8n-postgress \
  --database-name cleansweep

# Firewall (allow Azure services)
az postgres flexible-server firewall-rule create \
  --resource-group <rg> \
  --name n8n-postgress \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# Apply EF Core migrations
cd src/CleanSweep.API
dotnet ef database update --project ../CleanSweep.Infrastructure
```

### 4.4 Key Vault

**Vault:** `kv-cleansweep` (Standard, Central India)

**Secrets:**

| Secret Name | Purpose |
|------------|---------|
| Postgres-ConnectionString | Full PostgreSQL connection string |
| Storage-ConnectionString | Azure Storage connection string |

**RBAC:**
```bash
# Grant managed identity access
az role assignment create \
  --role "Key Vault Secrets User" \
  --assignee <managed-identity-principal-id> \
  --scope /subscriptions/<sub>/resourceGroups/rg-cleansweep/providers/Microsoft.KeyVault/vaults/kv-cleansweep
```

**Secret rotation:** Manual. Update secret in Key Vault, restart App Service to pick up new value.

### 4.5 App Registration

- **Name:** CleanSweep
- **Client ID:** `572f7365-b23b-4ec7-b5bd-979c51eca7b4`
- **Tenant ID:** `142f4152-4ed6-4d13-8909-1af6bfa0b659`
- **Application ID URI:** `api://572f7365-b23b-4ec7-b5bd-979c51eca7b4`
- **Redirect URIs:** `https://cleansweep-app.azurewebsites.net`, `http://localhost:3000`

**Scopes:**
- `api://572f7365-b23b-4ec7-b5bd-979c51eca7b4/access` — default access scope

**App Roles:**

| Role | Value | Assign To |
|------|-------|-----------|
| Owner | `owner` | Users/Groups |
| Viewer | `viewer` | Users/Groups |

**Add users to roles:**
```bash
# Via Azure Portal: Enterprise Applications → CleanSweep → Users and groups → Add
# Or via Graph API:
az ad app show --id 572f7365-b23b-4ec7-b5bd-979c51eca7b4
```

### 4.6 App Service

**App Settings (all defined in App Service Configuration):**

| Setting | Source | Value |
|---------|--------|-------|
| `ConnectionStrings__Postgres` | Key Vault reference | `@Microsoft.KeyVault(SecretUri=...)` |
| `AzureAd__Enabled` | Direct | `true` |
| `AzureAd__Instance` | Direct | `https://login.microsoftonline.com/` |
| `AzureAd__TenantId` | Direct | `142f4152-4ed6-4d13-8909-1af6bfa0b659` |
| `AzureAd__ClientId` | Direct | `572f7365-b23b-4ec7-b5bd-979c51eca7b4` |
| `AzureAd__Audience` | Direct | `api://572f7365-b23b-4ec7-b5bd-979c51eca7b4` |
| `Storage__ConnectionString` | Key Vault reference | `@Microsoft.KeyVault(SecretUri=...)` |
| `Queue__ConnectionString` | Key Vault reference | `@Microsoft.KeyVault(SecretUri=...)` |
| `Transcode__ResourceGroup` | Direct | `rv-storage` |
| `Transcode__Location` | Direct | `centralindia` |

**Startup command:** `dotnet CleanSweep.API.dll`

**Managed Identity:** System-assigned, with `Key Vault Secrets User` role on `kv-cleansweep`.

### 4.7 Build & Deploy

**deploy.sh workflow:**
1. Build frontend: `cd client && npm run build`
2. Copy `dist/*` to `src/CleanSweep.API/wwwroot/`
3. Publish backend: `dotnet publish -c Release -o /tmp/cleansweep-publish`
4. ZIP: `cd /tmp/cleansweep-publish && zip -r /tmp/deploy.zip .`
5. Deploy: `az webapp deploy --resource-group rg-cleansweep --name cleansweep-app --src-path /tmp/deploy.zip --type zip`

**First-time setup steps:**
1. Create resource group: `az group create -n rg-cleansweep -l centralindia`
2. Create App Service Plan + App Service
3. Create Storage Account + containers + CORS
4. Create Key Vault + secrets + RBAC
5. Configure App Registration (client ID, scopes, roles, redirect URIs)
6. Set App Service configuration (settings referencing Key Vault)
7. Enable managed identity + assign Key Vault role
8. Run migrations
9. Run `deploy.sh`

### 4.8 Environment Configuration

| Setting | Development | Production |
|---------|------------|------------|
| AzureAd:Enabled | `false` | `true` |
| Storage:ConnectionString | `UseDevelopmentStorage=true` (Azurite) | Azure Storage connection string |
| Queue:ConnectionString | `UseDevelopmentStorage=true` (Azurite) | Azure Storage connection string |
| ConnectionStrings:Postgres | Local PostgreSQL | Azure Flexible Server (via Key Vault) |
| Logging:Default | `Information` | `Information` |
| Logging:EF | `Information` | `Warning` |
| Swagger | Enabled | Disabled |
| CORS Origins | `http://localhost:3000` | `https://cleansweep-app.azurewebsites.net` |
| VITE_API_BASE_URL | `http://localhost:5000` | (empty — relative to same origin) |

---

## 5. API Reference

### Media

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/media/upload/request` | Bearer | `{ fileName: string, contentType: string, sizeBytes: number }` | `{ mediaId: guid, uploadUrl: string, blobPath: string }` |
| POST | `/api/media/upload/complete` | Bearer | `{ mediaId: guid }` | `{ mediaId: guid, status: int }` |
| GET | `/api/media?page=1&pageSize=50&type=0&from=&to=&sort=` | Bearer | — | `{ items: MediaItemDto[], totalCount, page, pageSize, hasNextPage }` |
| GET | `/api/media/{id}/download` | Bearer | — | `{ downloadUrl: string, fileName: string }` |
| DELETE | `/api/media/{id}` | Owner | — | 204 |
| POST | `/api/media/delete-batch` | Owner | `{ mediaIds: guid[] }` | 204 |
| POST | `/api/media/download-batch` | Bearer | `{ mediaIds: guid[] }` | `{ downloadUrl: string, fileName: string }` |

### Albums

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/album` | Bearer | — | `AlbumDto[]` |
| GET | `/api/album/{id}` | Bearer | — | `{ album: AlbumDto, media: MediaItemDto[] }` |
| POST | `/api/album` | Bearer | `{ name: string, description?: string }` | `AlbumDto` |
| POST | `/api/album/{id}/media` | Bearer | `{ mediaIds: guid[] }` | 200 |
| DELETE | `/api/album/{id}/media/{mediaId}` | Bearer | — | 204 |
| DELETE | `/api/album/{id}?deleteMedia=bool` | Owner | — | 204 |

### Share

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| POST | `/api/share` | Bearer | `{ albumId?: guid, mediaId?: guid, expiryHours?: int }` | `{ token: string }` |
| GET | `/api/share/{token}` | Anonymous | — | `{ type: "media", expiresAt, media: MediaItemDto }` (with SAS URLs) |

### Families

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/family` | Bearer | — | `FamilyDto[]` |
| POST | `/api/family` | Bearer | `{ name: string }` | `FamilyDto` |
| POST | `/api/family/join` | Bearer | `{ inviteCode: string }` | `{ familyName: string }` |
| POST | `/api/family/{id}/share` | Bearer | `{ mediaIds: guid[] }` | 200 |
| DELETE | `/api/family/{id}/media/{mediaId}` | Bearer | — | 204 |
| GET | `/api/family/{id}/media?page=1&pageSize=50` | Bearer | — | `PaginatedResult<MediaItemDto>` |
| DELETE | `/api/family/{id}/members/{userId}` | Bearer | — | 204 |
| DELETE | `/api/family/{id}` | Owner | — | 204 |
| POST | `/api/family/{id}/invite` | Bearer | `{ expiryDays?: int }` | `{ inviteCode: string }` |

### Quota

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/quota` | Bearer | — | `StorageUsageDto` |
| PUT | `/api/quota/users/{id}/quota` | Owner | `{ quotaBytes: long }` | `{ userId, quotaBytes }` |

### Admin

| Method | Path | Auth | Body | Response |
|--------|------|------|------|----------|
| GET | `/api/admin/users` | Owner | — | `[{ id, email, displayName, firstSeenAt, lastSeenAt, quotaBytes, usedBytes, mediaCount }]` |
| POST | `/api/admin/reset` | Owner | — | `{ message: string }` |
| POST | `/api/admin/reprocess` | Owner | — | `{ message: string }` |

### SignalR

| Hub | Path | Auth | Events |
|-----|------|------|--------|
| MediaHub | `/hubs/media` | Bearer | `MediaStatusChanged(MediaStatusUpdate)`, `MediaChanged()` |

---

## 6. Enumerations & Constants

### Sort Values (GET /api/media `sort` parameter)

| Value | Description |
|-------|-------------|
| `captured_desc` | Date captured, newest first (default) |
| `captured_asc` | Date captured, oldest first |
| `uploaded_desc` | Upload date, newest first |
| `uploaded_asc` | Upload date, oldest first |
| `size_desc` | File size, largest first |
| `size_asc` | File size, smallest first |
| `name_asc` | File name, A-Z |
| `name_desc` | File name, Z-A |

### ProcessingStatus Values

| Value | Name | Trigger | Next States |
|-------|------|---------|-------------|
| 0 | Uploading | `POST upload/request` | Pending |
| 1 | Pending | `POST upload/complete` | Processing |
| 2 | Processing | BackgroundService dequeue | Complete, Transcoding |
| 3 | Transcoding | HEVC detected | Complete, Failed |
| 4 | Complete | Processing/transcode success | — (terminal) |
| 5 | Failed | Processing/transcode error | Pending (via reprocess) |

### MediaType Values

| Value | Name |
|-------|------|
| 0 | Photo |
| 1 | Video |

### FamilyMember Roles

| Value | Capabilities |
|-------|-------------|
| `admin` | Full management of family, delete family |
| `member` | View family media, share own media, unshare any media, download |
