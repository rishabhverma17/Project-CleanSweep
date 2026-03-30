using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CleanSweep.Infrastructure.Persistence.Configurations;

public class FamilyMemberConfiguration : IEntityTypeConfiguration<FamilyMember>
{
    public void Configure(EntityTypeBuilder<FamilyMember> builder)
    {
        builder.ToTable("family_members");
        builder.HasKey(fm => new { fm.FamilyId, fm.UserId });
        builder.Property(fm => fm.Role).IsRequired().HasMaxLength(32).HasDefaultValue("member");
        builder.HasOne(fm => fm.Family).WithMany(f => f.Members).HasForeignKey(fm => fm.FamilyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(fm => fm.User).WithMany(u => u.FamilyMemberships).HasForeignKey(fm => fm.UserId).OnDelete(DeleteBehavior.Restrict);
    }
}
