using CleanSweep.Application.Configuration;
using CleanSweep.Application.Interfaces;
using CleanSweep.Application.Services;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.BackgroundServices;

/// <summary>
/// Periodically finds soft-deleted media items, deletes their blobs, then hard-deletes the DB rows.
/// Runs every 6 hours, processes up to 500 items per cycle. Keeps running until all are cleaned.
/// </summary>
public class CleanupBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IBlobStorageService _blobService;
    private readonly StorageOptions _storageOptions;
    private readonly ILogger<CleanupBackgroundService> _logger;

    private static readonly TimeSpan PollInterval = TimeSpan.FromHours(6);
    private static readonly TimeSpan MinDeleteAge = TimeSpan.FromMinutes(5);
    private const int BatchSize = 500;

    public CleanupBackgroundService(
        IServiceScopeFactory scopeFactory,
        IBlobStorageService blobService,
        IOptions<StorageOptions> storageOptions,
        ILogger<CleanupBackgroundService> logger)
    {
        _scopeFactory = scopeFactory;
        _blobService = blobService;
        _storageOptions = storageOptions.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("CleanupBackgroundService started. Poll interval: {Interval}", PollInterval);

        // Run first cleanup 2 minutes after startup (catch leftovers from previous run)
        await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunFullCleanupAsync(stoppingToken);
                _logger.LogInformation("CleanupBackgroundService sleeping for {Interval}", PollInterval);
                await Task.Delay(PollInterval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in cleanup cycle");
                await Task.Delay(TimeSpan.FromMinutes(5), stoppingToken);
            }
        }
    }

    /// <summary>
    /// Keeps processing batches until no more soft-deleted items remain.
    /// </summary>
    private async Task RunFullCleanupAsync(CancellationToken ct)
    {
        var totalProcessed = 0;
        var totalBlobsDeleted = 0;

        while (true)
        {
            using var scope = _scopeFactory.CreateScope();
            var mediaRepo = scope.ServiceProvider.GetRequiredService<IMediaRepository>();

            var items = await mediaRepo.GetSoftDeletedAsync(MinDeleteAge, BatchSize, ct);
            if (items.Count == 0) break;

            _logger.LogInformation("Cleanup: picked up {Count} soft-deleted items for blob deletion", items.Count);

            var blobsInBatch = 0;
            await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 16, CancellationToken = ct }, async (item, token) =>
            {
                try { await _blobService.DeleteAsync(_storageOptions.OriginalsContainer, item.OriginalBlobPath, token); Interlocked.Increment(ref blobsInBatch); } catch { }
                if (item.ThumbnailBlobPath != null)
                    try { await _blobService.DeleteAsync(_storageOptions.ThumbnailsContainer, item.ThumbnailBlobPath, token); Interlocked.Increment(ref blobsInBatch); } catch { }
                if (item.PlaybackBlobPath != null && item.PlaybackBlobPath != item.OriginalBlobPath)
                    try { await _blobService.DeleteAsync(_storageOptions.PlaybackContainer, item.PlaybackBlobPath, token); Interlocked.Increment(ref blobsInBatch); } catch { }
            });

            var ids = items.Select(i => i.Id).ToList();
            await mediaRepo.HardDeleteBatchAsync(ids, ct);

            totalProcessed += items.Count;
            totalBlobsDeleted += blobsInBatch;

            _logger.LogInformation("Cleanup batch done: {ItemCount} items hard-deleted, {BlobCount} blobs removed. Running total: {Total} items",
                items.Count, blobsInBatch, totalProcessed);

            // Small pause between batches to not hammer the DB
            await Task.Delay(TimeSpan.FromSeconds(2), ct);
        }

        if (totalProcessed > 0)
            _logger.LogInformation("Cleanup cycle complete: {TotalItems} items processed, {TotalBlobs} blobs deleted", totalProcessed, totalBlobsDeleted);
        else
            _logger.LogInformation("Cleanup cycle: nothing to clean");
    }
}
