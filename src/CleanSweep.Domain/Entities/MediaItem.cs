using CleanSweep.Domain.Enums;

namespace CleanSweep.Domain.Entities;

public class MediaItem
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = null!;
    public string FileName { get; set; } = null!;
    public MediaType MediaType { get; set; }
    public string OriginalBlobPath { get; set; } = null!;
    public string? PlaybackBlobPath { get; set; }
    public string? ThumbnailBlobPath { get; set; }
    public string ContentType { get; set; } = null!;
    public long FileSizeBytes { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public double? DurationSeconds { get; set; }
    public string? SourceCodec { get; set; }
    public string? ContentHash { get; set; }
    public DateTimeOffset? CapturedAt { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
    public ProcessingStatus ProcessingStatus { get; set; }
    public bool IsDeleted { get; set; }

    public AppUser User { get; set; } = null!;
    public ICollection<AlbumMedia> AlbumMedia { get; set; } = new List<AlbumMedia>();
}
