using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Helpers;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Enums;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.BackgroundServices;

public class ProcessingBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IMediaProcessingQueue _queue;
    private readonly ILogger<ProcessingBackgroundService> _logger;
    private readonly QueueOptions _queueOptions;
    private readonly StorageOptions _storageOptions;

    public ProcessingBackgroundService(
        IServiceScopeFactory scopeFactory,
        IMediaProcessingQueue queue,
        ILogger<ProcessingBackgroundService> logger,
        IOptions<QueueOptions> queueOptions,
        IOptions<StorageOptions> storageOptions)
    {
        _scopeFactory = scopeFactory;
        _queue = queue;
        _logger = logger;
        _queueOptions = queueOptions.Value;
        _storageOptions = storageOptions.Value;
    }

    private const int MaxConcurrentProcessing = 6;

    private static readonly Dictionary<string, string> ExtensionContentTypeMap = new(StringComparer.OrdinalIgnoreCase)
    {
        [".jpg"] = "image/jpeg", [".jpeg"] = "image/jpeg", [".png"] = "image/png",
        [".heic"] = "image/heic", [".heif"] = "image/heif",
        [".mp4"] = "video/mp4", [".mov"] = "video/quicktime", [".m4v"] = "video/x-m4v",
    };

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ProcessingBackgroundService started ({Concurrency} concurrent), listening on queue '{Queue}'",
            MaxConcurrentProcessing, _queueOptions.MediaProcessingQueue);

        var semaphore = new SemaphoreSlim(MaxConcurrentProcessing);
        var activeTasks = new List<Task>();

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await semaphore.WaitAsync(stoppingToken);

                var visibilityTimeout = TimeSpan.FromSeconds(_queueOptions.ProcessingVisibilityTimeoutSeconds);
                var item = await _queue.DequeueAsync(visibilityTimeout, stoppingToken);

                if (item == null)
                {
                    semaphore.Release();
                    // Clean up completed tasks
                    activeTasks.RemoveAll(t => t.IsCompleted);
                    await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
                    continue;
                }

                var task = ProcessItemAsync(item, semaphore, stoppingToken);
                activeTasks.Add(task);

                // Clean up completed tasks periodically
                activeTasks.RemoveAll(t => t.IsCompleted);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                semaphore.Release();
                _logger.LogError(ex, "Error in processing loop");
                await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
            }
        }

        // Wait for in-flight tasks to finish on shutdown
        if (activeTasks.Count > 0)
        {
            _logger.LogInformation("Waiting for {Count} in-flight processing tasks to complete", activeTasks.Count);
            await Task.WhenAll(activeTasks);
        }
    }

    private async Task ProcessItemAsync(QueueItem<ProcessingMessage> item, SemaphoreSlim semaphore, CancellationToken stoppingToken)
    {
        try
        {
            using var logScope = _logger.BeginScope(new Dictionary<string, object>
            {
                ["CorrelationId"] = item.Message.CorrelationId,
                ["MediaId"] = item.Message.MediaId
            });

            _logger.LogInformation("Processing media: {FileName} ({ContentType})", item.Message.FileName, item.Message.ContentType);

            using var scope = _scopeFactory.CreateScope();
            var mediaRepo = scope.ServiceProvider.GetRequiredService<IMediaRepository>();
            var blobService = scope.ServiceProvider.GetRequiredService<IBlobStorageService>();
            var metadataExtractor = scope.ServiceProvider.GetRequiredService<IMetadataExtractor>();
            var thumbnailGenerators = scope.ServiceProvider.GetRequiredService<IEnumerable<IThumbnailGenerator>>();
            var notificationService = scope.ServiceProvider.GetRequiredService<INotificationService>();
            var transcodeQueue = scope.ServiceProvider.GetRequiredService<ITranscodeQueue>();

            var mediaItem = await mediaRepo.GetByIdAsync(item.Message.MediaId, stoppingToken);
            if (mediaItem == null)
            {
                _logger.LogWarning("Media item {MediaId} not found, discarding message", item.Message.MediaId);
                await _queue.CompleteAsync(item.MessageId, item.PopReceipt, stoppingToken);
                return;
            }

            mediaItem.ProcessingStatus = ProcessingStatus.Processing;
            await mediaRepo.UpdateAsync(mediaItem, stoppingToken);

            var tempDir = Path.Combine(Path.GetTempPath(), "cleansweep");
            Directory.CreateDirectory(tempDir);
            var tempPath = Path.Combine(tempDir, $"{mediaItem.Id}{Path.GetExtension(mediaItem.FileName)}");

            try
            {
                await using (var blobStream = await blobService.DownloadAsync(_storageOptions.OriginalsContainer, mediaItem.OriginalBlobPath, stoppingToken))
                await using (var fileWrite = File.Create(tempPath))
                {
                    await blobStream.CopyToAsync(fileWrite, stoppingToken);
                }

                _logger.LogInformation("Downloaded {MediaId} to temp: {TempPath} ({SizeMB:F1} MB)",
                    mediaItem.Id, tempPath, new FileInfo(tempPath).Length / 1024.0 / 1024.0);

                try
                {
                    await using var metaStream = File.OpenRead(tempPath);
                    var metadata = await metadataExtractor.ExtractAsync(metaStream, mediaItem.FileName, stoppingToken);
                    mediaItem.CapturedAt = metadata.DateTaken;
                    mediaItem.Width = metadata.Width;
                    mediaItem.Height = metadata.Height;
                    mediaItem.DurationSeconds = metadata.DurationSeconds;
                    mediaItem.SourceCodec = metadata.Codec;
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Metadata extraction failed for {MediaId}, continuing", mediaItem.Id);
                }

                try
                {
                    // Determine effective content type — fall back to extension if stored type is empty/wrong
                    var effectiveContentType = mediaItem.ContentType;
                    var generator = thumbnailGenerators.FirstOrDefault(g => g.CanHandle(effectiveContentType));

                    if (generator == null)
                    {
                        // Try to infer from file extension
                        var ext = Path.GetExtension(mediaItem.FileName)?.ToLowerInvariant() ?? "";
                        if (ExtensionContentTypeMap.TryGetValue(ext, out var inferredType))
                        {
                            effectiveContentType = inferredType;
                            generator = thumbnailGenerators.FirstOrDefault(g => g.CanHandle(effectiveContentType));

                            // Fix the stored content type for future use
                            if (generator != null)
                            {
                                _logger.LogInformation("Fixed content type for {MediaId}: '{Old}' → '{New}' (inferred from {Extension})",
                                    mediaItem.Id, mediaItem.ContentType, effectiveContentType, ext);
                                mediaItem.ContentType = effectiveContentType;
                            }
                        }
                    }

                    if (generator != null)
                    {
                        await using var thumbSourceStream = File.OpenRead(tempPath);
                        using var thumbStream = await generator.GenerateAsync(thumbSourceStream, effectiveContentType, 300, stoppingToken);
                        var thumbPath = BlobPathGenerator.Generate(mediaItem.Id, ".jpg");
                        await blobService.UploadAsync(thumbStream, _storageOptions.ThumbnailsContainer, thumbPath, "image/jpeg", stoppingToken);
                        mediaItem.ThumbnailBlobPath = thumbPath;
                        _logger.LogInformation("Thumbnail generated for {MediaId} ({ContentType})", mediaItem.Id, effectiveContentType);
                    }
                    else
                    {
                        _logger.LogWarning("No thumbnail generator found for {MediaId}. ContentType='{ContentType}', FileName='{FileName}'",
                            mediaItem.Id, mediaItem.ContentType, mediaItem.FileName);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Thumbnail generation failed for {MediaId} ({ContentType}), continuing",
                        mediaItem.Id, mediaItem.ContentType);
                }
            }
            finally
            {
                if (File.Exists(tempPath))
                {
                    File.Delete(tempPath);
                    _logger.LogDebug("Cleaned up temp file: {TempPath}", tempPath);
                }
            }

            var needsTranscode = mediaItem.MediaType == MediaType.Video
                && mediaItem.SourceCodec != null
                && mediaItem.SourceCodec.Contains("hevc", StringComparison.OrdinalIgnoreCase);

            if (needsTranscode)
            {
                mediaItem.ProcessingStatus = ProcessingStatus.Transcoding;
                var targetPath = BlobPathGenerator.Generate(mediaItem.Id, ".mp4");
                await transcodeQueue.EnqueueAsync(new TranscodeMessage
                {
                    MediaId = mediaItem.Id,
                    SourceBlobPath = mediaItem.OriginalBlobPath,
                    TargetBlobPath = targetPath,
                    SourceContainer = _storageOptions.OriginalsContainer,
                    TargetContainer = _storageOptions.PlaybackContainer,
                    UserId = mediaItem.UserId,
                    CorrelationId = item.Message.CorrelationId
                }, stoppingToken);
            }
            else
            {
                mediaItem.PlaybackBlobPath = mediaItem.OriginalBlobPath;
                mediaItem.ProcessingStatus = ProcessingStatus.Complete;
            }

            await mediaRepo.UpdateAsync(mediaItem, stoppingToken);
            await _queue.CompleteAsync(item.MessageId, item.PopReceipt, stoppingToken);

            string? thumbUrl = null;
            if (mediaItem.ThumbnailBlobPath != null)
                thumbUrl = (await blobService.GenerateReadSasUriAsync(_storageOptions.ThumbnailsContainer, mediaItem.ThumbnailBlobPath, TimeSpan.FromMinutes(15), stoppingToken)).ToString();

            await notificationService.NotifyMediaStatusChangedAsync(mediaItem.UserId, new MediaStatusUpdate
            {
                MediaId = mediaItem.Id,
                Status = mediaItem.ProcessingStatus.ToString(),
                ThumbnailUrl = thumbUrl
            }, stoppingToken);

            _logger.LogInformation("Processing complete for {MediaId}. Status={Status}", mediaItem.Id, mediaItem.ProcessingStatus);
        }
        catch (Azure.RequestFailedException blobEx) when (blobEx.Status == 404)
        {
            // Blob doesn't exist — but only treat as orphan if item is old (>1 hour)
            // Recent items might still be uploading
            try
            {
                using var cleanupScope = _scopeFactory.CreateScope();
                var cleanupRepo = cleanupScope.ServiceProvider.GetRequiredService<IMediaRepository>();
                var orphanItem = await cleanupRepo.GetByIdAsync(item.Message.MediaId, CancellationToken.None);

                if (orphanItem != null && orphanItem.UploadedAt < DateTimeOffset.UtcNow.AddHours(-1))
                {
                    _logger.LogWarning("Blob not found for old item {MediaId} (uploaded {UploadedAt}), soft-deleting orphan",
                        item.Message.MediaId, orphanItem.UploadedAt);
                    await cleanupRepo.SoftDeleteAsync(item.Message.MediaId, CancellationToken.None);
                }
                else
                {
                    // Recent item — mark as Failed, don't delete. Might still be uploading.
                    if (orphanItem != null)
                    {
                        orphanItem.ProcessingStatus = ProcessingStatus.Failed;
                        await cleanupRepo.UpdateAsync(orphanItem, CancellationToken.None);
                        _logger.LogWarning("Blob not found for recent item {MediaId} (uploaded {UploadedAt}), marked as Failed (not deleted)",
                            item.Message.MediaId, orphanItem?.UploadedAt);
                    }
                }
            }
            catch (Exception innerEx)
            {
                _logger.LogError(innerEx, "Failed to handle BlobNotFound for {MediaId}", item.Message.MediaId);
            }
            try { await _queue.CompleteAsync(item.MessageId, item.PopReceipt, CancellationToken.None); } catch { }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing {MediaId}", item.Message.MediaId);

            // Set status to Failed so item doesn't stay stuck at Processing forever
            try
            {
                using var errorScope = _scopeFactory.CreateScope();
                var errorRepo = errorScope.ServiceProvider.GetRequiredService<IMediaRepository>();
                var failedItem = await errorRepo.GetByIdAsync(item.Message.MediaId, CancellationToken.None);
                if (failedItem != null && failedItem.ProcessingStatus == ProcessingStatus.Processing)
                {
                    failedItem.ProcessingStatus = ProcessingStatus.Failed;
                    await errorRepo.UpdateAsync(failedItem, CancellationToken.None);
                    _logger.LogWarning("Set {MediaId} to Failed status after processing error", item.Message.MediaId);
                }
            }
            catch (Exception innerEx)
            {
                _logger.LogError(innerEx, "Failed to update status to Failed for {MediaId}", item.Message.MediaId);
            }

            // Complete the queue message so it doesn't retry endlessly
            try { await _queue.CompleteAsync(item.MessageId, item.PopReceipt, CancellationToken.None); } catch { }
        }
        finally
        {
            semaphore.Release();
        }
    }
}
