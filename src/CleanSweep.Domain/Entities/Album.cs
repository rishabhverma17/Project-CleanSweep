namespace CleanSweep.Domain.Entities;

public class Album
{
    public Guid Id { get; set; }
    public string UserId { get; set; } = null!;
    public string Name { get; set; } = null!;
    public string? Description { get; set; }
    public Guid? CoverMediaId { get; set; }
    public string? CoverThumbnailUrl { get; set; }
    public Guid? FamilyId { get; set; }  // null = personal, set = family album
    public bool IsHidden { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public AppUser User { get; set; } = null!;
    public MediaItem? CoverMedia { get; set; }
    public Family? Family { get; set; }
    public ICollection<AlbumMedia> AlbumMedia { get; set; } = new List<AlbumMedia>();
}
