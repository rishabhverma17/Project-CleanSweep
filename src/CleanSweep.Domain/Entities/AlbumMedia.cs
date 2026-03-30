namespace CleanSweep.Domain.Entities;

public class AlbumMedia
{
    public Guid AlbumId { get; set; }
    public Guid MediaId { get; set; }
    public int SortOrder { get; set; }

    public Album Album { get; set; } = null!;
    public MediaItem Media { get; set; } = null!;
}
