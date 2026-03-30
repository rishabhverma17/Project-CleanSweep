using CleanSweep.Application.DTOs;

namespace CleanSweep.Application.Interfaces;

public interface IMediaProcessingQueue
{
    Task EnqueueAsync(ProcessingMessage message, CancellationToken ct = default);
    Task<QueueItem<ProcessingMessage>?> DequeueAsync(TimeSpan visibilityTimeout, CancellationToken ct = default);
    Task CompleteAsync(string messageId, string popReceipt, CancellationToken ct = default);
}
