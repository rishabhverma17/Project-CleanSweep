using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CleanSweep.Infrastructure.Persistence.Configurations;

public class ShareLinkConfiguration : IEntityTypeConfiguration<ShareLink>
{
    public void Configure(EntityTypeBuilder<ShareLink> builder)
    {
        builder.ToTable("share_links");
        builder.HasKey(s => s.Id);
        builder.Property(s => s.Token).IsRequired().HasMaxLength(128);
        builder.HasIndex(s => s.Token).IsUnique().HasDatabaseName("ix_share_links_token");

        builder.HasOne(s => s.Album).WithMany().HasForeignKey(s => s.AlbumId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(s => s.Media).WithMany().HasForeignKey(s => s.MediaId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne(s => s.CreatedBy).WithMany().HasForeignKey(s => s.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
    }
}
