using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CleanSweep.Infrastructure.Persistence.Configurations;

public class FamilyMediaConfiguration : IEntityTypeConfiguration<FamilyMedia>
{
    public void Configure(EntityTypeBuilder<FamilyMedia> builder)
    {
        builder.ToTable("family_media");
        builder.HasKey(fm => new { fm.FamilyId, fm.MediaId });
        builder.HasOne(fm => fm.Family).WithMany(f => f.SharedMedia).HasForeignKey(fm => fm.FamilyId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(fm => fm.Media).WithMany().HasForeignKey(fm => fm.MediaId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(fm => fm.SharedBy).WithMany().HasForeignKey(fm => fm.SharedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
