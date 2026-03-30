namespace CleanSweep.Domain.Entities;

public class Family
{
    public Guid Id { get; set; }
    public string Name { get; set; } = null!;
    public string CreatedByUserId { get; set; } = null!;
    public string? InviteCode { get; set; }
    public DateTimeOffset? InviteExpiresAt { get; set; }
    public long QuotaBytes { get; set; } = 200L * 1024 * 1024 * 1024; // 200 GB default
    public DateTimeOffset CreatedAt { get; set; }

    public AppUser CreatedBy { get; set; } = null!;
    public ICollection<FamilyMember> Members { get; set; } = new List<FamilyMember>();
    public ICollection<FamilyMedia> SharedMedia { get; set; } = new List<FamilyMedia>();
}
