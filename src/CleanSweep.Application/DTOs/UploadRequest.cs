namespace CleanSweep.Application.DTOs;

public class UploadRequest
{
    public Guid MediaId { get; set; }
    public string UploadUrl { get; set; } = null!;
    public string BlobPath { get; set; } = null!;
}
