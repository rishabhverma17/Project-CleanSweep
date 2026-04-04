using CleanSweep.Application.Configuration;
using CleanSweep.Application.Interfaces;
using CleanSweep.Application.Services;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.BackgroundServices;

/// <summary>
/// Periodically finds soft-deleted media items, deletes their blobs, then hard-deletes the DB rows.
/// Runs every 60 seconds, processes up to 200 items per cycle.
/// </summary>
public class CleanupBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IBlobStorageService _blobService;
    private readonly StorageOptions _storageOptions;
    private readonly ILogger<CleanupBackgroundService> _logger;

    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan MinDeleteAge = TimeSpan.FromMinutes(1); // Don't clean up items deleted less than 1 min ago
    private const int BatchSize = 200;

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
        _logger.LogInformation("CleanupBackgroundService started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(PollInterval, stoppingToken);
                await CleanupCycleAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in cleanup cycle");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
    }

    private async Task CleanupCycleAsync(CancellationToken ct)
    {
        using var scope = _scopeFactory.CreateScope();
        var mediaRepo = scope.ServiceProvider.GetRequiredService<IMediaRepository>();

        var items = await mediaRepo.GetSoftDeletedAsync(MinDeleteAge, BatchSize, ct);
        if (items.Count == 0) return;

        _logger.LogInformation("Cleaning up {Count} soft-deleted media items", items.Count);

        // Delete blobs in parallel (16 concurrent)
        await Parallel.ForEachAsync(items, new ParallelOptions { MaxDegreeOfParallelism = 16, CancellationToken = ct }, async (item, token) =>
        {
            try { await _blobService.DeleteAsync(_storageOptions.OriginalsContainer, item.OriginalBlobPath, token); } catch { }
            if (item.ThumbnailBlobPath != null)
                try { await _blobService.DeleteAsync(_storageOptions.ThumbnailsContainer, item.ThumbnailBlobPath, token); } catch { }
            if (item.PlaybackBlobPath != null && item.PlaybackBlobPath != item.OriginalBlobPath)
                try { await _blobService.DeleteAsync(_storageOptions.PlaybackContainer, item.PlaybackBlobPath, token); } catch { }
        });

        // Hard-delete DB rows
        var ids = items.Select(i => i.Id).ToList();
        await mediaRepo.HardDeleteBatchAsync(ids, ct);

        _logger.LogInformation("Cleaned up {Count} items: blobs deleted + rows removed", items.Count);
    }
}
