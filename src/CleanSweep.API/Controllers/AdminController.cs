using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Enums;
using CleanSweep.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize(Roles = "owner")]
public class AdminController : ControllerBase
{
    private readonly IUserRepository _userRepo;
    private readonly IMediaProcessingQueue _processingQueue;
    private readonly IBlobStorageService _blobService;
    private readonly StorageOptions _storageOptions;
    private readonly AppDbContext _db;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AdminController> _logger;

    public AdminController(
        IUserRepository userRepo,
        IMediaProcessingQueue processingQueue,
        IBlobStorageService blobService,
        IOptions<StorageOptions> storageOptions,
        AppDbContext db,
        IServiceScopeFactory scopeFactory,
        ILogger<AdminController> logger)
    {
        _userRepo = userRepo;
        _processingQueue = processingQueue;
        _blobService = blobService;
        _storageOptions = storageOptions.Value;
        _db = db;
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    [HttpGet("stats")]
    public async Task<ActionResult> GetStats(CancellationToken ct)
    {
        var queueDepth = await _processingQueue.GetApproximateCountAsync(ct);

        var total = await _db.MediaItems.CountAsync(m => !m.IsDeleted, ct);
        var complete = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Complete, ct);
        var pending = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Pending, ct);
        var processing = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Processing, ct);
        var uploading = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Uploading, ct);
        var transcoding = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Transcoding, ct);
        var failed = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Failed, ct);
        var noThumb = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ThumbnailBlobPath == null && m.ProcessingStatus == ProcessingStatus.Complete, ct);
        var noThumbInPipeline = await _db.MediaItems.CountAsync(m => !m.IsDeleted && m.ThumbnailBlobPath == null && m.ProcessingStatus != ProcessingStatus.Complete && m.ProcessingStatus != ProcessingStatus.Failed, ct);
        var softDeleted = await _db.MediaItems.CountAsync(m => m.IsDeleted, ct);

        return Ok(new
        {
            queueDepth,
            total, complete, pending, processing, uploading, transcoding, failed,
            noThumbnail = noThumb,
            inPipeline = noThumbInPipeline,
            softDeleted
        });
    }

    [HttpGet("activity")]
    public async Task<ActionResult> GetRecentActivity(CancellationToken ct)
    {
        // Last 30 items that changed status (ordered by upload time desc, showing pipeline activity)
        var recentItems = await _db.MediaItems
            .Where(m => !m.IsDeleted)
            .OrderByDescending(m => m.UploadedAt)
            .Take(30)
            .Select(m => new
            {
                m.Id,
                m.FileName,
                Status = m.ProcessingStatus.ToString(),
                m.ContentType,
                HasThumbnail = m.ThumbnailBlobPath != null,
                HasPlayback = m.PlaybackBlobPath != null,
                SizeMB = Math.Round(m.FileSizeBytes / 1024.0 / 1024.0, 1),
                m.UploadedAt
            })
            .ToListAsync(ct);

        return Ok(recentItems);
    }

    [HttpGet("users")]
    public async Task<ActionResult> GetUsers(CancellationToken ct)
    {
        var users = await _userRepo.GetAllAsync(ct);
        var result = new List<object>();
        foreach (var u in users)
        {
            var usedBytes = await _db.MediaItems.Where(m => m.UserId == u.Id && !m.IsDeleted).SumAsync(m => m.FileSizeBytes, ct);
            result.Add(new
            {
                u.Id, u.Email, u.DisplayName, u.FirstSeenAt, u.LastSeenAt,
                u.QuotaBytes, UsedBytes = usedBytes,
                MediaCount = await _db.MediaItems.CountAsync(m => m.UserId == u.Id && !m.IsDeleted, ct)
            });
        }
        return Ok(result);
    }

    [HttpPost("reset")]
    public async Task<ActionResult> ResetAll(CancellationToken ct)
    {
        // 1. Delete blobs for each media item
        var mediaItems = await _db.MediaItems.ToListAsync(ct);
        var blobsDeleted = 0;
        foreach (var item in mediaItems)
        {
            try
            {
                await _blobService.DeleteAsync(_storageOptions.OriginalsContainer, item.OriginalBlobPath, ct);
                blobsDeleted++;
                if (item.ThumbnailBlobPath != null)
                    await _blobService.DeleteAsync(_storageOptions.ThumbnailsContainer, item.ThumbnailBlobPath, ct);
                if (item.PlaybackBlobPath != null && item.PlaybackBlobPath != item.OriginalBlobPath)
                    await _blobService.DeleteAsync(_storageOptions.PlaybackContainer, item.PlaybackBlobPath, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to delete blobs for {MediaId}, continuing", item.Id);
            }
        }

        // 2. Delete all DB data in correct FK order
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM family_media", ct);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM family_members", ct);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM album_media", ct);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM share_links", ct);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM media_items", ct);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM albums", ct);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM families", ct);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM users", ct);

        return Ok(new { message = $"All data deleted. {blobsDeleted} blob(s) removed. Fresh start." });
    }

    [HttpPost("reprocess")]
    public async Task<ActionResult> ReprocessAll(CancellationToken ct)
    {
        // Count items that need reprocessing
        var count = await _db.MediaItems
            .Where(m => !m.IsDeleted && (m.ProcessingStatus == ProcessingStatus.Complete || m.ProcessingStatus == ProcessingStatus.Failed))
            .CountAsync(ct);

        if (count == 0)
            return Ok(new { message = "No items to reprocess." });

        // Queue in background to avoid timeout
        var scopeFactory = _scopeFactory;
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var queue = scope.ServiceProvider.GetRequiredService<IMediaProcessingQueue>();

                var items = await db.MediaItems
                    .Where(m => !m.IsDeleted && (m.ProcessingStatus == ProcessingStatus.Complete || m.ProcessingStatus == ProcessingStatus.Failed))
                    .ToListAsync();

                foreach (var item in items)
                {
                    item.ProcessingStatus = ProcessingStatus.Pending;
                    item.ThumbnailBlobPath = null;

                    await queue.EnqueueAsync(new ProcessingMessage
                    {
                        MediaId = item.Id,
                        BlobPath = item.OriginalBlobPath,
                        ContentType = item.ContentType,
                        FileName = item.FileName,
                        UserId = item.UserId,
                        CorrelationId = Guid.NewGuid().ToString("N")
                    });
                }

                await db.SaveChangesAsync();
                _logger.LogInformation("Queued {Count} items for reprocessing", items.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to queue items for reprocessing");
            }
        });

        return Accepted(new { message = $"Queuing {count} item(s) for reprocessing. This runs in the background." });
    }

    [HttpPost("reprocess-stuck")]
    public async Task<ActionResult> ReprocessStuck(CancellationToken ct)
    {
        // Target any non-deleted item without a thumbnail that is NOT currently Uploading
        // Uploading = client is still sending blob, everything else is fair game to re-queue
        var cutoff = DateTimeOffset.UtcNow.AddMinutes(-5); // Only items older than 5 min
        var count = await _db.MediaItems
            .Where(m => !m.IsDeleted
                && m.ThumbnailBlobPath == null
                && m.ProcessingStatus != ProcessingStatus.Uploading
                && m.UploadedAt < cutoff)
            .CountAsync(ct);

        if (count == 0)
            return Ok(new { message = "No stuck items found." });

        var scopeFactory2 = _scopeFactory;
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory2.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var queue = scope.ServiceProvider.GetRequiredService<IMediaProcessingQueue>();

                var items = await db.MediaItems
                    .Where(m => !m.IsDeleted
                        && m.ThumbnailBlobPath == null
                        && m.ProcessingStatus != ProcessingStatus.Uploading
                        && m.UploadedAt < cutoff)
                    .ToListAsync();

                foreach (var item in items)
                {
                    item.ProcessingStatus = ProcessingStatus.Pending;

                    await queue.EnqueueAsync(new ProcessingMessage
                    {
                        MediaId = item.Id,
                        BlobPath = item.OriginalBlobPath,
                        ContentType = item.ContentType,
                        FileName = item.FileName,
                        UserId = item.UserId,
                        CorrelationId = Guid.NewGuid().ToString("N")
                    });
                }

                await db.SaveChangesAsync();
                _logger.LogInformation("Queued {Count} stuck items for reprocessing", items.Count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to queue stuck items for reprocessing");
            }
        });

        return Accepted(new { message = $"Queuing {count} stuck item(s) for reprocessing. This runs in the background." });
    }

    [HttpPost("fix-stuck-status")]
    public async Task<ActionResult> FixStuckStatus(CancellationToken ct)
    {
        // Only fix items that have thumbnails AND playback but status is still wrong
        var fixedCount = await _db.MediaItems
            .Where(m => !m.IsDeleted
                && m.ThumbnailBlobPath != null
                && m.PlaybackBlobPath != null
                && m.ProcessingStatus != ProcessingStatus.Complete
                && m.ProcessingStatus != ProcessingStatus.Failed)
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.ProcessingStatus, ProcessingStatus.Complete), ct);

        _logger.LogInformation("Fixed {Count} stuck media items to Complete status", fixedCount);
        return Ok(new { message = $"Fixed {fixedCount} stuck item(s)." });
    }

    [HttpPost("purge-failed")]
    public async Task<ActionResult> PurgeFailed(CancellationToken ct)
    {
        // Soft-delete all failed items (orphan records with no blob)
        var count = await _db.MediaItems
            .Where(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Failed)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.IsDeleted, true)
                .SetProperty(m => m.DeletedAt, DateTimeOffset.UtcNow), ct);

        _logger.LogInformation("Purged {Count} failed media items", count);
        return Ok(new { message = $"Purged {count} failed item(s). Blob cleanup will run automatically." });
    }

    [HttpPost("reset-processing")]
    public async Task<ActionResult> ResetProcessing(CancellationToken ct)
    {
        // Reset items stuck at Processing back to Pending and re-queue them
        var stuckItems = await _db.MediaItems
            .Where(m => !m.IsDeleted && m.ProcessingStatus == ProcessingStatus.Processing)
            .ToListAsync(ct);

        if (stuckItems.Count == 0) return Ok(new { message = "No stuck processing items found." });

        foreach (var item in stuckItems)
            item.ProcessingStatus = ProcessingStatus.Pending;
        await _db.SaveChangesAsync(ct);

        // Queue them in background
        var scopeFactory = _scopeFactory;
        var count = stuckItems.Count;
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var queue = scope.ServiceProvider.GetRequiredService<IMediaProcessingQueue>();

                foreach (var item in stuckItems)
                {
                    await queue.EnqueueAsync(new ProcessingMessage
                    {
                        MediaId = item.Id,
                        BlobPath = item.OriginalBlobPath,
                        ContentType = item.ContentType,
                        FileName = item.FileName,
                        UserId = item.UserId,
                        CorrelationId = Guid.NewGuid().ToString("N")
                    });
                }

                _logger.LogInformation("Re-queued {Count} stuck processing items", count);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to re-queue stuck items");
            }
        });

        return Accepted(new { message = $"Reset {count} stuck item(s) from Processing → Pending and re-queuing." });
    }

    [HttpPost("trigger-cleanup")]
    public async Task<ActionResult> TriggerCleanup(CancellationToken ct)
    {
        var count = await _db.MediaItems.CountAsync(m => m.IsDeleted, ct);
        if (count == 0) return Ok(new { message = "Nothing to clean up." });

        // Trigger cleanup in background
        var scopeFactory = _scopeFactory;
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = scopeFactory.CreateScope();
                var mediaRepo = scope.ServiceProvider.GetRequiredService<IMediaRepository>();
                var blobService = scope.ServiceProvider.GetRequiredService<IBlobStorageService>();
                var storageOptions = scope.ServiceProvider.GetRequiredService<IOptions<StorageOptions>>().Value;

                var totalCleaned = 0;
                while (true)
                {
                    var items = await mediaRepo.GetSoftDeletedAsync(TimeSpan.Zero, 500, CancellationToken.None);
                    if (items.Count == 0) break;

                    await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 16 }, async (item, _) =>
                    {
                        try { await blobService.DeleteAsync(storageOptions.OriginalsContainer, item.OriginalBlobPath, CancellationToken.None); } catch { }
                        if (item.ThumbnailBlobPath != null)
                            try { await blobService.DeleteAsync(storageOptions.ThumbnailsContainer, item.ThumbnailBlobPath, CancellationToken.None); } catch { }
                        if (item.PlaybackBlobPath != null && item.PlaybackBlobPath != item.OriginalBlobPath)
                            try { await blobService.DeleteAsync(storageOptions.PlaybackContainer, item.PlaybackBlobPath, CancellationToken.None); } catch { }
                    });

                    await mediaRepo.HardDeleteBatchAsync(items.Select(i => i.Id).ToList(), CancellationToken.None);
                    totalCleaned += items.Count;
                }

                _logger.LogInformation("Manual cleanup complete: {Count} items cleaned", totalCleaned);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Manual cleanup failed");
            }
        });

        return Accepted(new { message = $"Cleaning up {count} soft-deleted item(s) in background." });
    }
}
