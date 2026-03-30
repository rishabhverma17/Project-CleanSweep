namespace CleanSweep.Application.DTOs;

public class MediaMetadata
{
    public DateTimeOffset? DateTaken { get; set; }
    public int? Width { get; set; }
    public int? Height { get; set; }
    public double? DurationSeconds { get; set; }
    public string? Codec { get; set; }
}
