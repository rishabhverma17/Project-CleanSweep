using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Enums;
using Microsoft.Extensions.Options;

namespace CleanSweep.Application.Services;

public class BrowseService
{
    private readonly IMediaRepository _mediaRepo;
    private readonly IBlobStorageService _blobService;
    private readonly ICurrentUserService _currentUser;
    private readonly StorageOptions _storageOptions;

    public BrowseService(
        IMediaRepository mediaRepo,
        IBlobStorageService blobService,
        ICurrentUserService currentUser,
        IOptions<StorageOptions> storageOptions)
    {
        _mediaRepo = mediaRepo;
        _blobService = blobService;
        _currentUser = currentUser;
        _storageOptions = storageOptions.Value;
    }

    public async Task<PaginatedResult<MediaItemDto>> BrowseAsync(int page, int pageSize, MediaType? type, DateTimeOffset? from, DateTimeOffset? to, string? sort, CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        var result = await _mediaRepo.BrowseAsync(userId, page, pageSize, type, from, to, sort, ct);
        var sasExpiry = TimeSpan.FromMinutes(_storageOptions.ReadSasExpiryMinutes);

        var dtos = new List<MediaItemDto>();
        foreach (var item in result.Items)
        {
            string? thumbUrl = null;
            string? playbackUrl = null;

            if (item.ThumbnailBlobPath != null)
                thumbUrl = (await _blobService.GenerateReadSasUriAsync(_storageOptions.ThumbnailsContainer, item.ThumbnailBlobPath, sasExpiry, ct)).ToString();

            if (item.PlaybackBlobPath != null)
            {
                var container = item.PlaybackBlobPath == item.OriginalBlobPath ? _storageOptions.OriginalsContainer : _storageOptions.PlaybackContainer;
                playbackUrl = (await _blobService.GenerateReadSasUriAsync(container, item.PlaybackBlobPath, sasExpiry, ct)).ToString();
            }

            dtos.Add(new MediaItemDto
            {
                Id = item.Id,
                FileName = item.FileName,
                MediaType = item.MediaType,
                ContentType = item.ContentType,
                FileSizeBytes = item.FileSizeBytes,
                Width = item.Width,
                Height = item.Height,
                DurationSeconds = item.DurationSeconds,
                CapturedAt = item.CapturedAt,
                UploadedAt = item.UploadedAt,
                ProcessingStatus = item.ProcessingStatus,
                ThumbnailUrl = thumbUrl,
                PlaybackUrl = playbackUrl
            });
        }

        return new PaginatedResult<MediaItemDto>
        {
            Items = dtos,
            TotalCount = result.TotalCount,
            Page = result.Page,
            PageSize = result.PageSize
        };
    }
}
