using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CleanSweep.Infrastructure.Persistence.Repositories;

public class AlbumRepository : IAlbumRepository
{
    private readonly AppDbContext _db;

    public AlbumRepository(AppDbContext db) => _db = db;

    public async Task<Album> AddAsync(Album album, CancellationToken ct)
    {
        _db.Albums.Add(album);
        await _db.SaveChangesAsync(ct);
        return album;
    }

    public async Task<Album?> GetByIdWithMediaAsync(Guid id, CancellationToken ct)
        => await _db.Albums.Include(a => a.AlbumMedia).ThenInclude(am => am.Media).FirstOrDefaultAsync(a => a.Id == id, ct);

    public async Task<List<Album>> GetByUserIdAsync(string userId, CancellationToken ct)
        => await _db.Albums.Include(a => a.AlbumMedia).ThenInclude(am => am.Media).Where(a => a.UserId == userId).OrderByDescending(a => a.CreatedAt).ToListAsync(ct);

    public async Task UpdateAsync(Album album, CancellationToken ct)
    {
        _db.Albums.Update(album);
        await _db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var album = await _db.Albums.FindAsync(new object?[] { id }, ct);
        if (album != null) { _db.Albums.Remove(album); await _db.SaveChangesAsync(ct); }
    }

    public async Task AddMediaAsync(Guid albumId, Guid mediaId, int sortOrder, CancellationToken ct)
    {
        _db.AlbumMedia.Add(new AlbumMedia { AlbumId = albumId, MediaId = mediaId, SortOrder = sortOrder });
        await _db.SaveChangesAsync(ct);
    }

    public async Task RemoveMediaAsync(Guid albumId, Guid mediaId, CancellationToken ct)
    {
        var item = await _db.AlbumMedia.FindAsync(new object?[] { albumId, mediaId }, ct);
        if (item != null) { _db.AlbumMedia.Remove(item); await _db.SaveChangesAsync(ct); }
    }
}
