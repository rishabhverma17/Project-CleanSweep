using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Helpers;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using CleanSweep.Domain.Enums;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CleanSweep.Application.Services;

public class UploadService
{
    private readonly IBlobStorageService _blobService;
    private readonly IMediaRepository _mediaRepo;
    private readonly IUserRepository _userRepo;
    private readonly IMediaProcessingQueue _processingQueue;
    private readonly ICurrentUserService _currentUser;
    private readonly StorageOptions _storageOptions;
    private readonly UploadOptions _uploadOptions;
    private readonly QuotaOptions _quotaOptions;
    private readonly ILogger<UploadService> _logger;

    public UploadService(
        IBlobStorageService blobService,
        IMediaRepository mediaRepo,
        IUserRepository userRepo,
        IMediaProcessingQueue processingQueue,
        ICurrentUserService currentUser,
        IOptions<StorageOptions> storageOptions,
        IOptions<UploadOptions> uploadOptions,
        IOptions<QuotaOptions> quotaOptions,
        ILogger<UploadService> logger)
    {
        _blobService = blobService;
        _mediaRepo = mediaRepo;
        _userRepo = userRepo;
        _processingQueue = processingQueue;
        _currentUser = currentUser;
        _storageOptions = storageOptions.Value;
        _uploadOptions = uploadOptions.Value;
        _quotaOptions = quotaOptions.Value;
        _logger = logger;
    }

    public async Task<UploadRequest> RequestUploadAsync(string fileName, string contentType, long sizeBytes, CancellationToken ct)
    {
        var extension = Path.GetExtension(fileName).ToLowerInvariant();

        if (!_uploadOptions.AllowedExtensions.Contains(extension))
            throw new ArgumentException($"File extension '{extension}' is not allowed.");

        if (!_uploadOptions.AllowedContentTypes.Contains(contentType.ToLowerInvariant()))
            throw new ArgumentException($"Content type '{contentType}' is not allowed.");

        if (sizeBytes > _uploadOptions.MaxFileSizeBytes)
            throw new ArgumentException($"File size {sizeBytes} exceeds maximum {_uploadOptions.MaxFileSizeBytes}.");

        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();

        // Quota check
        var user = await _userRepo.GetByIdAsync(userId, ct);
        var currentUsage = await _mediaRepo.GetUserStorageUsageAsync(userId, ct);
        var quota = user?.QuotaBytes ?? _quotaOptions.DefaultUserQuotaBytes;
        if (currentUsage + sizeBytes > quota)
            throw new ArgumentException($"Storage quota exceeded. Used: {currentUsage / (1024 * 1024)} MB of {quota / (1024 * 1024)} MB.");
        await _userRepo.UpsertAsync(userId, _currentUser.Email ?? "", _currentUser.DisplayName ?? "", ct);

        var id = Guid.NewGuid();
        var blobPath = BlobPathGenerator.Generate(id, extension);
        var mediaType = contentType.StartsWith("video/", StringComparison.OrdinalIgnoreCase) ? MediaType.Video : MediaType.Photo;

        var mediaItem = new MediaItem
        {
            Id = id,
            UserId = userId,
            FileName = fileName,
            MediaType = mediaType,
            OriginalBlobPath = blobPath,
            ContentType = contentType,
            FileSizeBytes = sizeBytes,
            UploadedAt = DateTimeOffset.UtcNow,
            ProcessingStatus = ProcessingStatus.Uploading
        };

        await _mediaRepo.AddAsync(mediaItem, ct);

        var sasUri = await _blobService.GenerateWriteSasUriAsync(
            _storageOptions.OriginalsContainer,
            blobPath,
            contentType,
            TimeSpan.FromMinutes(_storageOptions.WriteSasExpiryMinutes),
            ct);

        _logger.LogInformation("Upload requested: {FileName} ({ContentType}, {SizeBytes} bytes) by {UserId}. MediaId={MediaId}, BlobPath={BlobPath}",
            fileName, contentType, sizeBytes, userId, id, blobPath);

        return new UploadRequest { MediaId = id, UploadUrl = sasUri.ToString(), BlobPath = blobPath };
    }

    public async Task<UploadCompleteResult> CompleteUploadAsync(Guid mediaId, string correlationId, CancellationToken ct)
    {
        var mediaItem = await _mediaRepo.GetByIdAsync(mediaId, ct)
            ?? throw new KeyNotFoundException($"Media item {mediaId} not found.");

        if (mediaItem.ProcessingStatus != ProcessingStatus.Uploading)
            throw new InvalidOperationException($"Media item {mediaId} is not in Uploading state.");

        var exists = await _blobService.ExistsAsync(_storageOptions.OriginalsContainer, mediaItem.OriginalBlobPath, ct);
        if (!exists)
            throw new InvalidOperationException($"Blob for media item {mediaId} not found. Upload may not have completed.");

        var fileSize = await _blobService.GetBlobSizeAsync(_storageOptions.OriginalsContainer, mediaItem.OriginalBlobPath, ct);
        mediaItem.FileSizeBytes = fileSize;
        mediaItem.ProcessingStatus = ProcessingStatus.Pending;
        await _mediaRepo.UpdateAsync(mediaItem, ct);

        await _processingQueue.EnqueueAsync(new ProcessingMessage
        {
            MediaId = mediaItem.Id,
            BlobPath = mediaItem.OriginalBlobPath,
            ContentType = mediaItem.ContentType,
            FileName = mediaItem.FileName,
            UserId = mediaItem.UserId,
            CorrelationId = correlationId
        }, ct);

        _logger.LogInformation("Upload complete: MediaId={MediaId}, FileSize={FileSize}, queued for processing", mediaId, fileSize);

        return new UploadCompleteResult { MediaId = mediaId, Status = ProcessingStatus.Pending };
    }
}
