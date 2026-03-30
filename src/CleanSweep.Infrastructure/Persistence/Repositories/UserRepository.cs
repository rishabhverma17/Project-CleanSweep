using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using Microsoft.EntityFrameworkCore;

namespace CleanSweep.Infrastructure.Persistence.Repositories;

public class UserRepository : IUserRepository
{
    private readonly AppDbContext _db;

    public UserRepository(AppDbContext db) => _db = db;

    public async Task<AppUser?> GetByIdAsync(string azureAdObjectId, CancellationToken ct)
        => await _db.Users.FindAsync(new object?[] { azureAdObjectId }, ct);

    public async Task<AppUser> UpsertAsync(string azureAdObjectId, string email, string displayName, CancellationToken ct)
    {
        var user = await _db.Users.FindAsync(new object?[] { azureAdObjectId }, ct);
        if (user == null)
        {
            user = new AppUser { Id = azureAdObjectId, Email = email, DisplayName = displayName, FirstSeenAt = DateTimeOffset.UtcNow, LastSeenAt = DateTimeOffset.UtcNow };
            _db.Users.Add(user);
        }
        else
        {
            user.Email = email;
            user.DisplayName = displayName;
            user.LastSeenAt = DateTimeOffset.UtcNow;
        }
        await _db.SaveChangesAsync(ct);
        return user;
    }

    public async Task<List<AppUser>> GetAllAsync(CancellationToken ct)
        => await _db.Users.OrderBy(u => u.DisplayName).ToListAsync(ct);
}
