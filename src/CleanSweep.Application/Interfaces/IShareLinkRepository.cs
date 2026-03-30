using CleanSweep.Domain.Entities;

namespace CleanSweep.Application.Interfaces;

public interface IShareLinkRepository
{
    Task<ShareLink> AddAsync(ShareLink link, CancellationToken ct = default);
    Task<ShareLink?> GetByTokenAsync(string token, CancellationToken ct = default);
    Task DeleteExpiredAsync(CancellationToken ct = default);
}
