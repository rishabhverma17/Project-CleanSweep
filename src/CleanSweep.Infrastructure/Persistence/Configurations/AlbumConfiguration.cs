using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CleanSweep.Infrastructure.Persistence.Configurations;

public class AlbumConfiguration : IEntityTypeConfiguration<Album>
{
    public void Configure(EntityTypeBuilder<Album> builder)
    {
        builder.ToTable("albums");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Name).IsRequired().HasMaxLength(256);
        builder.Property(a => a.Description).HasMaxLength(1024);
        builder.Property(a => a.CoverThumbnailUrl).HasMaxLength(2048);

        builder.HasOne(a => a.User).WithMany(u => u.Albums).HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(a => a.CoverMedia).WithMany().HasForeignKey(a => a.CoverMediaId).OnDelete(DeleteBehavior.SetNull);
        builder.HasOne(a => a.Family).WithMany().HasForeignKey(a => a.FamilyId).OnDelete(DeleteBehavior.SetNull);
        builder.Property(a => a.IsHidden).HasDefaultValue(false);
    }
}
