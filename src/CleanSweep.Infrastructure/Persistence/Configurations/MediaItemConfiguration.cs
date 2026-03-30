using CleanSweep.Domain.Entities;
using CleanSweep.Domain.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace CleanSweep.Infrastructure.Persistence.Configurations;

public class MediaItemConfiguration : IEntityTypeConfiguration<MediaItem>
{
    public void Configure(EntityTypeBuilder<MediaItem> builder)
    {
        builder.ToTable("media_items");
        builder.HasKey(m => m.Id);
        builder.Property(m => m.FileName).IsRequired().HasMaxLength(512);
        builder.Property(m => m.OriginalBlobPath).IsRequired().HasMaxLength(512);
        builder.Property(m => m.PlaybackBlobPath).HasMaxLength(512);
        builder.Property(m => m.ThumbnailBlobPath).HasMaxLength(512);
        builder.Property(m => m.ContentType).IsRequired().HasMaxLength(128);
        builder.Property(m => m.SourceCodec).HasMaxLength(32);
        builder.Property(m => m.ContentHash).HasMaxLength(128);

        builder.HasOne(m => m.User).WithMany(u => u.MediaItems).HasForeignKey(m => m.UserId).OnDelete(DeleteBehavior.Restrict);

        builder.HasIndex(m => new { m.UserId, m.CapturedAt }).HasFilter("is_deleted = false").HasDatabaseName("ix_media_items_user_captured");
        builder.HasIndex(m => m.ProcessingStatus).HasFilter("processing_status = 1").HasDatabaseName("ix_media_items_pending");
        builder.HasIndex(m => m.ContentHash).HasFilter("content_hash IS NOT NULL").HasDatabaseName("ix_media_items_hash");

        builder.Property(m => m.IsDeleted).HasDefaultValue(false);
        builder.Property(m => m.ProcessingStatus).HasDefaultValue(ProcessingStatus.Uploading);
    }
}
