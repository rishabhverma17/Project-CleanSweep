using CleanSweep.Application.DTOs;

namespace CleanSweep.Application.Interfaces;

public interface ITranscodeQueue
{
    Task EnqueueAsync(TranscodeMessage message, CancellationToken ct = default);
    Task<QueueItem<TranscodeMessage>?> DequeueAsync(TimeSpan visibilityTimeout, CancellationToken ct = default);
    Task CompleteAsync(string messageId, string popReceipt, CancellationToken ct = default);
}
