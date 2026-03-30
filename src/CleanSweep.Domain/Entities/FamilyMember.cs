namespace CleanSweep.Domain.Entities;

public class FamilyMember
{
    public Guid FamilyId { get; set; }
    public string UserId { get; set; } = null!;
    public string Role { get; set; } = "member"; // "admin" | "member"
    public DateTimeOffset JoinedAt { get; set; }

    public Family Family { get; set; } = null!;
    public AppUser User { get; set; } = null!;
}
