namespace CleanSweep.Domain.Entities;

public class FamilyMedia
{
    public Guid FamilyId { get; set; }
    public Guid MediaId { get; set; }
    public string SharedByUserId { get; set; } = null!;
    public DateTimeOffset SharedAt { get; set; }

    public Family Family { get; set; } = null!;
    public MediaItem Media { get; set; } = null!;
    public AppUser SharedBy { get; set; } = null!;
}
