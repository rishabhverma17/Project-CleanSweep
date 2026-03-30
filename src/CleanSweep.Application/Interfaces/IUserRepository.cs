using CleanSweep.Domain.Entities;

namespace CleanSweep.Application.Interfaces;

public interface IUserRepository
{
    Task<AppUser?> GetByIdAsync(string azureAdObjectId, CancellationToken ct = default);
    Task<AppUser> UpsertAsync(string azureAdObjectId, string email, string displayName, CancellationToken ct = default);
    Task<List<AppUser>> GetAllAsync(CancellationToken ct = default);
}
