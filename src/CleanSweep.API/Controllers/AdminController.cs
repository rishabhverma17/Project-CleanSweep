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
        var items = await _db.MediaItems
            .Where(m => !m.IsDeleted && (m.ProcessingStatus == ProcessingStatus.Complete || m.ProcessingStatus == ProcessingStatus.Failed))
            .ToListAsync(ct);

        foreach (var item in items)
        {
            item.ProcessingStatus = ProcessingStatus.Pending;
            item.ThumbnailBlobPath = null;

            await _processingQueue.EnqueueAsync(new ProcessingMessage
            {
                MediaId = item.Id,
                BlobPath = item.OriginalBlobPath,
                ContentType = item.ContentType,
                FileName = item.FileName,
                UserId = item.UserId,
                CorrelationId = Guid.NewGuid().ToString("N")
            }, ct);
        }

        await _db.SaveChangesAsync(ct);
        return Ok(new { message = $"Queued {items.Count} item(s) for reprocessing." });
    }
}
