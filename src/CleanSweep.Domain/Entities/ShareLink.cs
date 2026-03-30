namespace CleanSweep.Domain.Entities;

public class ShareLink
{
    public Guid Id { get; set; }
    public string Token { get; set; } = null!;
    public Guid? AlbumId { get; set; }
    public Guid? MediaId { get; set; }
    public string CreatedByUserId { get; set; } = null!;
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public Album? Album { get; set; }
    public MediaItem? Media { get; set; }
    public AppUser CreatedBy { get; set; } = null!;
}
