# Project CleanSweep — Implementation Guide

> Living document. Updated as implementation progresses.
> Last updated: 2026-03-29

---

## Table of Contents

1. [User Journeys](#1-user-journeys)
2. [Solution Structure](#2-solution-structure)
3. [Dependency Graph](#3-dependency-graph)
4. [NuGet & npm Packages](#4-nuget--npm-packages)
5. [Domain Layer](#5-domain-layer)
6. [Application Layer — Interfaces](#6-application-layer--interfaces)
7. [Application Layer — Services](#7-application-layer--services)
8. [Infrastructure Layer](#8-infrastructure-layer)
9. [API Layer](#9-api-layer)
10. [Frontend](#10-frontend)
11. [Database Schema](#11-database-schema)
12. [Upload Pipeline (SAS Direct-to-Blob)](#12-upload-pipeline-sas-direct-to-blob)
12a. [Bulk Upload + Blob Throttling & Retry](#12a-bulk-upload--blob-throttling--retry)
12b. [SignalR — Real-Time Status Push](#12b-signalr--real-time-status-push)
13. [Blob Path Generator](#13-blob-path-generator)
14. [Transcoding Pipeline](#14-transcoding-pipeline)
15. [Configuration & Abstraction](#15-configuration)
15a. [Bootloader — Program.cs](#15a-bootloader--composition-root-programcs)
15b. [DI Registration (Loosely Coupled)](#15b-di-registration-loosely-coupled)
15c. [Logging & Request Tracing](#15c-logging--request-tracing)
16. [Local Development Setup](#16-local-development-setup)
17. [Deployment](#17-deployment)
18. [Phase 1 Task Breakdown](#18-phase-1-task-breakdown)
19. [Verification Checklist](#19-verification-checklist)

---

## 2. User Journeys

Every flow documented below shows:
- **Screen** — what the user sees in the browser
- **Frontend** — what React does in response
- **API** — what the .NET backend processes
- **Background** — what happens asynchronously after the request completes
- **Data** — what ends up stored in Postgres + Blob Storage

---

### Journey 1: First-Time Login

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SCREEN                           │ BEHIND THE SCENES                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                  │                                         │
│ 1. User opens cleansweep.app     │ Browser loads React SPA (index.html     │
│    → sees Login page             │ + JS bundle from App Service wwwroot/)  │
│    ┌──────────────────────┐      │                                         │
│    │  📧 Email             │      │                                         │
│    │  🔒 Password          │      │                                         │
│    │  [ Login ]            │      │                                         │
│    └──────────────────────┘      │                                         │
│                                  │                                         │
│ 2. User enters credentials       │ Frontend: POST /api/auth/login          │
│    → clicks Login                │   { email, password }                   │
│                                  │                                         │
│                                  │ API: AuthController.Login()             │
│                                  │   → ASP.NET Identity validates          │
│                                  │     credentials against Postgres        │
│                                  │   → If valid:                           │
│                                  │     • Generate JWT access token         │
│                                  │       (claims: userId, role, 15min exp) │
│                                  │     • Generate refresh token (7d exp)   │
│                                  │     • Store refresh token hash in DB    │
│                                  │   → Returns { accessToken,             │
│                                  │               refreshToken }            │
│                                  │                                         │
│ 3. Login succeeds                │ Frontend: useAuth hook                  │
│    → redirected to Gallery       │   → Stores accessToken in memory        │
│                                  │   → Stores refreshToken in httpOnly     │
│                                  │     cookie (secure, SameSite=Strict)    │
│                                  │   → All future requests include:        │
│                                  │     Authorization: Bearer <token>       │
│                                  │                                         │
│ 4. Gallery loads                 │ Frontend: GET /api/media?page=1         │
│    → user sees their media       │   (see Journey 3 for details)           │
│                                  │                                         │
├─ TOKEN REFRESH (invisible to user) ─────────────────────────────────────────┤
│                                  │                                         │
│ 5. After 15 min, any API call    │ API returns 401 Unauthorized            │
│    (user notices nothing)        │                                         │
│                                  │ Frontend: axios interceptor catches 401 │
│                                  │   → POST /api/auth/refresh              │
│                                  │     { refreshToken from cookie }        │
│                                  │   → API validates refresh token         │
│                                  │   → Issues new accessToken + refresh    │
│                                  │   → Retries the original request        │
│                                  │   → User sees no interruption           │
│                                  │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data created:**
- Postgres: `AspNetUsers` row (on registration), refresh token hash
- Blob: nothing

---

### Journey 2: Upload Photos from iPhone

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SCREEN                           │ BEHIND THE SCENES                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                  │                                         │
│ 1. User clicks "Upload" in nav   │ Router navigates to /upload             │
│    → sees upload area            │ MediaUploader component renders         │
│    ┌──────────────────────┐      │                                         │
│    │                      │      │                                         │
│    │   Drag & drop files  │      │                                         │
│    │   or click to browse │      │                                         │
│    │                      │      │                                         │
│    └──────────────────────┘      │                                         │
│                                  │                                         │
│ 2. User drags 3 files:           │ react-dropzone fires onDrop callback    │
│    • beach.jpg (8 MB)           │ useUpload hook queues 3 files            │
│    • sunset.heic (5 MB)         │                                         │
│    • birthday.mov (1.2 GB)      │                                         │
│                                  │                                         │
│ 3. Upload starts immediately     │                                         │
│    Progress bars appear:         │ FOR EACH FILE (in parallel, max 2):     │
│                                  │                                         │
│    beach.jpg                     │                                         │
│    ████████████████████░░ 85%    │                                         │
│    sunset.heic                   │                                         │
│    ██████████░░░░░░░░░░░ 45%    │                                         │
│    birthday.mov                  │                                         │
│    ██░░░░░░░░░░░░░░░░░░░  8%    │                                         │
│                                  │                                         │
├─ FILE 1: beach.jpg (JPEG, 8 MB) ───────────────────────────────────────────┤
│                                  │                                         │
│                                  │ Frontend: single POST /api/media/upload │
│                                  │   (< 100 MB → no chunking needed)      │
│                                  │   sends as multipart/form-data          │
│                                  │                                         │
│                                  │ API: MediaController.Upload()           │
│                                  │   → MediaService.UploadAsync()          │
│                                  │                                         │
│                                  │   Step 1: VALIDATE                      │
│                                  │   • Extension .jpg → allowed ✓          │
│                                  │   • Size 8 MB → under 5 GB limit ✓     │
│                                  │                                         │
│                                  │   Step 2: GENERATE ID + PATH            │
│                                  │   • Guid: e4f5a6b7c8d9e0f1...          │
│                                  │   • Path: e4/f5/a6/b7/e4f5...jpg       │
│                                  │                                         │
│                                  │   Step 3: EXTRACT METADATA              │
│                                  │   • IMetadataExtractor reads EXIF       │
│                                  │   • CapturedAt: 2026-03-15 14:32:00    │
│                                  │   • Width: 4032, Height: 3024           │
│                                  │   • Codec: null (it's a JPEG)           │
│                                  │                                         │
│                                  │   Step 4: UPLOAD ORIGINAL TO BLOB       │
│                                  │   • Stream → originals/e4/f5/.../...jpg │
│                                  │   • NOT buffered in memory — streamed   │
│                                  │     directly to Azure Blob Storage      │
│                                  │                                         │
│                                  │   Step 5: GENERATE THUMBNAIL            │
│                                  │   • ImageThumbnailGenerator (ImageSharp) │
│                                  │   • Resizes to max 300px dimension      │
│                                  │   • Stream → thumbnails/e4/f5/...jpg   │
│                                  │   • ~100ms for a JPEG                  │
│                                  │                                         │
│                                  │   Step 6: SAVE TO DATABASE              │
│                                  │   • INSERT into media_items:            │
│                                  │     id, user_id, file_name="beach.jpg", │
│                                  │     media_type=Photo,                   │
│                                  │     original_blob_path, thumbnail_path, │
│                                  │     playback_blob_path = original_path, │
│                                  │     captured_at, width, height,         │
│                                  │     processing_status = NotNeeded       │
│                                  │                                         │
│    beach.jpg                     │   Step 7: RETURN                        │
│    ████████████████████ 100% ✅  │   → { mediaId, thumbnailUrl,            │
│                                  │       status: "NotNeeded" }             │
│                                  │                                         │
│                                  │   BACKGROUND: nothing. Photo is done.   │
│                                  │                                         │
├─ FILE 2: sunset.heic (HEIC, 5 MB) ─────────────────────────────────────────┤
│                                  │                                         │
│                                  │ Same flow as beach.jpg EXCEPT:          │
│                                  │                                         │
│                                  │   Step 3: EXTRACT METADATA              │
│                                  │   • MetadataExtractor reads HEIC EXIF   │
│                                  │   • CapturedAt: 2026-03-14 09:15:00    │
│                                  │   • Width: 4032, Height: 3024           │
│                                  │                                         │
│                                  │   Step 5: GENERATE THUMBNAIL            │
│                                  │   • ImageSharp CANNOT decode HEIC       │
│                                  │   • HeicThumbnailGenerator (Magick.NET) │
│                                  │     handles it instead                  │
│                                  │   • Decodes HEIC → resizes → saves as   │
│                                  │     JPEG thumbnail                      │
│                                  │                                         │
│                                  │   Step 6: SAVE TO DATABASE              │
│                                  │   • playback_blob_path = original_path  │
│                                  │     (Safari can display HEIC natively;  │
│                                  │      for Chrome, frontend could request │
│                                  │      the thumbnail as fallback)         │
│                                  │   • processing_status = NotNeeded       │
│                                  │                                         │
│    sunset.heic                   │                                         │
│    ████████████████████ 100% ✅  │   BACKGROUND: nothing. Photo is done.   │
│                                  │                                         │
├─ FILE 3: birthday.mov (HEVC, 1.2 GB) ──────────────────────────────────────┤
│                                  │                                         │
│                                  │ Frontend: useUpload detects size ≥ 100MB│
│                                  │   → CHUNKED UPLOAD mode                 │
│                                  │                                         │
│                                  │ Step A: INIT                            │
│                                  │   POST /api/media/upload/init           │
│                                  │   → API creates a pending upload record │
│                                  │   → Returns uploadId + number of blocks │
│                                  │                                         │
│                                  │ Step B: UPLOAD CHUNKS                   │
│                                  │   Frontend splits into ~300 blocks × 4MB│
│                                  │   Sends 4 in parallel at a time:        │
│    birthday.mov                  │   PUT /api/media/upload/{id}/block/0    │
│    ██████░░░░░░░░░░░░░░  25%    │   PUT /api/media/upload/{id}/block/1    │
│                                  │   PUT /api/media/upload/{id}/block/2    │
│                                  │   PUT /api/media/upload/{id}/block/3    │
│                                  │   ...waits for any to finish...         │
│                                  │   PUT /api/media/upload/{id}/block/4    │
│                                  │                                         │
│                                  │   Each chunk → BlockBlobClient           │
│                                  │     .StageBlockAsync() on Azure Blob    │
│                                  │   Memory usage: ~4 MB per chunk         │
│                                  │     (never holds full 1.2 GB in RAM)    │
│                                  │                                         │
│    birthday.mov                  │ Step C: COMMIT                          │
│    ████████████████████ 100%    │   POST /api/media/upload/{id}/commit    │
│                                  │   → API calls BlockBlobClient           │
│                                  │     .CommitBlockListAsync()             │
│                                  │   → Azure assembles chunks into one blob│
│                                  │                                         │
│                                  │ Step D: PROCESS (same as single upload) │
│                                  │   • Extract metadata → Codec: "hevc"   │
│                                  │   • VideoThumbnailGenerator (FFmpeg):   │
│                                  │     ffmpeg -i <blob-url> -ss 00:00:02   │
│                                  │       -frames:v 1 -f image2 thumb.jpg   │
│                                  │   • Upload thumbnail to blob            │
│                                  │   • processing_status = PENDING         │
│                                  │   • playback_blob_path = NULL           │
│                                  │     (no browser-compatible version yet) │
│                                  │                                         │
│    birthday.mov                  │   Returns { status: "Pending" }         │
│    ████████████████████ 100% ⏳  │                                         │
│    "Processing video..."         │                                         │
│                                  │                                         │
├─ BACKGROUND: TRANSCODING (user can close browser) ──────────────────────────┤
│                                  │                                         │
│ User goes back to Gallery.       │ TranscodeBackgroundService running in   │
│ Sees birthday.mov with           │ API process (BackgroundService):        │
│ thumbnail but "Processing" badge │                                         │
│                                  │ Every 60 seconds, it checks:            │
│                                  │   SELECT * FROM media_items             │
│                                  │   WHERE processing_status = 1 (Pending) │
│                                  │   LIMIT 1                               │
│                                  │                                         │
│                                  │ Found birthday.mov → picks it up:       │
│                                  │                                         │
│                                  │ 1. UPDATE processing_status = Processing│
│                                  │                                         │
│                                  │ 2. AciTranscodeJobRunner.RunAsync():    │
│                                  │    → Azure SDK creates Container        │
│                                  │      Instance in rv-storage RG          │
│                                  │    → Image: jrottenberg/ffmpeg          │
│                                  │    → CPU: 1 core, RAM: 1.5 GB          │
│                                  │    → Command:                           │
│                                  │      ffmpeg                             │
│                                  │        -i <input-sas-url>               │
│                                  │        -c:v libx264 -crf 23             │
│                                  │        -preset medium                   │
│                                  │        -c:a aac                         │
│                                  │        -movflags +faststart             │
│                                  │        <output-path>                    │
│                                  │                                         │
│                                  │    → ACI starts (cold start: ~30-60s)   │
│                                  │    → FFmpeg transcodes: ~5-15 min       │
│                                  │      for a 1.2 GB HEVC file             │
│                                  │    → Output uploaded to:                │
│                                  │      playback/ab/cd/ef/12/...mp4       │
│                                  │                                         │
│                                  │ 3. BackgroundService polls ACI status   │
│                                  │    every 30s until it terminates        │
│                                  │                                         │
│                                  │ 4. On ACI success:                      │
│                                  │    → UPDATE media_items SET             │
│                                  │        playback_blob_path = '<path>',   │
│                                  │        processing_status = Complete     │
│                                  │    → DELETE ACI container group         │
│                                  │      (cleanup, stop billing)            │
│                                  │                                         │
│ Next time user opens Gallery     │ 5. On ACI failure:                      │
│ or refreshes:                    │    → UPDATE processing_status = Failed  │
│                                  │    → Log error for debugging            │
│ birthday.mov now shows           │    → DELETE ACI container group         │
│ WITHOUT "Processing" badge.      │    → Original .mov still available      │
│ User clicks → video plays ✅     │      for download                       │
│                                  │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data created (per file):**

| File | Postgres `media_items` | Blob `originals` | Blob `thumbnails` | Blob `playback` |
|------|----------------------|-------------------|--------------------|-----------------|
| beach.jpg | 1 row, status=NotNeeded | ✅ e4/f5/.../...jpg | ✅ e4/f5/.../...jpg | = original path |
| sunset.heic | 1 row, status=NotNeeded | ✅ ab/cd/.../...heic | ✅ ab/cd/.../...jpg | = original path |
| birthday.mov | 1 row, status=Pending→Processing→Complete | ✅ ab/cd/.../...mov | ✅ ab/cd/.../...jpg | ✅ ab/cd/.../...mp4 (after transcode) |

---

### Journey 3: Browse Gallery

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SCREEN                           │ BEHIND THE SCENES                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                  │                                         │
│ 1. User clicks "Gallery" in nav  │ Router → /gallery                       │
│                                  │ GalleryPage renders MediaTimeline       │
│                                  │ useMedia hook fires:                    │
│                                  │   GET /api/media?page=1&pageSize=50     │
│                                  │                                         │
│                                  │ API: BrowseService.BrowseAsync()        │
│                                  │   → Postgres query:                     │
│                                  │     SELECT * FROM media_items           │
│                                  │     WHERE user_id = @userId             │
│                                  │       AND is_deleted = FALSE            │
│                                  │     ORDER BY captured_at DESC           │
│                                  │     LIMIT 50 OFFSET 0                  │
│                                  │   → NO JOINs. Single table scan.       │
│                                  │   → Uses partial index:                 │
│                                  │     ix_media_items_user_captured        │
│                                  │                                         │
│                                  │   For each item, generates SAS URL:     │
│                                  │   → IBlobStorageService                 │
│                                  │       .GenerateSasUriAsync(             │
│                                  │         "thumbnails", blobPath,         │
│                                  │         expiry: 15 min)                 │
│                                  │   → Returns signed URL like:            │
│                                  │     https://storage.blob.../thumbnails  │
│                                  │     /e4/f5/.../...jpg?sv=...&sig=...    │
│                                  │                                         │
│ 2. Gallery renders               │ Frontend receives PaginatedResult:      │
│                                  │   { items: [...], totalCount: 127,      │
│                                  │     page: 1, pageSize: 50 }            │
│    ┌─ March 2026 ──────────────┐ │                                         │
│    │ 🖼 beach  🖼 sunset  📹 bday│ │ MediaTimeline groups by captured_at    │
│    │ 🖼 park   🖼 coffee       │ │ month/year, renders sticky headers     │
│    └───────────────────────────┘ │                                         │
│    ┌─ February 2026 ───────────┐ │ Each MediaCard renders:                 │
│    │ 🖼 snow   📹 dog   🖼 hike │ │  <img src="{SAS thumbnail URL}"       │
│    └───────────────────────────┘ │    loading="lazy" />                    │
│                                  │  + 📹 icon overlay if video             │
│                                  │  + ⏳ badge if status = Processing      │
│                                  │                                         │
│ 3. User scrolls down →           │ Frontend: useInfiniteQuery detects      │
│    more photos load              │   scroll near bottom                    │
│                                  │   → GET /api/media?page=2&pageSize=50  │
│                                  │   → Same DB query with OFFSET 50       │
│                                  │   → New items appended to grid          │
│                                  │                                         │
│ 4. User applies filter:          │ Frontend: sends query params            │
│    Type = Video                  │   GET /api/media?page=1&type=1          │
│    Date = Mar 2026               │     &from=2026-03-01&to=2026-03-31     │
│    → grid updates to show        │ API adds WHERE clauses:                 │
│      only March videos           │   AND media_type = 1                    │
│                                  │   AND captured_at >= @from              │
│                                  │   AND captured_at <= @to                │
│                                  │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data read:** Postgres `media_items` only (no JOINs). Thumbnails served directly from Azure Blob via SAS URLs — **API does not proxy image bytes**, just generates signed URLs.

---

### Journey 4: View & Play Media

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SCREEN                           │ BEHIND THE SCENES                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                  │                                         │
│ A) USER CLICKS A PHOTO           │                                         │
│                                  │                                         │
│ 1. Clicks beach.jpg thumbnail    │ Frontend: MediaViewer opens as overlay  │
│    → full-screen lightbox opens  │   GET /api/media/{id}                   │
│                                  │   → Returns MediaItemDto with:          │
│    ┌──────────────────────┐      │     playbackUrl (SAS for originals/...) │
│    │                      │      │     15 min expiry                       │
│    │    [ beach photo ]   │      │                                         │
│    │    (full resolution) │      │   Frontend renders:                     │
│    │                      │      │     <img src="{playback SAS URL}" />    │
│    │    ⬇️  Download      │      │   → Browser fetches directly from Azure │
│    └──────────────────────┘      │     Blob Storage (not through API)      │
│                                  │   → API serves ZERO image bytes         │
│                                  │                                         │
│ B) USER CLICKS A VIDEO           │                                         │
│                                  │                                         │
│ 1. Clicks birthday.mov thumb     │ Frontend: GET /api/media/{id}           │
│    → video player opens          │   → Returns playbackUrl pointing to     │
│                                  │     playback/ab/cd/.../...mp4           │
│    ┌──────────────────────┐      │     (the H.264 transcoded version)      │
│    │  ▶ advancement bar   │      │                                         │
│    │   advancement bar     │      │   Frontend renders:                     │
│    │  [ video playing ]   │      │     <video src="{playback SAS URL}">   │
│    │                      │      │                                         │
│    │  00:12 / 00:45       │      │   Browser makes HTTP Range requests    │
│    │   advancement bar     │      │   directly to Azure Blob:               │
│    │  ⬇️  Download        │      │     GET blob-url                        │
│    └──────────────────────┘      │     Range: bytes=0-1048575              │
│                                  │   → Progressive download + playback     │
│                                  │   → User can seek (range requests)      │
│ 2. User seeks to 0:30            │   → Browser: Range: bytes=15728640-     │
│    → video jumps instantly       │   → -movflags +faststart ensures moov   │
│                                  │     atom is at file start → instant     │
│                                  │     seek without downloading whole file │
│                                  │                                         │
│ C) VIDEO STILL PROCESSING        │                                         │
│                                  │                                         │
│ 1. Clicks video with ⏳ badge    │ Frontend: GET /api/media/{id}           │
│                                  │   → status = Processing                 │
│    ┌──────────────────────┐      │   → playbackUrl = null                  │
│    │                      │      │                                         │
│    │  ⏳ Video is being    │      │ Frontend shows processing message      │
│    │  transcoded. You can │      │ + offers original download link         │
│    │  download the        │      │ (original .mov is always available)     │
│    │  original file.      │      │                                         │
│    │                      │      │                                         │
│    │  ⬇️  Download Original│      │                                         │
│    └──────────────────────┘      │                                         │
│                                  │                                         │
│ D) USER DOWNLOADS A FILE         │                                         │
│                                  │                                         │
│ 1. Clicks ⬇️ Download            │ Frontend: GET /api/media/{id}/download  │
│                                  │ API:                                    │
│                                  │   → Generates SAS URL for originals/... │
│                                  │     with Content-Disposition: attachment │
│                                  │     filename="beach.jpg"                │
│                                  │   → Returns 302 Redirect to SAS URL     │
│                                  │ Browser downloads directly from Blob    │
│    [Save dialog appears]         │ → API transfers ZERO bytes              │
│    beach.jpg - 8 MB              │                                         │
│                                  │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key pattern:** The API **never proxies media bytes**. It generates short-lived SAS URLs (15 min) and the browser talks directly to Azure Blob Storage. This keeps B1 App Service load minimal.

---

### Journey 5: Create Album & Share

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SCREEN                           │ BEHIND THE SCENES                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                  │                                         │
│ 1. User clicks "Albums" in nav   │ GET /api/albums                         │
│    → sees existing albums grid   │ → AlbumService.GetByUserIdAsync()       │
│                                  │ → SELECT * FROM albums                  │
│                                  │   WHERE user_id = @userId               │
│                                  │ → cover_thumbnail_url is denormalized   │
│                                  │   on the row — NO JOIN to media_items   │
│                                  │                                         │
│ 2. Clicks "+ New Album"          │                                         │
│    → modal appears               │                                         │
│    ┌──────────────────────┐      │                                         │
│    │ Album name: Beach Trip│      │                                         │
│    │ Description: ___      │      │                                         │
│    │ [ Create ]            │      │                                         │
│    └──────────────────────┘      │                                         │
│                                  │ POST /api/albums                        │
│                                  │   { name: "Beach Trip" }                │
│                                  │ → INSERT into albums                    │
│                                  │                                         │
│ 3. Album opens empty             │                                         │
│    User clicks "Add Photos"      │                                         │
│    → media picker overlay shows  │ GET /api/media?page=1 (same browse API) │
│    → user selects 5 photos       │                                         │
│    → clicks "Add to Album"       │ POST /api/albums/{id}/media             │
│                                  │   { mediaIds: ["a1...", "b2...", ...] } │
│                                  │ → INSERT 5 rows into album_media        │
│                                  │ → UPDATE albums SET cover_media_id,     │
│                                  │   cover_thumbnail_url = first photo's   │
│                                  │   thumbnail SAS URL (denormalized)      │
│                                  │                                         │
│ 4. Album now shows 5 photos      │ GET /api/albums/{id}                    │
│    ┌──────────────────────┐      │ → THE ONE JOIN in the entire app:       │
│    │ Beach Trip            │      │   SELECT m.* FROM album_media am       │
│    │ 🖼🖼🖼🖼🖼              │      │   JOIN media_items m ON am.media_id    │
│    └──────────────────────┘      │     = m.id                              │
│                                  │   WHERE am.album_id = @id              │
│                                  │   ORDER BY am.sort_order               │
│                                  │ → Returns media with SAS thumbnail URLs │
│                                  │                                         │
│ 5. User clicks "Share" button    │                                         │
│    → options appear               │                                         │
│    ┌──────────────────────┐      │                                         │
│    │ Share album           │      │                                         │
│    │ Expires in: [72 hours]│      │                                         │
│    │ [ Generate Link ]     │      │                                         │
│    └──────────────────────┘      │                                         │
│                                  │ POST /api/share                         │
│                                  │   { albumId: "...", expiryHours: 72 }   │
│                                  │ → ShareService.CreateAsync():           │
│                                  │   • Generate 32-byte crypto-random token│
│                                  │     using RandomNumberGenerator         │
│                                  │   • Base64Url encode → URL-safe string  │
│                                  │   • INSERT into share_links             │
│                                  │     { token, albumId, expiresAt }       │
│                                  │   • Return full URL                     │
│                                  │                                         │
│    ┌──────────────────────┐      │                                         │
│    │ 🔗 Share link:        │      │                                         │
│    │ cleansweep.app/       │      │                                         │
│    │   shared/xK9mZ2...   │      │                                         │
│    │ [ Copy ] [ WhatsApp ] │      │                                         │
│    │ Expires: Mar 31, 2026 │      │                                         │
│    └──────────────────────┘      │                                         │
│                                  │                                         │
│ 6. Friend opens link             │                                         │
│    (no login needed)             │ Frontend: /shared/:token route          │
│                                  │ SharedPage renders                      │
│                                  │ GET /api/share/xK9mZ2...               │
│                                  │   → [AllowAnonymous] endpoint           │
│                                  │   → ShareService.ValidateAsync():       │
│                                  │     • SELECT * FROM share_links         │
│                                  │       WHERE token = @token              │
│                                  │     • Check expires_at > now            │
│                                  │     • If expired → 404                  │
│                                  │     • If valid → load album + media     │
│                                  │       (same JOIN as album detail)       │
│                                  │     • Generate SAS URLs for thumbnails  │
│                                  │       + playback (read-only, 15 min)    │
│                                  │                                         │
│    Friend sees album gallery     │                                         │
│    Can view + download           │ Download works same way: SAS redirect   │
│    Cannot upload or delete       │ No write operations exposed on /shared  │
│                                  │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data created:**
- Postgres: 1 `albums` row, 5 `album_media` rows, 1 `share_links` row
- Blob: nothing new (media already uploaded)

---

### Journey 6: Owner Deletes Media

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ SCREEN                           │ BEHIND THE SCENES                       │
├─────────────────────────────────────────────────────────────────────────────┤
│                                  │                                         │
│ 1. Owner right-clicks a photo    │                                         │
│    → context menu shows          │ Role check: only "owner" sees delete    │
│    ┌──────────┐                  │                                         │
│    │ View     │                  │                                         │
│    │ Download │                  │                                         │
│    │ Delete 🗑 │                  │                                         │
│    └──────────┘                  │                                         │
│                                  │                                         │
│ 2. Clicks Delete                 │                                         │
│    → confirmation dialog         │                                         │
│    ┌────────────────────────┐    │                                         │
│    │ Delete this photo?     │    │                                         │
│    │ This can be undone.    │    │                                         │
│    │ [ Cancel ] [ Delete ]  │    │                                         │
│    └────────────────────────┘    │                                         │
│                                  │                                         │
│ 3. Confirms deletion             │ DELETE /api/media/{id}                  │
│                                  │ → [Authorize(Roles = "owner")]          │
│                                  │ → SOFT DELETE only:                     │
│                                  │   UPDATE media_items                    │
│                                  │   SET is_deleted = TRUE                 │
│                                  │   WHERE id = @id                        │
│                                  │                                         │
│                                  │ → Blobs are NOT deleted immediately     │
│                                  │   (recoverable if needed)               │
│                                  │                                         │
│                                  │ → Item disappears from browse queries   │
│                                  │   because all queries have:             │
│                                  │   WHERE is_deleted = FALSE              │
│                                  │                                         │
│ 4. Photo disappears from grid    │ Frontend: React Query invalidates       │
│                                  │   media cache → grid re-renders         │
│                                  │                                         │
│ ("viewer" role users never see   │ Role="viewer" → API returns 403         │
│  the Delete option at all)       │  if they somehow call DELETE endpoint   │
│                                  │                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Data changed:** Postgres `is_deleted` flag flipped. Blobs untouched. Reversible.

---

### Data Flow Summary

```
                    ┌──────────┐
         writes     │          │    reads
    ┌──────────────▶│ Postgres │◀──────────────┐
    │               │          │               │
    │               └──────────┘               │
    │                                          │
┌───┴───┐                                 ┌────┴────┐
│  API  │──stream-to-blob────────────────▶│  Azure  │
│(.NET) │                                 │  Blob   │
│       │◀──SAS URL generation────────────│ Storage │
└───┬───┘                                 └────┬────┘
    │                                          │
    │  SAS URLs (not bytes)                    │  Direct HTTP
    │                                          │  (Range requests)
    ▼                                          ▼
┌──────────┐                              ┌──────────┐
│ Frontend │─────────────────────────────▶│ Browser  │
│ (React)  │  renders <img>/<video>       │ fetches  │
│          │  with SAS URLs               │ from Blob│
└──────────┘                              └──────────┘

Critical pattern: API NEVER proxies media bytes.
  Upload:   Client → API → streams to Blob (forward only)
  View:     API generates SAS URL → Client fetches from Blob directly
  Download: API returns 302 redirect to SAS URL → Browser downloads from Blob
```

---

## 2. Solution Structure

```
CleanSweep/
├── CleanSweep.sln
│
├── src/
│   ├── CleanSweep.Domain/                  # Layer 0 — ZERO dependencies
│   │   ├── Entities/
│   │   │   ├── MediaItem.cs
│   │   │   ├── Album.cs
│   │   │   ├── AlbumMedia.cs
│   │   │   ├── AppUser.cs
│   │   │   └── ShareLink.cs
│   │   ├── Enums/
│   │   │   ├── MediaType.cs
│   │   │   └── ProcessingStatus.cs
│   │   └── CleanSweep.Domain.csproj        # NO project references
│   │
│   ├── CleanSweep.Application/             # Layer 1 — Depends on Domain ONLY
│   │   ├── Interfaces/
│   │   │   ├── IBlobStorageService.cs
│   │   │   ├── IMediaRepository.cs
│   │   │   ├── IAlbumRepository.cs
│   │   │   ├── IShareLinkRepository.cs
│   │   │   ├── IMetadataExtractor.cs
│   │   │   ├── IThumbnailGenerator.cs
│   │   │   ├── ITranscodeJobRunner.cs
│   │   │   └── ICurrentUserService.cs
│   │   ├── DTOs/
│   │   │   ├── MediaMetadata.cs
│   │   │   ├── UploadResult.cs
│   │   │   ├── MediaItemDto.cs
│   │   │   ├── AlbumDto.cs
│   │   │   └── PaginatedResult.cs
│   │   ├── Services/
│   │   │   ├── MediaService.cs
│   │   │   ├── AlbumService.cs
│   │   │   ├── ShareService.cs
│   │   │   └── BrowseService.cs
│   │   ├── Helpers/
│   │   │   └── BlobPathGenerator.cs
│   │   ├── DependencyInjection.cs
│   │   └── CleanSweep.Application.csproj   # References: Domain
│   │
│   ├── CleanSweep.Infrastructure/          # Layer 2 — Depends on Application + Domain
│   │   ├── Persistence/
│   │   │   ├── AppDbContext.cs
│   │   │   ├── Configurations/
│   │   │   │   ├── MediaItemConfiguration.cs
│   │   │   │   ├── AlbumConfiguration.cs
│   │   │   │   ├── AlbumMediaConfiguration.cs
│   │   │   │   └── ShareLinkConfiguration.cs
│   │   │   ├── Repositories/
│   │   │   │   ├── MediaRepository.cs
│   │   │   │   ├── AlbumRepository.cs
│   │   │   │   └── ShareLinkRepository.cs
│   │   │   └── Migrations/
│   │   ├── Storage/
│   │   │   └── AzureBlobStorageService.cs
│   │   ├── Queue/
│   │   │   ├── AzureMediaProcessingQueue.cs  # Implements IMediaProcessingQueue
│   │   │   └── AzureTranscodeQueue.cs        # Implements ITranscodeQueue
│   │   ├── Processing/
│   │   │   ├── ExifMetadataExtractor.cs
│   │   │   ├── ImageThumbnailGenerator.cs
│   │   │   ├── HeicThumbnailGenerator.cs      # Magick.NET
│   │   │   ├── VideoThumbnailGenerator.cs
│   │   │   └── AciTranscoder.cs               # Implements ITranscoder
│   │   ├── Identity/
│   │   │   └── CurrentUserService.cs
│   │   ├── DependencyInjection.cs
│   │   └── CleanSweep.Infrastructure.csproj # References: Application, Domain
│   │
│   └── CleanSweep.API/                     # Layer 3 — Composition root
│       ├── Controllers/
│       │   ├── MediaController.cs
│       │   ├── AlbumController.cs
│       │   ├── ShareController.cs
│       │   └── AdminController.cs          # Owner-only: list users, seed data
│       ├── BackgroundServices/
│       │   ├── ProcessingBackgroundService.cs  # Dequeues media-processing queue
│       │   └── TranscodeBackgroundService.cs   # Dequeues transcode-jobs queue
│       ├── Hubs/
│       │   └── MediaHub.cs                     # SignalR hub (status push)
│       ├── Middleware/
│       │   ├── CorrelationIdMiddleware.cs       # Assigns X-Correlation-ID
│       │   ├── RequestLoggingMiddleware.cs      # Logs request in/out + timing
│       │   └── ExceptionHandlingMiddleware.cs
│       ├── Program.cs
│       ├── appsettings.json
│       └── CleanSweep.API.csproj           # References: Infrastructure, Application
│
├── client/                                 # React + Vite + TypeScript
│   ├── index.html
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── api/
│   │   │   ├── client.ts                   # Axios instance + auth interceptor
│   │   │   ├── mediaApi.ts
│   │   │   ├── albumApi.ts
│   │   │   ├── authApi.ts
│   │   │   └── shareApi.ts
│   │   ├── components/
│   │   │   ├── layout/
│   │   │   │   ├── AppShell.tsx
│   │   │   │   └── ProtectedRoute.tsx
│   │   │   ├── media/
│   │   │   │   ├── MediaGrid.tsx
│   │   │   │   ├── MediaCard.tsx
│   │   │   │   ├── MediaUploader.tsx
│   │   │   │   ├── MediaViewer.tsx
│   │   │   │   └── MediaTimeline.tsx
│   │   │   ├── auth/
│   │   │   │   ├── LoginForm.tsx
│   │   │   │   └── RegisterForm.tsx
│   │   │   └── albums/
│   │   │       ├── AlbumGrid.tsx
│   │   │       └── AlbumDetail.tsx
│   │   ├── hooks/
│   │   │   ├── useAuth.ts
│   │   │   ├── useMedia.ts
│   │   │   └── useUpload.ts
│   │   ├── pages/
│   │   │   ├── LoginPage.tsx
│   │   │   ├── GalleryPage.tsx
│   │   │   ├── AlbumsPage.tsx
│   │   │   ├── UploadPage.tsx
│   │   │   └── SharedPage.tsx
│   │   ├── types/
│   │   │   ├── media.ts
│   │   │   └── auth.ts
│   │   └── utils/
│   │       ├── formatters.ts
│   │       └── constants.ts
│   └── .env
│
└── README.md
```

---

## 3. Dependency Graph

```
CleanSweep.Domain ← CleanSweep.Application ← CleanSweep.Infrastructure ← CleanSweep.API
```

| Project | References | Rule |
|---------|-----------|------|
| **Domain** | Nothing | Pure entities + enums. No NuGet refs except base .NET. |
| **Application** | Domain | Interfaces, DTOs, services, helpers. No infra knowledge. |
| **Infrastructure** | Application + Domain | Implements all interfaces. EF Core, Azure SDK, ImageSharp. |
| **API** | Infrastructure + Application | Composition root. Wires DI. Controllers + middleware. |

**Enforced by `.csproj` `<ProjectReference>` entries.** No references ever go "upward".

---

## 4. NuGet & npm Packages

### Backend — Verified current versions as of 2026-03-29

| Package | Version | Project | Purpose |
|---------|---------|---------|---------|
| `Azure.Storage.Blobs` | 12.27.0 | Infrastructure | Blob upload/download/SAS |
| `Azure.Identity` | latest | Infrastructure | DefaultAzureCredential |
| `Azure.ResourceManager.ContainerInstance` | latest | Infrastructure | Programmatic ACI creation for transcoding |
| `Npgsql.EntityFrameworkCore.PostgreSQL` | 8.x | Infrastructure | EF Core Postgres provider |
| `MetadataExtractor` | 2.9.2 | Infrastructure | EXIF extraction (supports HEIC, MOV, MP4) |
| `SixLabors.ImageSharp` | 3.1.12 | Infrastructure | Photo thumbnails (JPEG, PNG, WebP) |
| `Magick.NET-Q8-AnyCPU` | latest | Infrastructure | HEIC thumbnail generation (ImageSharp can't decode HEIC) |
| `Microsoft.AspNetCore.Identity.EntityFrameworkCore` | built-in | Infrastructure | Identity user store |
| `Microsoft.AspNetCore.Authentication.JwtBearer` | built-in | API | JWT auth middleware |

### Frontend — npm

| Package | Purpose |
|---------|---------|
| `react`, `react-dom` | UI framework |
| `react-router-dom` | SPA routing |
| `@tanstack/react-query` | Server state / caching |
| `axios` | HTTP client with interceptors |
| `react-dropzone` | Drag-and-drop upload |
| `react-photo-album` | Responsive photo grid |

---

## 5. Domain Layer

### Entities

```csharp
// CleanSweep.Domain/Entities/MediaItem.cs
public class MediaItem
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = null!;
    public string FileName { get; set; } = null!;         // Original human-readable name
    public MediaType MediaType { get; set; }
    public string OriginalBlobPath { get; set; } = null!;  // Hash-partitioned path
    public string? PlaybackBlobPath { get; set; }          // Null until transcode completes
    public string? ThumbnailBlobPath { get; set; }
    public string ContentType { get; set; } = null!;       // MIME type
    public long FileSizeBytes { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public double? DurationSeconds { get; set; }           // Video only
    public string? SourceCodec { get; set; }               // "hevc", "h264", etc.
    public string? ContentHash { get; set; }               // SHA256 for future dedup
    public DateTimeOffset? CapturedAt { get; set; }        // From EXIF
    public DateTimeOffset UploadedAt { get; set; }
    public ProcessingStatus ProcessingStatus { get; set; }
    public bool IsDeleted { get; set; }

    // Navigation
    public AppUser User { get; set; } = null!;
    public ICollection<AlbumMedia> AlbumMedia { get; set; } = new List<AlbumMedia>();
}
```

```csharp
// CleanSweep.Domain/Entities/Album.cs
public class Album
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string? Description { get; set; }
    public Guid? CoverMediaId { get; set; }
    public string? CoverThumbnailUrl { get; set; }         // Denormalized — avoids JOIN when listing albums
    public DateTimeOffset CreatedAt { get; set; }

    // Navigation
    public AppUser User { get; set; } = null!;
    public MediaItem? CoverMedia { get; set; }
    public ICollection<AlbumMedia> AlbumMedia { get; set; } = new List<AlbumMedia>();
}
```

```csharp
// CleanSweep.Domain/Entities/AlbumMedia.cs
public class AlbumMedia
{
    public Guid AlbumId { get; set; }
    public Guid MediaId { get; set; }
    public int SortOrder { get; set; }

    // Navigation
    public Album Album { get; set; } = null!;
    public MediaItem Media { get; set; } = null!;
}
```

```csharp
// CleanSweep.Domain/Entities/AppUser.cs
// Lightweight profile — NOT IdentityUser. Azure AD handles auth.
// Auto-created on first API call from a user's JWT claims.
public class AppUser
{
    public string Id { get; set; } = null!;                 // Azure AD Object ID (from JWT "oid" claim)
    public string Email { get; set; } = null!;              // From JWT "preferred_username" claim
    public string DisplayName { get; set; } = null!;        // From JWT "name" claim
    public DateTimeOffset FirstSeenAt { get; set; }         // When they first used the app
    public DateTimeOffset LastSeenAt { get; set; }          // Updated on each API call

    // Navigation
    public ICollection<MediaItem> MediaItems { get; set; } = new List<MediaItem>();
    public ICollection<Album> Albums { get; set; } = new List<Album>();
}

// Roles are NOT stored in our DB. They come from Azure AD JWT:
//   "roles": ["owner"]  or  "roles": ["viewer"]
// Read via: User.IsInRole("owner") in controllers
// Configured in Azure AD → App Registration → App Roles
```

```csharp
// CleanSweep.Domain/Entities/ShareLink.cs
public class ShareLink
{
    public Guid Id { get; set; }
    public string Token { get; set; } = null!;             // Cryptographic random, URL-safe
    public Guid? AlbumId { get; set; }
    public Guid? MediaId { get; set; }
    public string CreatedByUserId { get; set; } = null!;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    // Navigation
    public Album? Album { get; set; }
    public MediaItem? Media { get; set; }
    public AppUser CreatedBy { get; set; } = null!;
}
```

### Enums

```csharp
// CleanSweep.Domain/Enums/MediaType.cs
public enum MediaType
{
    Photo = 0,
    Video = 1
}

// CleanSweep.Domain/Enums/ProcessingStatus.cs
public enum ProcessingStatus
{
    NotNeeded = 0,    // Already H.264 / JPEG — no conversion needed
    Pending = 1,      // Queued for transcoding
    Processing = 2,   // ACI is running
    Complete = 3,     // Transcoded version available
    Failed = 4        // Transcode failed — original still available
}
```

---

## 6. Application Layer — Interfaces

```csharp
// IBlobStorageService.cs
public interface IBlobStorageService
{
    Task<Uri> GenerateWriteSasUriAsync(string containerName, string blobPath, string contentType, TimeSpan expiry, CancellationToken ct = default);
    Task<Uri> GenerateReadSasUriAsync(string containerName, string blobPath, TimeSpan expiry, CancellationToken ct = default);
    Task<Stream> DownloadAsync(string containerName, string blobPath, CancellationToken ct = default);
    Task<Stream> DownloadRangeAsync(string containerName, string blobPath, long offset, long length, CancellationToken ct = default);
    Task UploadAsync(Stream content, string containerName, string blobPath, string contentType, CancellationToken ct = default);
    Task DeleteAsync(string containerName, string blobPath, CancellationToken ct = default);
    Task<bool> ExistsAsync(string containerName, string blobPath, CancellationToken ct = default);
    Task<long> GetBlobSizeAsync(string containerName, string blobPath, CancellationToken ct = default);
}
```

```csharp
// IUploadService.cs — orchestrates the SAS-based upload flow
public interface IUploadService
{
    Task<UploadRequest> RequestUploadAsync(string fileName, string contentType, long sizeBytes, CancellationToken ct = default);
    Task CompleteUploadAsync(Guid mediaId, CancellationToken ct = default);
}
```

```csharp
// IMediaProcessingQueue.cs — queue for thumbnail + metadata extraction
public interface IMediaProcessingQueue
{
    Task EnqueueAsync(ProcessingMessage message, CancellationToken ct = default);
    Task<QueueItem<ProcessingMessage>?> DequeueAsync(TimeSpan visibilityTimeout, CancellationToken ct = default);
    Task CompleteAsync(string messageId, string popReceipt, CancellationToken ct = default);
}
```

```csharp
// ITranscodeQueue.cs — queue for HEVC→H.264 transcoding
public interface ITranscodeQueue
{
    Task EnqueueAsync(TranscodeMessage message, CancellationToken ct = default);
    Task<QueueItem<TranscodeMessage>?> DequeueAsync(TimeSpan visibilityTimeout, CancellationToken ct = default);
    Task CompleteAsync(string messageId, string popReceipt, CancellationToken ct = default);
}
```

```csharp
// ITranscoder.cs — runs FFmpeg via ACI
public interface ITranscoder
{
    Task<TranscodeResult> TranscodeAsync(string sourceBlobPath, string targetBlobPath, CancellationToken ct = default);
}
```

```csharp
// IMediaRepository.cs
public interface IMediaRepository
{
    Task<MediaItem> AddAsync(MediaItem item, CancellationToken ct = default);
    Task<MediaItem?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<PaginatedResult<MediaItem>> BrowseAsync(
        string userId, int page, int pageSize,
        MediaType? type = null, DateTimeOffset? from = null, DateTimeOffset? to = null,
        CancellationToken ct = default);
    Task<List<MediaItem>> GetStuckItemsAsync(TimeSpan stuckThreshold, int limit, CancellationToken ct = default);
    Task UpdateAsync(MediaItem item, CancellationToken ct = default);
    Task SoftDeleteAsync(Guid id, CancellationToken ct = default);
}
```

```csharp
// IAlbumRepository.cs
public interface IAlbumRepository
{
    Task<Album> AddAsync(Album album, CancellationToken ct = default);
    Task<Album?> GetByIdWithMediaAsync(Guid id, CancellationToken ct = default);
    Task<List<Album>> GetByUserIdAsync(string userId, CancellationToken ct = default);
    Task UpdateAsync(Album album, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task AddMediaAsync(Guid albumId, Guid mediaId, int sortOrder, CancellationToken ct = default);
    Task RemoveMediaAsync(Guid albumId, Guid mediaId, CancellationToken ct = default);
}
```

```csharp
// IMetadataExtractor.cs, IThumbnailGenerator.cs, ICurrentUserService.cs — unchanged
```

### DTOs

```csharp
// UploadRequest.cs — returned by RequestUpload
public class UploadRequest
{
    public Guid MediaId { get; set; }
    public string UploadUrl { get; set; } = null!;    // Write-only SAS URL
    public string BlobPath { get; set; } = null!;
}

// ProcessingMessage.cs — queued after upload completes
public class ProcessingMessage
{
    public Guid MediaId { get; set; }
    public string BlobPath { get; set; } = null!;
    public string ContentType { get; set; } = null!;
    public string FileName { get; set; } = null!;
    public string UserId { get; set; } = null!;
}

// TranscodeMessage.cs — queued when HEVC detected
public class TranscodeMessage
{
    public Guid MediaId { get; set; }
    public string SourceBlobPath { get; set; } = null!;
    public string TargetBlobPath { get; set; } = null!;
    public string UserId { get; set; } = null!;
}

// QueueItem<T>.cs — wraps queue message with receipt
public class QueueItem<T>
{
    public T Message { get; set; } = default!;
    public string MessageId { get; set; } = null!;
    public string PopReceipt { get; set; } = null!;
}
```

### Processing Status (updated)

```csharp
public enum ProcessingStatus
{
    Uploading = 0,     // SAS URL issued, blob upload in progress
    Pending = 1,       // Upload confirmed, queued for processing
    Processing = 2,    // Thumbnail/metadata extraction in progress
    Transcoding = 3,   // HEVC→H.264 ACI job running
    Complete = 4,      // All processing done — browsable
    Failed = 5         // Processing failed — original still available
}
```

---

## 7. Application Layer — Services

### MediaService — Upload Orchestration

```csharp
// CleanSweep.Application/Services/MediaService.cs
public class MediaService
{
    private readonly IBlobStorageService _blobService;
    private readonly IMediaRepository _mediaRepo;
    private readonly IMetadataExtractor _metadataExtractor;
    private readonly IEnumerable<IThumbnailGenerator> _thumbnailGenerators;
    private readonly ICurrentUserService _currentUser;

    // Constructor injection — all dependencies are interfaces

    public async Task<UploadResult> UploadAsync(Stream fileStream, string fileName, string contentType, CancellationToken ct)
    {
        // 1. Generate ID + blob paths
        var id = Guid.NewGuid();
        var extension = Path.GetExtension(fileName).ToLowerInvariant();
        var blobPath = BlobPathGenerator.Generate(id, extension);

        // 2. Extract metadata (EXIF date, dimensions, codec)
        fileStream.Position = 0;
        var metadata = await _metadataExtractor.ExtractAsync(fileStream, fileName, ct);

        // 3. Upload original to blob
        fileStream.Position = 0;
        await _blobService.UploadAsync(fileStream, "originals", blobPath, contentType, ct);

        // 4. Generate thumbnail
        fileStream.Position = 0;
        var thumbGenerator = _thumbnailGenerators.FirstOrDefault(g => g.CanHandle(contentType));
        string? thumbnailBlobPath = null;
        if (thumbGenerator != null)
        {
            using var thumbStream = await thumbGenerator.GenerateAsync(fileStream, contentType, 300, ct);
            thumbnailBlobPath = BlobPathGenerator.Generate(id, ".jpg");
            await _blobService.UploadAsync(thumbStream, "thumbnails", thumbnailBlobPath, "image/jpeg", ct);
        }

        // 5. Determine processing status
        var mediaType = IsVideo(contentType) ? MediaType.Video : MediaType.Photo;
        var needsTranscode = mediaType == MediaType.Video && metadata.Codec?.ToLower() == "hevc";
        var status = needsTranscode ? ProcessingStatus.Pending : ProcessingStatus.NotNeeded;

        // 6. For non-HEVC video or photos, playback path = original path
        string? playbackBlobPath = needsTranscode ? null : blobPath;

        // 7. Save to DB
        var mediaItem = new MediaItem
        {
            Id = id,
            UserId = _currentUser.UserId!,
            FileName = fileName,
            MediaType = mediaType,
            OriginalBlobPath = blobPath,
            PlaybackBlobPath = playbackBlobPath,
            ThumbnailBlobPath = thumbnailBlobPath,
            ContentType = contentType,
            FileSizeBytes = fileStream.Length,
            Width = metadata.Width,
            Height = metadata.Height,
            DurationSeconds = metadata.DurationSeconds,
            SourceCodec = metadata.Codec,
            CapturedAt = metadata.DateTaken,
            UploadedAt = DateTimeOffset.UtcNow,
            ProcessingStatus = status
        };

        await _mediaRepo.AddAsync(mediaItem, ct);

        // 8. Return result (TranscodeBackgroundService will pick up Pending items)
        return new UploadResult
        {
            MediaId = id,
            ThumbnailUrl = thumbnailBlobPath,
            Status = status
        };
    }

    private static bool IsVideo(string contentType) =>
        contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase);
}
```

---

## 8. Infrastructure Layer

### AzureBlobStorageService

```csharp
// Uses Azure.Storage.Blobs SDK v12.27.0
// Registered as Singleton (BlobServiceClient is thread-safe)
public class AzureBlobStorageService : IBlobStorageService
{
    private readonly BlobServiceClient _serviceClient;

    public AzureBlobStorageService(IConfiguration config)
    {
        _serviceClient = new BlobServiceClient(config.GetConnectionString("BlobStorage"));
    }

    public async Task<string> UploadAsync(Stream content, string containerName, string blobPath, string contentType, CancellationToken ct)
    {
        var container = _serviceClient.GetBlobContainerClient(containerName);
        var blob = container.GetBlobClient(blobPath);
        await blob.UploadAsync(content, new BlobHttpHeaders { ContentType = contentType }, cancellationToken: ct);
        return blobPath;
    }

    public async Task<Uri> GenerateSasUriAsync(string containerName, string blobPath, TimeSpan expiry, CancellationToken ct)
    {
        var container = _serviceClient.GetBlobContainerClient(containerName);
        var blob = container.GetBlobClient(blobPath);
        var sasUri = blob.GenerateSasUri(BlobSasPermissions.Read, DateTimeOffset.UtcNow.Add(expiry));
        return sasUri;
    }

    // ... DownloadAsync, DeleteAsync, ExistsAsync follow same pattern
}
```

### ExifMetadataExtractor

```csharp
// Uses MetadataExtractor v2.9.2
// Supports: JPEG, PNG, HEIC, MOV, MP4 (verified on NuGet page)
public class ExifMetadataExtractor : IMetadataExtractor
{
    public Task<MediaMetadata> ExtractAsync(Stream fileStream, string fileName, CancellationToken ct)
    {
        var directories = ImageMetadataReader.ReadMetadata(fileStream);

        // Date taken
        var subIfd = directories.OfType<ExifSubIfdDirectory>().FirstOrDefault();
        DateTimeOffset? dateTaken = null;
        if (subIfd != null && subIfd.TryGetDateTime(ExifDirectoryBase.TagDateTimeOriginal, out var dt))
            dateTaken = new DateTimeOffset(dt, TimeSpan.Zero);

        // Dimensions
        int? width = null, height = null;
        // ... extract from appropriate directory based on file type

        // Video codec detection (for MOV/MP4)
        string? codec = null;
        // ... check QuickTime / MP4 track headers for codec info

        return Task.FromResult(new MediaMetadata
        {
            DateTaken = dateTaken,
            Width = width,
            Height = height,
            Codec = codec,
            DurationSeconds = null // Extract from video metadata if available
        });
    }
}
```

### TranscodeBackgroundService (replaces Azure Functions)

```csharp
// CleanSweep.API/BackgroundServices/TranscodeBackgroundService.cs
public class TranscodeBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TranscodeBackgroundService> _logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            using var scope = _scopeFactory.CreateScope();
            var mediaRepo = scope.ServiceProvider.GetRequiredService<IMediaRepository>();
            var transcoder = scope.ServiceProvider.GetRequiredService<ITranscodeJobRunner>();

            // Poll for pending transcode jobs
            var pendingItems = await mediaRepo.GetPendingTranscodesAsync(limit: 1, stoppingToken);

            foreach (var item in pendingItems)
            {
                try
                {
                    item.ProcessingStatus = ProcessingStatus.Processing;
                    await mediaRepo.UpdateAsync(item, stoppingToken);

                    var targetPath = BlobPathGenerator.Generate(item.Id, ".mp4");
                    await transcoder.RunAsync(item.Id, item.OriginalBlobPath, targetPath, stoppingToken);

                    item.PlaybackBlobPath = targetPath;
                    item.ProcessingStatus = ProcessingStatus.Complete;
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Transcode failed for {MediaId}", item.Id);
                    item.ProcessingStatus = ProcessingStatus.Failed;
                }

                await mediaRepo.UpdateAsync(item, stoppingToken);
            }

            // Poll interval — no pending items = wait longer
            await Task.Delay(pendingItems.Count > 0 ? TimeSpan.FromSeconds(5) : TimeSpan.FromMinutes(1), stoppingToken);
        }
    }
}
```

---

## 9. API Layer

### Program.cs — Composition Root

```csharp
var builder = WebApplication.CreateBuilder(args);

// Layer registration — each layer has ONE extension method
builder.Services
    .AddApplication()
    .AddInfrastructure(builder.Configuration);

// Background service for transcoding
builder.Services.AddHostedService<TranscodeBackgroundService>();

// JWT Auth
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = builder.Configuration["Jwt:Issuer"],
            ValidAudience = builder.Configuration["Jwt:Audience"],
            IssuerSigningKey = new SymmetricSecurityKey(
                Encoding.UTF8.GetBytes(builder.Configuration["Jwt:Key"]!))
        };
    });

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

var app = builder.Build();

app.UseMiddleware<ExceptionHandlingMiddleware>();
app.UseAuthentication();
app.UseAuthorization();

// Serve React SPA static files (in production)
app.UseStaticFiles();
app.MapControllers();
app.MapFallbackToFile("index.html"); // SPA fallback

app.Run();
```

### MediaController (key endpoints)

```csharp
[ApiController]
[Route("api/[controller]")]
[Authorize]
public class MediaController : ControllerBase
{
    private readonly MediaService _mediaService;
    private readonly BrowseService _browseService;
    private readonly IBlobStorageService _blobService;

    [HttpPost("upload")]
    [RequestSizeLimit(5L * 1024 * 1024 * 1024)] // 5 GB max
    public async Task<ActionResult<UploadResult>> Upload(IFormFile file, CancellationToken ct)
    {
        using var stream = file.OpenReadStream();
        var result = await _mediaService.UploadAsync(stream, file.FileName, file.ContentType, ct);
        return Ok(result);
    }

    [HttpGet]
    public async Task<ActionResult<PaginatedResult<MediaItemDto>>> Browse(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] MediaType? type = null,
        [FromQuery] DateTimeOffset? from = null,
        [FromQuery] DateTimeOffset? to = null,
        CancellationToken ct = default)
    {
        var result = await _browseService.BrowseAsync(page, pageSize, type, from, to, ct);
        return Ok(result);
    }

    [HttpGet("{id}/download")]
    public async Task<ActionResult> Download(Guid id, CancellationToken ct)
    {
        // Generate time-limited SAS URL, redirect to it
        // ... get media item from DB, generate SAS for original blob
    }

    [HttpDelete("{id}")]
    [Authorize(Roles = "owner")]
    public async Task<ActionResult> Delete(Guid id, CancellationToken ct)
    {
        // Soft delete — sets IsDeleted = true
    }
}
```

### appsettings.json structure

> **Note:** The canonical appsettings.json is in Section 15 (Configuration). This is a
> quick reference for the API layer. See Section 15 for the complete version with all options.

```json
{
  "ConnectionStrings": {
    "Postgres": "Host=<server>.postgres.database.azure.com;Database=cleansweep;Username=<user>;Password=<pass>;SSL Mode=Require;"
  },
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "<your-tenant-id>",
    "ClientId": "<app-registration-client-id>",
    "Audience": "api://<app-registration-client-id>"
  },
  "Storage": {
    "ConnectionString": "<blob-storage-connection-string>"
  },
  "Queue": {
    "ConnectionString": "<same-or-separate>"
  },
  "Transcode": {
    "ResourceGroup": "rv-storage",
    "Location": "centralindia"
  }
}
```

---

## 10. Frontend

### Key Components

| Component | Responsibility |
|-----------|---------------|
| `client.ts` | Axios instance, base URL from env, MSAL token interceptor (acquires Azure AD token silently, attaches as Bearer header) |
| `MediaUploader.tsx` | `react-dropzone` for drag-drop. Requests SAS URL from API, uploads directly to Blob. Chunked for large files. Retry on 429/503. Max 3 concurrent. |
| `MediaGrid.tsx` | Responsive grid using `react-photo-album`. Infinite scroll via `@tanstack/react-query` `useInfiniteQuery`. |
| `MediaTimeline.tsx` | Groups `MediaCard` items by year/month using `CapturedAt`. Sticky headers per month. |
| `MediaViewer.tsx` | Lightbox overlay. Photos: zoomable image. Videos: HTML5 `<video>` with SAS URL in `src`. |
| `useUpload.ts` | Custom hook managing upload queue, chunking, progress state, retry on failure. |
| `useAuth.ts` | React Context. Stores access token in memory, refresh token in httpOnly cookie. Auto-refresh on 401. |

### API Client Pattern

```typescript
// client/src/api/client.ts
import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
});

api.interceptors.request.use((config) => {
  const token = getAccessToken(); // from auth context
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Attempt token refresh, retry original request
    }
    return Promise.reject(error);
  }
);

export default api;
```

---

## 11. Database Schema

```sql
-- Run on existing Postgres B1ms server
CREATE DATABASE cleansweep;

-- Tables created by EF Core migrations, but here's the target schema:

-- ASP.NET Identity tables (auto-created):
-- AspNetUsers (extended with display_name, role columns)
-- AspNetRoles, AspNetUserRoles, AspNetUserClaims, etc.

-- Application tables:
CREATE TABLE media_items (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "AspNetUsers"(id),
    file_name TEXT NOT NULL,
    media_type INTEGER NOT NULL,           -- 0=Photo, 1=Video
    original_blob_path TEXT NOT NULL,
    playback_blob_path TEXT,
    thumbnail_blob_path TEXT,
    content_type TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    width INTEGER,
    height INTEGER,
    duration_seconds DOUBLE PRECISION,
    source_codec TEXT,
    content_hash TEXT,                      -- SHA256 for future dedup
    captured_at TIMESTAMPTZ,
    uploaded_at TIMESTAMPTZ NOT NULL,
    processing_status INTEGER NOT NULL DEFAULT 0,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX ix_media_items_user_captured ON media_items (user_id, captured_at DESC)
    WHERE is_deleted = FALSE;
CREATE INDEX ix_media_items_processing ON media_items (processing_status)
    WHERE processing_status = 1;            -- Pending items only (partial index)
CREATE INDEX ix_media_items_content_hash ON media_items (content_hash)
    WHERE content_hash IS NOT NULL;

CREATE TABLE albums (
    id UUID PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES "AspNetUsers"(id),
    name TEXT NOT NULL,
    description TEXT,
    cover_media_id UUID REFERENCES media_items(id),
    cover_thumbnail_url TEXT,               -- Denormalized
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE album_media (
    album_id UUID NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    media_id UUID NOT NULL REFERENCES media_items(id),
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (album_id, media_id)
);

CREATE TABLE share_links (
    id UUID PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    album_id UUID REFERENCES albums(id),
    media_id UUID REFERENCES media_items(id),
    created_by_user_id TEXT NOT NULL REFERENCES "AspNetUsers"(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX ix_share_links_token ON share_links (token);
```

**Note:** All tables created via EF Core Migrations (`dotnet ef migrations add InitialCreate`). The SQL above is the target — EF generates it from the `Configuration` classes.

---

## 12. Upload Pipeline (SAS Direct-to-Blob)

**API transfers zero file bytes.** Browser uploads directly to Azure Blob Storage.

```
═══════════ STEP 1: REQUEST UPLOAD URL (API — ~100ms) ═══════════

Browser → POST /api/media/upload/request
          { fileName: "beach.jpg", contentType: "image/jpeg", sizeBytes: 8000000 }

API (UploadService.RequestUploadAsync):
    1. Validate extension + size
    2. Generate Guid → e4f5a6b7...
    3. BlobPathGenerator → e4/f5/a6/b7/e4f5...jpg
    4. Generate WRITE-ONLY SAS URL for originals/e4/f5/.../...jpg (30 min expiry)
    5. INSERT media_items (status = Uploading, placeholder — no blob yet)
    6. Return { mediaId, uploadUrl (SAS), blobPath }

API is done. ~100ms. Zero file I/O.


═══════════ STEP 2: DIRECT UPLOAD (Browser → Blob, API not involved) ═══════════

Small file (< 256 MB):
    Browser → PUT {uploadUrl}  →  Azure Blob Storage
    (single request, progress tracked via XMLHttpRequest.upload.onprogress)

Large file (≥ 256 MB):
    Browser → Azure Block Blob API:
    PUT {uploadUrl}&comp=block&blockid=AAA (4 MB)  →  Blob
    PUT {uploadUrl}&comp=block&blockid=AAB (4 MB)  →  Blob
    PUT {uploadUrl}&comp=block&blockid=AAC (4 MB)  →  Blob
    (4 parallel, per-block progress)
    ...
    PUT {uploadUrl}&comp=blocklist  →  Blob (commit)

API is NOT involved. Full Blob bandwidth. No B1 bottleneck.


═══════════ STEP 3: NOTIFY COMPLETE (API — ~200ms) ═══════════

Browser → POST /api/media/upload/complete
          { mediaId: "e4f5a6b7..." }

API (UploadService.CompleteUploadAsync):
    1. HEAD blob → verify exists, get file size
    2. UPDATE media_items: file_size_bytes, status = Pending
    3. Enqueue to "media-processing" Storage Queue:
       { mediaId, blobPath, contentType, fileName, userId }
    4. Return { status: "Pending" }

API is done. ~200ms. Zero file I/O.


═══════════ STEP 4: ASYNC PROCESSING (BackgroundService — seconds) ═══════════

ProcessingBackgroundService dequeues from "media-processing":
    1. Download blob header (first few KB — not full file) for metadata
    2. MetadataExtractor → CapturedAt, width, height, codec
    3. Generate thumbnail:
       Photo JPEG/PNG → ImageSharp
       Photo HEIC → Magick.NET
       Video → FFmpeg (keyframe at 2 sec)
    4. Upload thumbnail → thumbnails/ container
    5. UPDATE Postgres: captured_at, width, height, codec, thumbnail_blob_path
    6. If HEVC video → enqueue to "transcode-jobs" queue, status = Transcoding
       Else → status = Complete, playback_blob_path = original_blob_path
    7. DELETE queue message (acknowledge)
    8. Push via SignalR: { mediaId, status, thumbnailUrl } → user's browser


═══════════ STEP 5: TRANSCODE (BackgroundService + ACI — minutes) ═══════════

TranscodeBackgroundService dequeues from "transcode-jobs":
    1. Create ACI (FFmpeg) via Azure SDK
    2. Poll ACI status every 30 sec
    3. On success: UPDATE playback_blob_path, status = Complete
    4. On failure: status = Failed (original still downloadable)
    5. DELETE ACI container group (cleanup)
    6. DELETE queue message
    7. Push via SignalR: { mediaId, status, playbackUrl }
```

### State Machine

```
                     request          complete            dequeue
    ─────────────── ─────────────── ─────────────── ───────────────
    │  Uploading  │ → │   Pending   │ → │ Processing │ → │ Complete │
    └─────────────┘   └─────────────┘   └─────┬──────┘   └──────────┘
                                              │
                                         (if HEVC)
                                              │
                                       ┌──────▼──────┐
                                       │ Transcoding │ → Complete
                                       └──────┬──────┘
                                              │
                                       ┌──────▼──────┐
                                       │   Failed    │
                                       └─────────────┘
```

---

## 12a. Bulk Upload + Blob Throttling & Retry

### The Problem

User selects 200 iPhone photos. Without throttling:
- 200 SAS URL requests hit the API simultaneously
- 200 concurrent PUT requests hit Azure Blob Storage
- Azure Blob throttles at ~20,000 requests/sec per storage account (not a real limit here),
  BUT per-blob rate limits + network saturation on the client can cause HTTP 429 or 503 errors
- Failed uploads show as errors — bad UX

### Solution: Concurrency Limiter + Exponential Backoff

```typescript
// client/src/hooks/useUpload.ts

interface UploadConfig {
    maxConcurrentUploads: 3,       // Max files uploading simultaneously
    maxConcurrentBlocks: 4,        // Max blocks per file (for chunked uploads)
    blockSizeBytes: 4 * 1024 * 1024, // 4 MB per block
    maxRetries: 5,                 // Per block/file
    initialRetryDelayMs: 1000,     // 1 sec, doubles each retry
    maxRetryDelayMs: 30000,        // Cap at 30 sec
}

// Upload queue state:
// [file1: uploading] [file2: uploading] [file3: uploading]
// [file4: queued] [file5: queued] ... [file200: queued]
//
// As file1 completes → file4 starts. Always 3 in-flight.
```

### Retry Logic (per block or per file)

```typescript
async function uploadWithRetry(url: string, body: Blob, attempt = 0): Promise<void> {
    try {
        await fetch(url, {
            method: 'PUT',
            body,
            headers: { 'x-ms-blob-type': 'BlockBlob' }
        });
    } catch (error) {
        if (attempt >= config.maxRetries) throw error;

        const status = error.response?.status;

        // Retry on: throttle (429), server busy (503), timeout (408), network error
        if (status === 429 || status === 503 || status === 408 || !status) {
            const delay = Math.min(
                config.initialRetryDelayMs * Math.pow(2, attempt),  // Exponential
                config.maxRetryDelayMs
            );
            // Add jitter: ±25% to prevent thundering herd
            const jitter = delay * (0.75 + Math.random() * 0.5);
            await sleep(jitter);
            return uploadWithRetry(url, body, attempt + 1);
        }

        throw error; // 4xx errors (except 429/408) are not retried
    }
}
```

### Bulk Upload UX

```
User selects 200 photos

┌────────────────────────────────────────────────────┐
│ Uploading 200 files                 3 of 200 done  │
│                                                    │
│ beach.jpg         ████████████████████ 100% ✅     │
│ sunset.heic       ██████████████░░░░░░  72%        │
│ park.jpg          ████████░░░░░░░░░░░░  40%        │
│ dog.mov           ⏳ Queued (4 of 200)              │
│ ... 196 more queued                                │
│                                                    │
│ [Cancel All]                                       │
└────────────────────────────────────────────────────┘

If a file gets 429 throttled:
│ cat.heic          ████████░░ 40% ⟳ Retry 1/5...   │
│                   (backing off 2 sec)              │

If a file fails after 5 retries:
│ broken.mov        ████░░░░░░ 20% ❌ Failed          │
│                   [Retry] [Skip]                    │
```

### Failure Handling by Layer

| Layer | Error | Handling |
|-------|-------|----------|
| **Frontend → Blob** | HTTP 429 (throttled) | Exponential backoff + retry (up to 5x) |
| **Frontend → Blob** | HTTP 503 (server busy) | Same as 429 |
| **Frontend → Blob** | Network timeout | Retry with same block (idempotent PUT) |
| **Frontend → Blob** | HTTP 403 (SAS expired) | Request new SAS URL from API, retry |
| **Frontend → API** | HTTP 5xx | Retry /request or /complete call |
| **Queue processing** | Processing fails | Queue message reappears after visibility timeout → auto-retry |
| **ACI transcode** | FFmpeg error | Mark as Failed, do not retry (bad file) |
| **ACI transcode** | ACI timeout/crash | Queue message reappears → retry with fresh ACI |

### SAS URL Expiry During Bulk Upload

If user queues 200 files but only 3 upload at a time, file #200 may not start for 30+ minutes.
**Solution:** Don't request SAS URLs upfront. Request them **just before each file starts uploading:**

```
File enters upload slot →
    1. POST /api/media/upload/request  (get fresh SAS URL, 30 min expiry)
    2. Upload to Blob
    3. POST /api/media/upload/complete
```

This way each SAS URL is fresh. No expiry issues.

---

## 12b. SignalR — Real-Time Status Push

### Why

After upload completes, user doesn't know when thumbnail/transcode finishes.
SignalR pushes status changes instantly — no polling.

### Hub (API)

```csharp
// CleanSweep.API/Hubs/MediaHub.cs
[Authorize]
public class MediaHub : Hub
{
    // No methods needed — server pushes only.
    // Client connects and listens.
}
```

### Push from BackgroundService

```csharp
// Injected into ProcessingBackgroundService + TranscodeBackgroundService
private readonly IHubContext<MediaHub> _hubContext;

// After processing completes:
await _hubContext.Clients.User(mediaItem.UserId).SendAsync(
    "MediaStatusChanged",
    new {
        mediaId = mediaItem.Id,
        status = mediaItem.ProcessingStatus.ToString(),
        thumbnailUrl = thumbnailSasUrl,
        playbackUrl = playbackSasUrl
    });
```

### Frontend Client

```typescript
// client/src/hooks/useSignalR.ts
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';

const connection = new HubConnectionBuilder()
    .withUrl(`${API_BASE}/hubs/media`, {
        accessTokenFactory: () => getAccessToken()
    })
    .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])  // Retry delays
    .build();

connection.on('MediaStatusChanged', (update) => {
    // Instantly update React Query cache for this media item
    queryClient.setQueryData(['media', update.mediaId], (old) => ({
        ...old,
        status: update.status,
        thumbnailUrl: update.thumbnailUrl,
        playbackUrl: update.playbackUrl,
    }));
});

// Start on login, stop on logout
```

### Program.cs additions

```csharp
builder.Services.AddSignalR();
// ...
app.MapHub<MediaHub>("/hubs/media");
```

### npm package

```bash
npm install @microsoft/signalr
```

---

## 13. Blob Path Generator

```csharp
// CleanSweep.Application/Helpers/BlobPathGenerator.cs
public static class BlobPathGenerator
{
    /// <summary>
    /// Generates a hash-partitioned blob path from a GUID.
    /// Example: a1b2c3d4-... → "a1/b2/c3/d4/a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6.jpg"
    /// First 8 hex chars (4 segments × 2 chars) define directory depth.
    /// </summary>
    public static string Generate(Guid id, string extension)
    {
        var hex = id.ToString("N"); // 32 hex chars, no hyphens
        return $"{hex[0..2]}/{hex[2..4]}/{hex[4..6]}/{hex[6..8]}/{hex}{extension}";
    }
}
```

---

## 14. Transcoding Pipeline

```
TranscodeBackgroundService (polls every 1 min, or 5s when active)
    │
    ▼
ITranscodeJobRunner.RunAsync (implemented by AciTranscodeJobRunner)
    │
    ├── Creates ACI container group via Azure.ResourceManager.ContainerInstance SDK
    │   ├── Image: linuxserver/ffmpeg (or jrottenberg/ffmpeg)
    │   ├── Command: ffmpeg -i <input-sas-url> -c:v libx264 -crf 23 -preset medium -c:a aac -movflags +faststart <output>
    │   ├── Mount: Azure File Share or use SAS URLs for input/output
    │   ├── CPU: 1 core, Memory: 1.5 GB
    │   └── Restart policy: Never
    │
    ├── Polls ACI status until terminated
    ├── On success: update MediaItem.PlaybackBlobPath + ProcessingStatus = Complete
    ├── On failure: ProcessingStatus = Failed, log error
    └── Delete ACI container group (cleanup)
```

**FFmpeg command breakdown:**
- `-c:v libx264` — transcode video to H.264 (universal browser support)
- `-crf 23` — constant rate factor (quality). 23 = visually near-lossless for most content. Lower = better quality, larger file.
- `-preset medium` — encoding speed/compression tradeoff. "medium" is balanced.
- `-c:a aac` — transcode audio to AAC (universal support)
- `-movflags +faststart` — moves the MP4 moov atom to the start of file, enabling progressive playback (streaming before full download)

---

## 15. Configuration

### Abstraction Principle

**Every external component is behind an interface in `CleanSweep.Application`.** The Application layer has ZERO knowledge of Azure, Postgres, SignalR, or any specific provider. Swapping from Azure Storage Queue to Service Bus, Kafka, or RabbitMQ requires:
1. Write a new class implementing the same interface
2. Change one line in `DependencyInjection.cs`
3. Zero changes to Application layer, controllers, or background services

```
┌─────────────────────────────────────────────────────────────┐
│ Application Layer (interfaces only — no Azure/Postgres refs) │
├─────────────────────────────────────────────────────────────┤
│  IBlobStorageService      ← could be Azure Blob, S3, MinIO  │
│  IMediaProcessingQueue    ← could be Storage Queue, Service  │
│  ITranscodeQueue            Bus, Kafka, RabbitMQ             │
│  ITranscoder              ← could be ACI, local FFmpeg, AWS  │
│  IMediaRepository         ← could be Postgres, SQL Server,   │
│  IAlbumRepository           Cosmos DB, MongoDB               │
│  IShareLinkRepository                                        │
│  IMetadataExtractor       ← could be MetadataExtractor,      │
│  IThumbnailGenerator        ExifTool, etc.                   │
│  ICurrentUserService                                         │
│  INotificationService     ← could be SignalR, WebSocket, SSE │
└─────────────────────────────────────────────────────────────┘
```

### INotificationService (new — abstracts SignalR)

```csharp
// CleanSweep.Application/Interfaces/INotificationService.cs
public interface INotificationService
{
    Task NotifyMediaStatusChangedAsync(string userId, MediaStatusUpdate update, CancellationToken ct = default);
}

public class MediaStatusUpdate
{
    public Guid MediaId { get; set; }
    public string Status { get; set; } = null!;
    public string? ThumbnailUrl { get; set; }
    public string? PlaybackUrl { get; set; }
}
```

Application layer calls `INotificationService`. Infrastructure implements it via SignalR today. Tomorrow could be replaced with Server-Sent Events, Azure Web PubSub, or anything else — no changes to Application code.

### Strongly-Typed Configuration (Options Pattern)

All config is in `appsettings.json`, overridable by Azure App Service environment variables.

```csharp
// CleanSweep.Application/Configuration/StorageOptions.cs
public class StorageOptions
{
    public const string SectionName = "Storage";

    public string ConnectionString { get; set; } = null!;
    public string OriginalsContainer { get; set; } = "originals";
    public string PlaybackContainer { get; set; } = "playback";
    public string ThumbnailsContainer { get; set; } = "thumbnails";
    public int SasExpiryMinutes { get; set; } = 30;
    public int WriteSasExpiryMinutes { get; set; } = 30;
}

// CleanSweep.Application/Configuration/QueueOptions.cs
public class QueueOptions
{
    public const string SectionName = "Queue";

    public string ConnectionString { get; set; } = null!;
    public string MediaProcessingQueue { get; set; } = "media-processing";
    public string TranscodeQueue { get; set; } = "transcode-jobs";
    public int ProcessingVisibilityTimeoutSeconds { get; set; } = 300;   // 5 min
    public int TranscodeVisibilityTimeoutSeconds { get; set; } = 1800;   // 30 min
    public int MaxDequeueCount { get; set; } = 5;
}

// CleanSweep.Application/Configuration/TranscodeOptions.cs
public class TranscodeOptions
{
    public const string SectionName = "Transcode";

    public string ResourceGroup { get; set; } = null!;
    public string Location { get; set; } = "centralindia";
    public string FfmpegImage { get; set; } = "jrottenberg/ffmpeg:latest";
    public int CpuCores { get; set; } = 1;
    public double MemoryGb { get; set; } = 1.5;
    public int Crf { get; set; } = 23;
    public string Preset { get; set; } = "medium";
}

// CleanSweep.Application/Configuration/JwtOptions.cs
public class JwtOptions
{
    public const string SectionName = "Jwt";

    public string Key { get; set; } = null!;
    public string Issuer { get; set; } = "CleanSweep";
    public string Audience { get; set; } = "CleanSweepApp";
    public int AccessTokenExpiryMinutes { get; set; } = 15;
    public int RefreshTokenExpiryDays { get; set; } = 7;
}

// CleanSweep.Application/Configuration/UploadOptions.cs
public class UploadOptions
{
    public const string SectionName = "Upload";

    public long MaxFileSizeBytes { get; set; } = 5L * 1024 * 1024 * 1024;  // 5 GB
    public string[] AllowedExtensions { get; set; } = [".jpg", ".jpeg", ".png", ".heic", ".heif", ".mp4", ".mov", ".m4v"];
    public string[] AllowedContentTypes { get; set; } = ["image/jpeg", "image/png", "image/heic", "image/heif", "video/mp4", "video/quicktime", "video/x-m4v"];
}
```

### appsettings.json (complete)

```json
{
  "ConnectionStrings": {
    "Postgres": "Host=<server>;Database=cleansweep;Username=<user>;Password=<pass>;SSL Mode=Require;"
  },
  "Storage": {
    "ConnectionString": "DefaultEndpointsProtocol=https;AccountName=<name>;AccountKey=<key>;EndpointSuffix=core.windows.net",
    "OriginalsContainer": "originals",
    "PlaybackContainer": "playback",
    "ThumbnailsContainer": "thumbnails",
    "SasExpiryMinutes": 15,
    "WriteSasExpiryMinutes": 30
  },
  "Queue": {
    "ConnectionString": "<same-as-Storage-or-separate>",
    "MediaProcessingQueue": "media-processing",
    "TranscodeQueue": "transcode-jobs",
    "ProcessingVisibilityTimeoutSeconds": 300,
    "TranscodeVisibilityTimeoutSeconds": 1800,
    "MaxDequeueCount": 5
  },
  "Transcode": {
    "ResourceGroup": "rv-storage",
    "Location": "centralindia",
    "FfmpegImage": "jrottenberg/ffmpeg:latest",
    "CpuCores": 1,
    "MemoryGb": 1.5,
    "Crf": 23,
    "Preset": "medium"
  },
  "AzureAd": {
    "Instance": "https://login.microsoftonline.com/",
    "TenantId": "<your-tenant-id>",
    "ClientId": "<app-registration-client-id>",
    "Audience": "api://<app-registration-client-id>"
  },
  "Upload": {
    "MaxFileSizeBytes": 5368709120,
    "AllowedExtensions": [".jpg", ".jpeg", ".png", ".heic", ".heif", ".mp4", ".mov", ".m4v"],
    "AllowedContentTypes": ["image/jpeg", "image/png", "image/heic", "image/heif", "video/mp4", "video/quicktime", "video/x-m4v"]
  },
  "Logging": {
    "LogLevel": {
      "Default": "Information",
      "Microsoft.AspNetCore": "Warning",
      "Microsoft.EntityFrameworkCore.Database.Command": "Warning",
      "CleanSweep": "Information"
    }
  }
}
```

### Azure Environment Variable Override

Azure App Service environment variables override `appsettings.json` using `__` (double underscore) as section separator:

```
ConnectionStrings__Postgres = Host=prod-server;Database=cleansweep;...
Storage__ConnectionString = DefaultEndpointsProtocol=https;AccountName=...
Queue__ConnectionString = ...
Jwt__Key = <production-secret>
Transcode__ResourceGroup = rv-storage
Logging__LogLevel__Default = Information
```

ASP.NET Core loads in order: `appsettings.json` → `appsettings.{Environment}.json` → environment variables → user secrets (dev only). **Environment variables always win.**

---

## 15a. Bootloader — Composition Root (Program.cs)

All components are registered here. Nothing is newed-up elsewhere. The app doesn't start until everything is wired.

```csharp
// CleanSweep.API/Program.cs — THE BOOTLOADER

var builder = WebApplication.CreateBuilder(args);

// ═══════════════════════════════════════════════════════════════
// STEP 1: CONFIGURATION — bind all options from appsettings.json
// ═══════════════════════════════════════════════════════════════
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.SectionName));
builder.Services.Configure<QueueOptions>(builder.Configuration.GetSection(QueueOptions.SectionName));
builder.Services.Configure<TranscodeOptions>(builder.Configuration.GetSection(TranscodeOptions.SectionName));
builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection(JwtOptions.SectionName));
builder.Services.Configure<UploadOptions>(builder.Configuration.GetSection(UploadOptions.SectionName));

// ═══════════════════════════════════════════════════════════════
// STEP 2: LOGGING — structured logging with correlation IDs
// ═══════════════════════════════════════════════════════════════
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddAzureWebAppDiagnostics();  // Streams to App Service logs

builder.Services.AddHttpContextAccessor();     // Required for correlation ID

// ═══════════════════════════════════════════════════════════════
// STEP 3: APPLICATION LAYER — services (no infra knowledge)
// ═══════════════════════════════════════════════════════════════
builder.Services.AddApplication();

// ═══════════════════════════════════════════════════════════════
// STEP 4: INFRASTRUCTURE LAYER — all external components
// ═══════════════════════════════════════════════════════════════
builder.Services.AddInfrastructure(builder.Configuration);

// ═══════════════════════════════════════════════════════════════
// STEP 5: BACKGROUND SERVICES — queue consumers
// ═══════════════════════════════════════════════════════════════
builder.Services.AddHostedService<ProcessingBackgroundService>();
builder.Services.AddHostedService<TranscodeBackgroundService>();

// ═══════════════════════════════════════════════════════════════
// STEP 6: AUTH — Azure AD App Registration
// ═══════════════════════════════════════════════════════════════
// NuGet: Microsoft.Identity.Web
// https://learn.microsoft.com/en-us/entra/identity-platform/

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"))
    .EnableTokenAcquisitionToCallDownstreamApi()
    .AddInMemoryTokenCaches();

// App Roles from Azure AD → .NET roles
// User.IsInRole(\"owner\") works after this
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy(\"OwnerOnly\", policy => policy.RequireRole(\"owner\"));
    options.AddPolicy(\"Authenticated\", policy => policy.RequireAuthenticatedUser());
});

// SignalR token from query string (WebSocket can't send headers)
builder.Services.Configure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
{
    var existingHandler = options.Events?.OnMessageReceived;
    options.Events ??= new JwtBearerEvents();
    options.Events.OnMessageReceived = async context =>
    {
        if (existingHandler != null) await existingHandler(context);
        var accessToken = context.Request.Query[\"access_token\"];
        var path = context.HttpContext.Request.Path;
        if (!string.IsNullOrEmpty(accessToken) && path.StartsWithSegments(\"/hubs\"))
            context.Token = accessToken;
    };
});

// ═══════════════════════════════════════════════════════════════
// STEP 7: SIGNALR + CONTROLLERS + SWAGGER
// ═══════════════════════════════════════════════════════════════
builder.Services.AddSignalR();
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ═══════════════════════════════════════════════════════════════
// BUILD + MIDDLEWARE PIPELINE
// ═══════════════════════════════════════════════════════════════
var app = builder.Build();

// Request tracing — adds correlation ID to every request
app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseMiddleware<ExceptionHandlingMiddleware>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();

app.UseStaticFiles();
app.MapControllers();
app.MapHub<MediaHub>("/hubs/media");
app.MapFallbackToFile("index.html");

app.Run();
```

---

## 15b. DI Registration (Loosely Coupled)

### Application Layer

```csharp
// CleanSweep.Application/DependencyInjection.cs
namespace Microsoft.Extensions.DependencyInjection;

public static class ApplicationServiceCollectionExtensions
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        // Application services — depend on interfaces ONLY
        services.AddScoped<UploadService>();
        services.AddScoped<MediaService>();
        services.AddScoped<BrowseService>();
        services.AddScoped<AlbumService>();
        services.AddScoped<ShareService>();
        return services;
    }
}
```

### Infrastructure Layer — The Wiring Point

```csharp
// CleanSweep.Infrastructure/DependencyInjection.cs
// ──────────────────────────────────────────────────────────────
// THIS IS THE ONLY PLACE where concrete implementations are bound
// to interfaces. Swapping a provider = change ONE line here.
// ──────────────────────────────────────────────────────────────
namespace Microsoft.Extensions.DependencyInjection;

public static class InfrastructureServiceCollectionExtensions
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        // ════════════════════════════════════════════════════════
        // DATABASE — swap Postgres for SQL Server, Cosmos, etc.
        // Change: UseNpgsql → UseSqlServer / UseCosmos
        // ════════════════════════════════════════════════════════
        services.AddDbContext<AppDbContext>(opt =>
            opt.UseNpgsql(config.GetConnectionString("Postgres\")));

        // No ASP.NET Identity — Azure AD handles auth.
        // AppUser table is a lightweight profile, auto-created on first API call.

        services.AddScoped<IMediaRepository, MediaRepository>();
        services.AddScoped<IAlbumRepository, AlbumRepository>();
        services.AddScoped<IShareLinkRepository, ShareLinkRepository>();

        // ════════════════════════════════════════════════════════
        // BLOB STORAGE — swap Azure Blob for S3, MinIO, etc.
        // Change: AzureBlobStorageService → S3BlobStorageService
        // ════════════════════════════════════════════════════════
        services.AddSingleton<IBlobStorageService, AzureBlobStorageService>();

        // ════════════════════════════════════════════════════════
        // QUEUES — swap Azure Storage Queue for Service Bus,
        // Kafka, RabbitMQ, etc.
        // Change: AzureMediaProcessingQueue → ServiceBusProcessingQueue
        // ════════════════════════════════════════════════════════
        services.AddSingleton<IMediaProcessingQueue, AzureMediaProcessingQueue>();
        services.AddSingleton<ITranscodeQueue, AzureTranscodeQueue>();

        // ════════════════════════════════════════════════════════
        // TRANSCODER — swap ACI for local FFmpeg, AWS Batch, etc.
        // Change: AciTranscoder → LocalFfmpegTranscoder
        // ════════════════════════════════════════════════════════
        services.AddScoped<ITranscoder, AciTranscoder>();

        // ════════════════════════════════════════════════════════
        // NOTIFICATIONS — swap SignalR for SSE, Web PubSub, etc.
        // Change: SignalRNotificationService → SseNotificationService
        // ════════════════════════════════════════════════════════
        services.AddScoped<INotificationService, SignalRNotificationService>();

        // ════════════════════════════════════════════════════════
        // PROCESSORS — extensible via IEnumerable<IThumbnailGenerator>
        // Add new format: register a new implementation here
        // ════════════════════════════════════════════════════════
        services.AddScoped<IMetadataExtractor, ExifMetadataExtractor>();
        services.AddScoped<IThumbnailGenerator, ImageThumbnailGenerator>();
        services.AddScoped<IThumbnailGenerator, HeicThumbnailGenerator>();
        services.AddScoped<IThumbnailGenerator, VideoThumbnailGenerator>();

        // ════════════════════════════════════════════════════════
        // CURRENT USER — reads from HttpContext
        // ════════════════════════════════════════════════════════
        services.AddScoped<ICurrentUserService, CurrentUserService>();

        return services;
    }
}
```

### Swap Example: Azure Storage Queue → Service Bus

```csharp
// BEFORE (Azure Storage Queue):
services.AddSingleton<IMediaProcessingQueue, AzureMediaProcessingQueue>();

// AFTER (Service Bus):
services.AddSingleton<IMediaProcessingQueue, ServiceBusMediaProcessingQueue>();

// That's it. ONE line change. Application layer, controllers,
// background services — nothing else changes.
```

---

## 15c. Logging & Request Tracing

### Correlation ID Middleware

Every request gets a unique correlation ID. Passed through to all log entries, queue messages, and downstream calls. Enables end-to-end tracing.

```csharp
// CleanSweep.API/Middleware/CorrelationIdMiddleware.cs
public class CorrelationIdMiddleware
{
    private const string CorrelationIdHeader = "X-Correlation-ID";
    private readonly RequestDelegate _next;

    public CorrelationIdMiddleware(RequestDelegate next) => _next = next;

    public async Task InvokeAsync(HttpContext context)
    {
        // Use incoming correlation ID or generate new one
        if (!context.Request.Headers.TryGetValue(CorrelationIdHeader, out var correlationId))
            correlationId = Guid.NewGuid().ToString("N");

        context.Items["CorrelationId"] = correlationId.ToString();
        context.Response.Headers[CorrelationIdHeader] = correlationId.ToString();

        // Add to logging scope — all logs in this request include CorrelationId
        using (context.RequestServices.GetRequiredService<ILogger<CorrelationIdMiddleware>>()
            .BeginScope(new Dictionary<string, object> { ["CorrelationId"] = correlationId.ToString()! }))
        {
            await _next(context);
        }
    }
}
```

### Request Logging Middleware

Logs every HTTP request in and response out with timing.

```csharp
// CleanSweep.API/Middleware/RequestLoggingMiddleware.cs
public class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggingMiddleware> _logger;

    public RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        var sw = Stopwatch.StartNew();
        var method = context.Request.Method;
        var path = context.Request.Path;
        var query = context.Request.QueryString;

        _logger.LogInformation("→ {Method} {Path}{Query}", method, path, query);

        try
        {
            await _next(context);
        }
        finally
        {
            sw.Stop();
            _logger.LogInformation("← {Method} {Path} {StatusCode} {ElapsedMs}ms",
                method, path, context.Response.StatusCode, sw.ElapsedMilliseconds);
        }
    }
}
```

### Log Output Example

```
info: CleanSweep.API.Middleware.RequestLoggingMiddleware[0]
      => CorrelationId: a1b2c3d4e5f6a7b8
      → POST /api/media/upload/request
info: CleanSweep.Application.Services.UploadService[0]
      => CorrelationId: a1b2c3d4e5f6a7b8
      Generating upload SAS for user user-123, file beach.jpg (8000000 bytes)
info: CleanSweep.Infrastructure.Storage.AzureBlobStorageService[0]
      => CorrelationId: a1b2c3d4e5f6a7b8
      Generated write SAS for originals/e4/f5/a6/b7/e4f5...jpg (30 min expiry)
info: CleanSweep.API.Middleware.RequestLoggingMiddleware[0]
      => CorrelationId: a1b2c3d4e5f6a7b8
      ← POST /api/media/upload/request 200 87ms
```

### Logging in Services

Every service injects `ILogger<T>`. Key events logged at Information level:

```csharp
public class UploadService
{
    private readonly ILogger<UploadService> _logger;

    public async Task<UploadRequest> RequestUploadAsync(string fileName, string contentType, long sizeBytes, CancellationToken ct)
    {
        _logger.LogInformation("Upload requested: {FileName} ({ContentType}, {SizeBytes} bytes) by user {UserId}",
            fileName, contentType, sizeBytes, _currentUser.UserId);

        // ... generate SAS, save to DB ...

        _logger.LogInformation("Upload SAS generated for media {MediaId}, blob path {BlobPath}",
            mediaItem.Id, blobPath);

        return result;
    }
}
```

### Logging in Background Services

```csharp
public class ProcessingBackgroundService : BackgroundService
{
    private readonly ILogger<ProcessingBackgroundService> _logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ProcessingBackgroundService started, listening on queue");

        while (!stoppingToken.IsCancellationRequested)
        {
            var item = await _queue.DequeueAsync(visibilityTimeout, stoppingToken);
            if (item == null)
            {
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
                continue;
            }

            _logger.LogInformation("Processing media {MediaId}: {FileName} ({ContentType})",
                item.Message.MediaId, item.Message.FileName, item.Message.ContentType);

            try
            {
                // ... process ...
                _logger.LogInformation("Processing complete for {MediaId}. Status: {Status}",
                    item.Message.MediaId, finalStatus);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Processing FAILED for {MediaId}: {FileName}",
                    item.Message.MediaId, item.Message.FileName);
            }
        }
    }
}
```

### Log Levels Used

| Level | When |
|-------|------|
| **Information** | Request in/out, upload requested, processing started/completed, transcode started/completed, queue enqueue/dequeue |
| **Warning** | SAS URL near expiry, retry on throttle, queue message dequeue count > 3 |
| **Error** | Processing failed, transcode failed, ACI error, unhandled exception |
| **Debug** | Blob path generation, metadata values, thumbnail dimensions (dev only) |

### Azure App Service Log Streaming

```bash
# Stream logs in real time
az webapp log tail --name <app-name> --resource-group rv-storage

# Or in Azure Portal → App Service → Log stream
```

### Queue Message Tracing

Queue messages carry the correlation ID so processing logs can be traced end-to-end:

```csharp
public class ProcessingMessage
{
    public Guid MediaId { get; set; }
    public string BlobPath { get; set; } = null!;
    public string ContentType { get; set; } = null!;
    public string FileName { get; set; } = null!;
    public string UserId { get; set; } = null!;
    public string CorrelationId { get; set; } = null!;  // ← from HTTP request
}
```

BackgroundService logs with the correlation ID:

```csharp
using (_logger.BeginScope(new Dictionary<string, object> { ["CorrelationId"] = msg.CorrelationId }))
{
    _logger.LogInformation("Processing media {MediaId}", msg.MediaId);
    // ... all logs inside this block include CorrelationId
}
```

Full trace: `Upload request → Queue message → BackgroundService processing → SignalR push` — all with the same correlation ID.

---

## 16. Local Development Setup

No Docker required. Connect directly to Azure services during development.

### Prerequisites

```bash
# .NET 8 SDK
brew install dotnet@8

# Node.js (for frontend)
brew install node

# FFmpeg (for video thumbnail extraction locally)
brew install ffmpeg

# Azurite (local blob storage emulator — optional, can use real Azure storage)
npm install -g azurite
```

### Running Locally

```bash
# 1. Start Azurite (optional — for offline blob dev)
azurite --silent --location ./azurite-data &

# 2. Run the API
cd src/CleanSweep.API
dotnet run

# 3. Run the frontend (separate terminal)
cd client
npm install
npm run dev
```

### appsettings.Development.json

```json
{
  "ConnectionStrings": {
    "Postgres": "Host=<your-azure-postgres>.postgres.database.azure.com;Database=cleansweep;Username=<user>;Password=<pass>;SSL Mode=Require;",
    "BlobStorage": "UseDevelopmentStorage=true"
  }
}
```

- **Postgres:** Connect directly to Azure Postgres (existing B1ms). No local Postgres needed.
- **Blob Storage:** Use Azurite for local dev (`UseDevelopmentStorage=true`), or point to real Azure storage account connection string.
- **FFmpeg:** Installed via `brew install ffmpeg` on Mac. Used by `VideoThumbnailGenerator` for keyframe extraction.

---

## 17. Deployment

### App Service (Zip Deploy)

```bash
# Build + publish
cd src/CleanSweep.API
dotnet publish -c Release -o ./publish

# Deploy to Azure App Service
cd publish
zip -r ../deploy.zip .
az webapp deploy --resource-group rv-storage --name <app-name> --src-path ../deploy.zip --type zip
```

### App Service Startup Command

Set in Azure Portal → App Service → Configuration → General Settings → Startup Command:

```bash
apt-get update && apt-get install -y --no-install-recommends ffmpeg && dotnet CleanSweep.API.dll
```

> **Note:** This installs FFmpeg on each cold start. For faster starts, use the `Xabe.FFmpeg` NuGet
> package which auto-downloads the binary on first use (no system install needed).

### Frontend Deployment

The React SPA is built and served as static files from the API:

```bash
# Build frontend
cd client
npm run build

# Copy dist/ to API's wwwroot/ before publishing
cp -r dist/ ../src/CleanSweep.API/wwwroot/
```

The API's `app.UseStaticFiles()` + `app.MapFallbackToFile("index.html")` serves the SPA.

---

## 18. Phase 1 Task Breakdown

### Group A: Foundation

- [ ] A1. `dotnet new sln` + create all 4 `.csproj` files + set `<ProjectReference>` entries
- [ ] A2. Domain entities: `MediaItem`, `Album`, `AlbumMedia`, `AppUser`, `ShareLink`
- [ ] A3. Domain enums: `MediaType`, `ProcessingStatus` (6 states: Uploading→Pending→Processing→Transcoding→Complete/Failed)
- [ ] A4. Application interfaces (all 10) + DTOs + `BlobPathGenerator`
- [ ] A5. Application configuration classes (`StorageOptions`, `QueueOptions`, `TranscodeOptions`, `JwtOptions`, `UploadOptions`)
- [ ] A6. Application `DependencyInjection.cs`

### Group B: Infrastructure

- [ ] B1. `AppDbContext` + EF configurations for all entities
- [ ] B2. Initial EF migration (`dotnet ef migrations add InitialCreate`)
- [ ] B3. `AzureBlobStorageService` (implements `IBlobStorageService` — SAS URL generation for read + write)
- [ ] B4. `AzureMediaProcessingQueue` + `AzureTranscodeQueue` (implements queue interfaces via `Azure.Storage.Queues`)
- [ ] B5. `ExifMetadataExtractor` (MetadataExtractor NuGet)
- [ ] B6. `ImageThumbnailGenerator` (ImageSharp) + `HeicThumbnailGenerator` (Magick.NET) + `VideoThumbnailGenerator` (FFmpeg CLI)
- [ ] B7. `AciTranscoder` (implements `ITranscoder` — creates ACI via Azure SDK)
- [ ] B8. `SignalRNotificationService` (implements `INotificationService`)
- [ ] B9. Repositories: `MediaRepository`, `AlbumRepository`, `ShareLinkRepository`
- [ ] B10. `CurrentUserService`
- [ ] B11. Infrastructure `DependencyInjection.cs` (all interface → implementation bindings)

### Group C: Application Services

- [ ] C1. `UploadService` (SAS URL generation + upload complete + enqueue)
- [ ] C2. `MediaService` + `BrowseService` (browse, filter, detail)
- [ ] C3. `AlbumService` + `ShareService`

### Group D: API

- [ ] D1. `Program.cs` — full bootloader (config, logging, DI, Azure AD auth, SignalR, middleware pipeline)
- [ ] D2. `CorrelationIdMiddleware` + `RequestLoggingMiddleware` + `ExceptionHandlingMiddleware`
- [ ] D3. `MediaHub` (SignalR — status push)
- [ ] D4. `MediaController` — /request, /complete, browse, download, delete
- [ ] D5. `AlbumController` + `ShareController`
- [ ] D6. `AdminController` (owner-only: list users)
- [ ] D7. `ProcessingBackgroundService` (dequeues media-processing queue)
- [ ] D8. `TranscodeBackgroundService` (dequeues transcode-jobs queue)
- [ ] D9. `appsettings.json` + `appsettings.Development.json`

### Group E: Azure AD Setup

- [ ] E0. Create Azure AD App Registration (Azure Portal)
- [ ] E1. Configure App Roles: `owner`, `viewer`
- [ ] E2. Configure API permissions + expose API scope
- [ ] E3. Create SPA redirect URI for React frontend
- [ ] E4. Assign roles to your Microsoft account (owner) + test accounts (viewer)

### Group F: Frontend

- [ ] F1. Vite + React + TypeScript scaffold, routing, `.env`
- [ ] F2. MSAL.js setup — `@azure/msal-react` + `@azure/msal-browser` for Azure AD login
- [ ] F3. API client layer (`client.ts` + MSAL token interceptor)
- [ ] F4. `MediaUploader` — drag-drop, chunked direct-to-blob upload, progress bars, retry
- [ ] F5. `MediaGrid` + `MediaTimeline` — browse with lazy loading
- [ ] F6. `MediaViewer` — full-screen photo zoom + video player
- [ ] F7. `AppShell` — sidebar + topbar layout
- [ ] F8. SignalR client (`@microsoft/signalr`) — real-time status updates

### Group G: Setup & Deploy

- [ ] F1. Create Azure App Service Plan (B1 Linux) + App Service in rv-storage
- [ ] F2. Create `cleansweep` database on existing Postgres server
- [ ] F3. Create blob containers (`originals`, `playback`, `thumbnails`) in existing storage account
- [ ] F4. First zip deploy to App Service

---

## 19. Verification Checklist

- [ ] `dotnet build CleanSweep.sln` — zero errors, zero warnings
- [ ] No cyclic dependency: inspect `.csproj` references (Domain→∅, Application→Domain, Infrastructure→Application+Domain, API→Infrastructure+Application)
- [ ] Upload JPEG from iPhone → thumbnail generated + EXIF date in DB + appears in timeline
- [ ] Upload HEIC from iPhone → converted to JPEG + thumbnail generated + original preserved in `originals/`
- [ ] Upload HEVC .MOV from iPhone → status = Pending → queue → Processing → Transcoding → Complete → plays in Chrome and Firefox
- [ ] Login as `viewer` → can browse and download, cannot delete
- [ ] Generate share link → open in incognito (no login) → media/album accessible
- [ ] Blob paths follow hash-partitioned pattern: `a1/b2/c3/d4/{guid}.ext`
- [ ] Logs show correlation ID across request → queue → background processing
- [ ] `dotnet run` locally → API starts, connects to Azure Postgres and Azurite
- [ ] `npm run dev` in client/ → frontend serves on localhost, talks to local API
- [ ] Azure env vars override appsettings.json (verify with `Storage__ConnectionString`)
- [ ] SignalR push works: upload photo → thumbnail appears in gallery without page refresh

---

*This document will be updated as implementation progresses.*
