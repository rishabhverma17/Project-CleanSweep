using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CleanSweep.Infrastructure.Persistence;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<AppUser> Users => Set<AppUser>();
    public DbSet<MediaItem> MediaItems => Set<MediaItem>();
    public DbSet<Album> Albums => Set<Album>();
    public DbSet<AlbumMedia> AlbumMedia => Set<AlbumMedia>();
    public DbSet<ShareLink> ShareLinks => Set<ShareLink>();
    public DbSet<Family> Families => Set<Family>();
    public DbSet<FamilyMember> FamilyMembers => Set<FamilyMember>();
    public DbSet<FamilyMedia> FamilyMedia => Set<FamilyMedia>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
    }
}
