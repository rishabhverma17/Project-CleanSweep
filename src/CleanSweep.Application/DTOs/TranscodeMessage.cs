namespace CleanSweep.Application.DTOs;

public class TranscodeMessage
{
    public Guid MediaId { get; set; }
    public string SourceBlobPath { get; set; } = null!;
    public string TargetBlobPath { get; set; } = null!;
    public string SourceContainer { get; set; } = null!;
    public string TargetContainer { get; set; } = null!;
    public string UserId { get; set; } = null!;
    public string CorrelationId { get; set; } = null!;
}
