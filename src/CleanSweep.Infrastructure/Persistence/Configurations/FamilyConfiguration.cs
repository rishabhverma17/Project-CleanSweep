using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CleanSweep.Infrastructure.Persistence.Configurations;

public class FamilyConfiguration : IEntityTypeConfiguration<Family>
{
    public void Configure(EntityTypeBuilder<Family> builder)
    {
        builder.ToTable("families");
        builder.HasKey(f => f.Id);
        builder.Property(f => f.Name).IsRequired().HasMaxLength(256);
        builder.Property(f => f.InviteCode).HasMaxLength(64);
        builder.HasIndex(f => f.InviteCode).IsUnique().HasFilter("invite_code IS NOT NULL").HasDatabaseName("ix_families_invite_code");
        builder.HasOne(f => f.CreatedBy).WithMany().HasForeignKey(f => f.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
