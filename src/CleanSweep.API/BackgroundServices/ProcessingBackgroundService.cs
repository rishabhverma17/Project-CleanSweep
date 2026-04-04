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
                    var generator = thumbnailGenerators.FirstOrDefault(g => g.CanHandle(mediaItem.ContentType));
                    if (generator != null)
                    {
                        await using var thumbSourceStream = File.OpenRead(tempPath);
                        using var thumbStream = await generator.GenerateAsync(thumbSourceStream, mediaItem.ContentType, 300, stoppingToken);
                        var thumbPath = BlobPathGenerator.Generate(mediaItem.Id, ".jpg");
                        await blobService.UploadAsync(thumbStream, _storageOptions.ThumbnailsContainer, thumbPath, "image/jpeg", stoppingToken);
                        mediaItem.ThumbnailBlobPath = thumbPath;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Thumbnail generation failed for {MediaId}, continuing", mediaItem.Id);
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
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing {MediaId}", item.Message.MediaId);
        }
        finally
        {
            semaphore.Release();
        }
    }
}
