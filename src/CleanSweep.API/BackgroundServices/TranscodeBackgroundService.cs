using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Enums;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.BackgroundServices;

public class TranscodeBackgroundService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ITranscodeQueue _queue;
    private readonly ILogger<TranscodeBackgroundService> _logger;
    private readonly QueueOptions _queueOptions;
    private readonly StorageOptions _storageOptions;

    public TranscodeBackgroundService(
        IServiceScopeFactory scopeFactory,
        ITranscodeQueue queue,
        ILogger<TranscodeBackgroundService> logger,
        IOptions<QueueOptions> queueOptions,
        IOptions<StorageOptions> storageOptions)
    {
        _scopeFactory = scopeFactory;
        _queue = queue;
        _logger = logger;
        _queueOptions = queueOptions.Value;
        _storageOptions = storageOptions.Value;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("TranscodeBackgroundService started, listening on queue '{Queue}'", _queueOptions.TranscodeQueue);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var visibilityTimeout = TimeSpan.FromSeconds(_queueOptions.TranscodeVisibilityTimeoutSeconds);
                var item = await _queue.DequeueAsync(visibilityTimeout, stoppingToken);

                if (item == null)
                {
                    await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
                    continue;
                }

                using var logScope = _logger.BeginScope(new Dictionary<string, object>
                {
                    ["CorrelationId"] = item.Message.CorrelationId,
                    ["MediaId"] = item.Message.MediaId
                });

                _logger.LogInformation("Transcoding: {Source} → {Target}", item.Message.SourceBlobPath, item.Message.TargetBlobPath);

                using var scope = _scopeFactory.CreateScope();
                var mediaRepo = scope.ServiceProvider.GetRequiredService<IMediaRepository>();
                var transcoder = scope.ServiceProvider.GetRequiredService<ITranscoder>();
                var blobService = scope.ServiceProvider.GetRequiredService<IBlobStorageService>();
                var notificationService = scope.ServiceProvider.GetRequiredService<INotificationService>();

                var mediaItem = await mediaRepo.GetByIdAsync(item.Message.MediaId, stoppingToken);
                if (mediaItem == null)
                {
                    _logger.LogWarning("Media item {MediaId} not found, discarding", item.Message.MediaId);
                    await _queue.CompleteAsync(item.MessageId, item.PopReceipt, stoppingToken);
                    continue;
                }

                var result = await transcoder.TranscodeAsync(item.Message.SourceBlobPath, item.Message.TargetBlobPath, stoppingToken);

                if (result.Success)
                {
                    mediaItem.PlaybackBlobPath = item.Message.TargetBlobPath;
                    mediaItem.ProcessingStatus = ProcessingStatus.Complete;
                    _logger.LogInformation("Transcode complete for {MediaId}", mediaItem.Id);
                }
                else
                {
                    mediaItem.ProcessingStatus = ProcessingStatus.Failed;
                    _logger.LogError("Transcode FAILED for {MediaId}: {Error}", mediaItem.Id, result.ErrorMessage);
                }

                await mediaRepo.UpdateAsync(mediaItem, stoppingToken);
                await _queue.CompleteAsync(item.MessageId, item.PopReceipt, stoppingToken);

                string? playbackUrl = null;
                if (mediaItem.PlaybackBlobPath != null)
                    playbackUrl = (await blobService.GenerateReadSasUriAsync(_storageOptions.PlaybackContainer, mediaItem.PlaybackBlobPath, TimeSpan.FromMinutes(15), stoppingToken)).ToString();

                await notificationService.NotifyMediaStatusChangedAsync(mediaItem.UserId, new MediaStatusUpdate
                {
                    MediaId = mediaItem.Id,
                    Status = mediaItem.ProcessingStatus.ToString(),
                    PlaybackUrl = playbackUrl
                }, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in transcode loop");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
    }
}
