namespace CleanSweep.Application.DTOs;

public class FamilyDto
{
    public Guid Id { get; set; }
    public string Name { get; set; } = null!;
    public string? InviteCode { get; set; }
    public int MemberCount { get; set; }
    public int MediaCount { get; set; }
    public long StorageUsedBytes { get; set; }
    public long QuotaBytes { get; set; }
    public string Role { get; set; } = null!; // Current user's role in this family
    public DateTimeOffset CreatedAt { get; set; }
}
