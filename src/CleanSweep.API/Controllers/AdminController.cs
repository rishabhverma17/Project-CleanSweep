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
    private readonly ILogger<AdminController> _logger;

    public AdminController(
        IUserRepository userRepo,
        IMediaProcessingQueue processingQueue,
        IBlobStorageService blobService,
        IOptions<StorageOptions> storageOptions,
        AppDbContext db,
        ILogger<AdminController> logger)
    {
        _userRepo = userRepo;
        _processingQueue = processingQueue;
        _blobService = blobService;
        _storageOptions = storageOptions.Value;
        _db = db;
        _logger = logger;
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
        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = HttpContext.RequestServices.GetRequiredService<IServiceScopeFactory>().CreateScope();
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
        // Find items that are stuck: not deleted, no thumbnail, and status is not Complete
        var count = await _db.MediaItems
            .Where(m => !m.IsDeleted
                && m.ThumbnailBlobPath == null
                && m.ProcessingStatus != ProcessingStatus.Complete)
            .CountAsync(ct);

        if (count == 0)
            return Ok(new { message = "No stuck items found." });

        _ = Task.Run(async () =>
        {
            try
            {
                using var scope = HttpContext.RequestServices.GetRequiredService<IServiceScopeFactory>().CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                var queue = scope.ServiceProvider.GetRequiredService<IMediaProcessingQueue>();

                var items = await db.MediaItems
                    .Where(m => !m.IsDeleted
                        && m.ThumbnailBlobPath == null
                        && m.ProcessingStatus != ProcessingStatus.Complete)
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
        // Fix items that have thumbnails but status is still Pending/Processing
        var fixedCount = await _db.MediaItems
            .Where(m => !m.IsDeleted
                && m.ThumbnailBlobPath != null
                && (m.ProcessingStatus == ProcessingStatus.Pending || m.ProcessingStatus == ProcessingStatus.Processing || m.ProcessingStatus == ProcessingStatus.Uploading))
            .ExecuteUpdateAsync(s => s.SetProperty(m => m.ProcessingStatus, ProcessingStatus.Complete), ct);

        _logger.LogInformation("Fixed {Count} stuck media items to Complete status", fixedCount);
        return Ok(new { message = $"Fixed {fixedCount} stuck item(s)." });
    }
}
