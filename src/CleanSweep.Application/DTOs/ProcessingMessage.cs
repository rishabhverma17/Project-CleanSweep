namespace CleanSweep.Application.DTOs;

public class ProcessingMessage
{
    public Guid MediaId { get; set; }
    public string BlobPath { get; set; } = null!;
    public string ContentType { get; set; } = null!;
    public string FileName { get; set; } = null!;
    public string UserId { get; set; } = null!;
    public string CorrelationId { get; set; } = null!;
}
