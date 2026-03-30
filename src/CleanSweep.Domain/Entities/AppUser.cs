namespace CleanSweep.Domain.Entities;

public class AppUser
{
    public string Id { get; set; } = null!;
    public string Email { get; set; } = null!;
    public string DisplayName { get; set; } = null!;
    public DateTimeOffset FirstSeenAt { get; set; }
    public DateTimeOffset LastSeenAt { get; set; }
    public long QuotaBytes { get; set; } = 500L * 1024 * 1024 * 1024; // 500 GB default

    public ICollection<MediaItem> MediaItems { get; set; } = new List<MediaItem>();
    public ICollection<Album> Albums { get; set; } = new List<Album>();
    public ICollection<FamilyMember> FamilyMemberships { get; set; } = new List<FamilyMember>();
}
