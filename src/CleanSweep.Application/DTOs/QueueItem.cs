namespace CleanSweep.Application.DTOs;

public class QueueItem<T>
{
    public T Message { get; set; } = default!;
    public string MessageId { get; set; } = null!;
    public string PopReceipt { get; set; } = null!;
}
