using CleanSweep.Domain.Entities;

namespace CleanSweep.Application.Interfaces;

public interface IAlbumRepository
{
    Task<Album> AddAsync(Album album, CancellationToken ct = default);
    Task<Album?> GetByIdWithMediaAsync(Guid id, CancellationToken ct = default);
    Task<List<Album>> GetByUserIdAsync(string userId, CancellationToken ct = default);
    Task UpdateAsync(Album album, CancellationToken ct = default);
    Task DeleteAsync(Guid id, CancellationToken ct = default);
    Task AddMediaAsync(Guid albumId, Guid mediaId, int sortOrder, CancellationToken ct = default);
    Task RemoveMediaAsync(Guid albumId, Guid mediaId, CancellationToken ct = default);
}
