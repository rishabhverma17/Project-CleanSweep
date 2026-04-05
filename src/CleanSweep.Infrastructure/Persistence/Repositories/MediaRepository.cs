using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using CleanSweep.Domain.Enums;
using Microsoft.EntityFrameworkCore;

namespace CleanSweep.Infrastructure.Persistence.Repositories;

public class MediaRepository : IMediaRepository
{
    private readonly AppDbContext _db;

    public MediaRepository(AppDbContext db) => _db = db;

    public async Task<MediaItem> AddAsync(MediaItem item, CancellationToken ct)
    {
        _db.MediaItems.Add(item);
        await _db.SaveChangesAsync(ct);
        return item;
    }

    public async Task<MediaItem?> GetByIdAsync(Guid id, CancellationToken ct)
        => await _db.MediaItems.FirstOrDefaultAsync(m => m.Id == id && !m.IsDeleted, ct);

    public async Task<PaginatedResult<MediaItem>> BrowseAsync(string userId, int page, int pageSize, MediaType? type, DateTimeOffset? from, DateTimeOffset? to, string? sort, CancellationToken ct)
    {
        // IDs of media that belong to any hidden album for this user
        var hiddenMediaIds = _db.AlbumMedia
            .Where(am => am.Album.UserId == userId && am.Album.IsHidden)
            .Select(am => am.MediaId);

        var query = _db.MediaItems.Where(m => m.UserId == userId && !m.IsDeleted && !hiddenMediaIds.Contains(m.Id));

        if (type.HasValue) query = query.Where(m => m.MediaType == type.Value);
        if (from.HasValue) query = query.Where(m => m.CapturedAt >= from.Value);
        if (to.HasValue) query = query.Where(m => m.CapturedAt <= to.Value);

        var totalCount = await query.CountAsync(ct);

        query = sort switch
        {
            "captured_asc" => query.OrderBy(m => m.CapturedAt ?? m.UploadedAt),
            "uploaded_desc" => query.OrderByDescending(m => m.UploadedAt),
            "size_desc" => query.OrderByDescending(m => m.FileSizeBytes),
            "type_photo" => query.OrderBy(m => m.MediaType).ThenByDescending(m => m.CapturedAt ?? m.UploadedAt),
            "type_video" => query.OrderByDescending(m => m.MediaType).ThenByDescending(m => m.CapturedAt ?? m.UploadedAt),
            _ => query.OrderByDescending(m => m.CapturedAt ?? m.UploadedAt), // default: captured_desc
        };

        var items = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync(ct);

        return new PaginatedResult<MediaItem> { Items = items, TotalCount = totalCount, Page = page, PageSize = pageSize };
    }

    public async Task<List<MediaItem>> GetStuckItemsAsync(TimeSpan stuckThreshold, int limit, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow - stuckThreshold;
        return await _db.MediaItems
            .Where(m => m.ProcessingStatus == ProcessingStatus.Pending && m.UploadedAt < cutoff)
            .OrderBy(m => m.UploadedAt)
            .Take(limit)
            .ToListAsync(ct);
    }

    public async Task UpdateAsync(MediaItem item, CancellationToken ct)
    {
        _db.MediaItems.Update(item);
        await _db.SaveChangesAsync(ct);
    }

    public async Task SoftDeleteAsync(Guid id, CancellationToken ct)
    {
        var item = await _db.MediaItems.FindAsync(new object?[] { id }, ct);
        if (item != null)
        {
            item.IsDeleted = true;
            item.DeletedAt = DateTimeOffset.UtcNow;
            await _db.SaveChangesAsync(ct);
        }
    }

    public async Task SoftDeleteBatchAsync(List<Guid> ids, CancellationToken ct)
    {
        await _db.MediaItems
            .Where(m => ids.Contains(m.Id) && !m.IsDeleted)
            .ExecuteUpdateAsync(s => s
                .SetProperty(m => m.IsDeleted, true)
                .SetProperty(m => m.DeletedAt, DateTimeOffset.UtcNow), ct);
    }

    public async Task<List<MediaItem>> GetSoftDeletedAsync(TimeSpan olderThan, int limit, CancellationToken ct)
    {
        var cutoff = DateTimeOffset.UtcNow - olderThan;
        return await _db.MediaItems
            .Where(m => m.IsDeleted && (m.DeletedAt == null || m.DeletedAt < cutoff))
            .OrderBy(m => m.DeletedAt)
            .Take(limit)
            .ToListAsync(ct);
    }

    public async Task HardDeleteBatchAsync(List<Guid> ids, CancellationToken ct)
    {
        await _db.MediaItems
            .Where(m => ids.Contains(m.Id))
            .ExecuteDeleteAsync(ct);
    }

    public async Task<long> GetUserStorageUsageAsync(string userId, CancellationToken ct)
        => await _db.MediaItems.Where(m => m.UserId == userId && !m.IsDeleted).SumAsync(m => m.FileSizeBytes, ct);
}
