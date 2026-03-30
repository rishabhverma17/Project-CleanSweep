namespace CleanSweep.Application.DTOs;

public class TranscodeResult
{
    public bool Success { get; set; }
    public string? OutputBlobPath { get; set; }
    public string? ErrorMessage { get; set; }
}
