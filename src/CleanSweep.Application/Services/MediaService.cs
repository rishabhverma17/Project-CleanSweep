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
}
