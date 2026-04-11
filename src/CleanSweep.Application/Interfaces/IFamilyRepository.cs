using CleanSweep.Domain.Entities;

namespace CleanSweep.Application.Interfaces;

public interface IFamilyRepository
{
    Task<Family> AddAsync(Family family, CancellationToken ct = default);
    Task<Family?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<Family?> GetByIdWithMembersAsync(Guid id, CancellationToken ct = default);
    Task<Family?> GetByInviteCodeAsync(string code, CancellationToken ct = default);
    Task<List<Family>> GetByUserIdAsync(string userId, CancellationToken ct = default);
    Task UpdateAsync(Family family, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task AddMemberAsync(FamilyMember member, CancellationToken ct = default);
    Task RemoveMemberAsync(Guid familyId, string userId, CancellationToken ct = default);
    Task AddMediaAsync(FamilyMedia media, CancellationToken ct = default);
    Task RemoveMediaAsync(Guid familyId, Guid mediaId, CancellationToken ct = default);
    Task<List<FamilyMedia>> GetFamilyMediaAsync(Guid familyId, int page, int pageSize, CancellationToken ct = default);
    Task<int> GetFamilyMediaCountAsync(Guid familyId, CancellationToken ct = default);
    Task<int> GetFamilyAlbumCountAsync(Guid familyId, CancellationToken ct = default);
    Task<long> GetFamilyStorageUsageAsync(Guid familyId, CancellationToken ct = default);
    Task<bool> IsMemberAsync(Guid familyId, string userId, CancellationToken ct = default);
}
