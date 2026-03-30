using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CleanSweep.Infrastructure.Persistence.Repositories;

public class ShareLinkRepository : IShareLinkRepository
{
    private readonly AppDbContext _db;

    public ShareLinkRepository(AppDbContext db) => _db = db;

    public async Task<ShareLink> AddAsync(ShareLink link, CancellationToken ct)
    {
        _db.ShareLinks.Add(link);
        await _db.SaveChangesAsync(ct);
        return link;
    }

    public async Task<ShareLink?> GetByTokenAsync(string token, CancellationToken ct)
        => await _db.ShareLinks.Include(s => s.Album).Include(s => s.Media).FirstOrDefaultAsync(s => s.Token == token, ct);

    public async Task DeleteExpiredAsync(CancellationToken ct)
    {
        var expired = await _db.ShareLinks.Where(s => s.ExpiresAt < DateTimeOffset.UtcNow).ToListAsync(ct);
        _db.ShareLinks.RemoveRange(expired);
        await _db.SaveChangesAsync(ct);
    }
}
