using CleanSweep.Application.Configuration;
using CleanSweep.Application.Interfaces;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CleanSweep.Application.Services;

public class MediaService
{
    private readonly IMediaRepository _mediaRepo;
    private readonly IBlobStorageService _blobService;
    private readonly StorageOptions _storageOptions;
    private readonly ILogger<MediaService> _logger;

    public MediaService(
        IMediaRepository mediaRepo,
        IBlobStorageService blobService,
        IOptions<StorageOptions> storageOptions,
        ILogger<MediaService> logger)
    {
        _mediaRepo = mediaRepo;
        _blobService = blobService;
        _storageOptions = storageOptions.Value;
        _logger = logger;
    }

    public async Task DeleteMediaWithBlobsAsync(Guid mediaId, CancellationToken ct)
    {
        var item = await _mediaRepo.GetByIdAsync(mediaId, ct);
        if (item == null) return;

        // Delete blobs
        try { await _blobService.DeleteAsync(_storageOptions.OriginalsContainer, item.OriginalBlobPath, ct); } catch { }
        if (item.ThumbnailBlobPath != null)
            try { await _blobService.DeleteAsync(_storageOptions.ThumbnailsContainer, item.ThumbnailBlobPath, ct); } catch { }
        if (item.PlaybackBlobPath != null && item.PlaybackBlobPath != item.OriginalBlobPath)
            try { await _blobService.DeleteAsync(_storageOptions.PlaybackContainer, item.PlaybackBlobPath, ct); } catch { }

        await _mediaRepo.SoftDeleteAsync(mediaId, ct);

        _logger.LogInformation("Deleted media {MediaId} with blobs", mediaId);
    }

    /// <summary>
    /// Fast batch delete: soft-deletes in DB immediately, returns blob paths for background cleanup.
    /// </summary>
    public async Task<List<BlobCleanupItem>> DeleteBatchAsync(List<Guid> mediaIds, CancellationToken ct)
    {
        // Fetch all items to get blob paths (parallelized)
        var fetchTasks = mediaIds.Select(id => _mediaRepo.GetByIdAsync(id, ct));
        var items = (await Task.WhenAll(fetchTasks)).Where(i => i != null).ToList();

        if (items.Count == 0) return [];

        // Collect blob paths before soft-delete makes them invisible
        var blobsToDelete = items.Select(item => new BlobCleanupItem
        {
            OriginalBlobPath = item!.OriginalBlobPath,
            ThumbnailBlobPath = item.ThumbnailBlobPath,
            PlaybackBlobPath = item.PlaybackBlobPath != item.OriginalBlobPath ? item.PlaybackBlobPath : null,
        }).ToList();

        // Single SQL UPDATE — instant
        await _mediaRepo.SoftDeleteBatchAsync(mediaIds, ct);

        _logger.LogInformation("Batch soft-deleted {Count} media items, queuing blob cleanup", items.Count);

        return blobsToDelete;
    }

    /// <summary>
    /// Deletes blobs in parallel. Safe to run in background (no DB, no request scope).
    /// </summary>
    public async Task CleanupBlobsAsync(List<BlobCleanupItem> blobs, CancellationToken ct)
    {
        await Parallel.ForEachAsync(blobs, new ParallelOptions { MaxDegreeOfParallelism = 16, CancellationToken = ct }, async (item, token) =>
        {
            try { await _blobService.DeleteAsync(_storageOptions.OriginalsContainer, item.OriginalBlobPath, token); } catch { }
            if (item.ThumbnailBlobPath != null)
                try { await _blobService.DeleteAsync(_storageOptions.ThumbnailsContainer, item.ThumbnailBlobPath, token); } catch { }
            if (item.PlaybackBlobPath != null)
                try { await _blobService.DeleteAsync(_storageOptions.PlaybackContainer, item.PlaybackBlobPath, token); } catch { }
        });

        _logger.LogInformation("Cleaned up blobs for {Count} deleted media items", blobs.Count);
    }
}

public class BlobCleanupItem
{
    public string OriginalBlobPath { get; set; } = null!;
    public string? ThumbnailBlobPath { get; set; }
    public string? PlaybackBlobPath { get; set; }
}
