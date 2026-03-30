using CleanSweep.Application.DTOs;
using CleanSweep.Domain.Entities;
using CleanSweep.Domain.Enums;

namespace CleanSweep.Application.Interfaces;

public interface IMediaRepository
{
    Task<MediaItem> AddAsync(MediaItem item, CancellationToken ct = default);
    Task<MediaItem?> GetByIdAsync(Guid id, CancellationToken ct = default);
    Task<PaginatedResult<MediaItem>> BrowseAsync(string userId, int page, int pageSize, MediaType? type = null, DateTimeOffset? from = null, DateTimeOffset? to = null, string? sort = null, CancellationToken ct = default);
    Task<List<MediaItem>> GetStuckItemsAsync(TimeSpan stuckThreshold, int limit, CancellationToken ct = default);
    Task UpdateAsync(MediaItem item, CancellationToken ct = default);
    Task SoftDeleteAsync(Guid id, CancellationToken ct = default);
    Task<long> GetUserStorageUsageAsync(string userId, CancellationToken ct = default);
}
