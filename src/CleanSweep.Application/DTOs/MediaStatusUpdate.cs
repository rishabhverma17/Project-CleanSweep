namespace CleanSweep.Application.DTOs;

public class MediaStatusUpdate
{
    public Guid MediaId { get; set; }
    public string Status { get; set; } = null!;
    public string? ThumbnailUrl { get; set; }
    public string? PlaybackUrl { get; set; }
}
