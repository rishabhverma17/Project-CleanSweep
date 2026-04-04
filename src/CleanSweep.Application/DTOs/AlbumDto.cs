namespace CleanSweep.Application.DTOs;

public class AlbumDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = null!;
    public string? Description { get; set; }
    public string? CoverThumbnailUrl { get; set; }
    public int MediaCount { get; set; }
    public bool IsHidden { get; set; }
    public bool IsPasswordProtected { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
