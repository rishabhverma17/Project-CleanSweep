using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CleanSweep.Infrastructure.Persistence.Repositories;

public class FamilyRepository : IFamilyRepository
{
    private readonly AppDbContext _db;
    public FamilyRepository(AppDbContext db) => _db = db;

    public async Task<Family> AddAsync(Family family, CancellationToken ct)
    {
        _db.Families.Add(family);
        await _db.SaveChangesAsync(ct);
        return family;
    }

    public async Task<Family?> GetByIdAsync(Guid id, CancellationToken ct)
        => await _db.Families.FindAsync(new object?[] { id }, ct);

    public async Task<Family?> GetByIdWithMembersAsync(Guid id, CancellationToken ct)
        => await _db.Families.Include(f => f.Members).ThenInclude(m => m.User).FirstOrDefaultAsync(f => f.Id == id, ct);

    public async Task<Family?> GetByInviteCodeAsync(string code, CancellationToken ct)
        => await _db.Families.FirstOrDefaultAsync(f => f.InviteCode == code, ct);

    public async Task<List<Family>> GetByUserIdAsync(string userId, CancellationToken ct)
        => await _db.Families
            .Include(f => f.Members)
            .Where(f => f.Members.Any(m => m.UserId == userId))
            .OrderByDescending(f => f.CreatedAt)
            .ToListAsync(ct);

    public async Task UpdateAsync(Family family, CancellationToken ct)
    {
        _db.Families.Update(family);
        await _db.SaveChangesAsync(ct);
    }

    public async Task DeleteAsync(Guid id, CancellationToken ct)
    {
        var family = await _db.Families.FindAsync(new object?[] { id }, ct);
        if (family != null) { _db.Families.Remove(family); await _db.SaveChangesAsync(ct); }
    }

    public async Task AddMemberAsync(FamilyMember member, CancellationToken ct)
    {
        _db.FamilyMembers.Add(member);
        await _db.SaveChangesAsync(ct);
    }

    public async Task RemoveMemberAsync(Guid familyId, string userId, CancellationToken ct)
    {
        var member = await _db.FamilyMembers.FindAsync(new object?[] { familyId, userId }, ct);
        if (member != null) { _db.FamilyMembers.Remove(member); await _db.SaveChangesAsync(ct); }
    }

    public async Task AddMediaAsync(FamilyMedia media, CancellationToken ct)
    {
        _db.FamilyMedia.Add(media);
        await _db.SaveChangesAsync(ct);
    }

    public async Task RemoveMediaAsync(Guid familyId, Guid mediaId, CancellationToken ct)
    {
        var fm = await _db.FamilyMedia.FindAsync(new object?[] { familyId, mediaId }, ct);
        if (fm != null) { _db.FamilyMedia.Remove(fm); await _db.SaveChangesAsync(ct); }
    }

    public async Task<List<FamilyMedia>> GetFamilyMediaAsync(Guid familyId, int page, int pageSize, CancellationToken ct)
        => await _db.FamilyMedia
            .Include(fm => fm.Media)
            .Where(fm => fm.FamilyId == familyId && !fm.Media.IsDeleted)
            .OrderByDescending(fm => fm.SharedAt)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

    public async Task<int> GetFamilyMediaCountAsync(Guid familyId, CancellationToken ct)
        => await _db.FamilyMedia.CountAsync(fm => fm.FamilyId == familyId && !fm.Media.IsDeleted, ct);

    public async Task<long> GetFamilyStorageUsageAsync(Guid familyId, CancellationToken ct)
        => await _db.FamilyMedia
            .Where(fm => fm.FamilyId == familyId && !fm.Media.IsDeleted)
            .SumAsync(fm => fm.Media.FileSizeBytes, ct);

    public async Task<bool> IsMemberAsync(Guid familyId, string userId, CancellationToken ct)
        => await _db.FamilyMembers.AnyAsync(fm => fm.FamilyId == familyId && fm.UserId == userId, ct);
}
