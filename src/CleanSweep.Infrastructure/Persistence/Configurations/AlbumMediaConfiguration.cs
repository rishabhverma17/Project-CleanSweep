using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CleanSweep.Infrastructure.Persistence.Configurations;

public class AlbumMediaConfiguration : IEntityTypeConfiguration<AlbumMedia>
{
    public void Configure(EntityTypeBuilder<AlbumMedia> builder)
    {
        builder.ToTable("album_media");
        builder.HasKey(am => new { am.AlbumId, am.MediaId });
        builder.Property(am => am.SortOrder).HasDefaultValue(0);

        builder.HasOne(am => am.Album).WithMany(a => a.AlbumMedia).HasForeignKey(am => am.AlbumId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(am => am.Media).WithMany(m => m.AlbumMedia).HasForeignKey(am => am.MediaId).OnDelete(DeleteBehavior.Restrict);
    }
}
