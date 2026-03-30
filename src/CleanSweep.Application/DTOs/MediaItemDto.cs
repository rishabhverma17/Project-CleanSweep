using CleanSweep.Domain.Enums;

namespace CleanSweep.Application.DTOs;

public class MediaItemDto
{
    public Guid Id { get; set; }
    public string FileName { get; set; } = null!;
    public MediaType MediaType { get; set; }
    public string ContentType { get; set; } = null!;
    public long FileSizeBytes { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public double? DurationSeconds { get; set; }
    public DateTimeOffset? CapturedAt { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
    public ProcessingStatus ProcessingStatus { get; set; }
    public string? ThumbnailUrl { get; set; }
    public string? PlaybackUrl { get; set; }
}
