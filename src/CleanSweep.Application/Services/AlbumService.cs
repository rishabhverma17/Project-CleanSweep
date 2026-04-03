using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;

namespace CleanSweep.Application.Services;

public class AlbumService
{
    private readonly IAlbumRepository _albumRepo;
    private readonly IMediaRepository _mediaRepo;
    private readonly IUserRepository _userRepo;
    private readonly ICurrentUserService _currentUser;
    private readonly MediaService _mediaService;

    public AlbumService(IAlbumRepository albumRepo, IMediaRepository mediaRepo, IUserRepository userRepo, ICurrentUserService currentUser, MediaService mediaService)
    {
        _albumRepo = albumRepo;
        _mediaRepo = mediaRepo;
        _userRepo = userRepo;
        _currentUser = currentUser;
        _mediaService = mediaService;
    }

    public async Task<AlbumDto> CreateAsync(string name, string? description, CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        await _userRepo.UpsertAsync(userId, _currentUser.Email ?? "", _currentUser.DisplayName ?? "", ct);
        var album = new Album
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            Name = name,
            Description = description,
            CreatedAt = DateTimeOffset.UtcNow
        };

        await _albumRepo.AddAsync(album, ct);
        return new AlbumDto { Id = album.Id, Name = album.Name, Description = album.Description, CreatedAt = album.CreatedAt };
    }

    public async Task<List<AlbumDto>> GetAllAsync(CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        var albums = await _albumRepo.GetByUserIdAsync(userId, ct);
        return albums.Select(a => new AlbumDto
        {
            Id = a.Id,
            Name = a.Name,
            Description = a.Description,
            CoverThumbnailUrl = a.CoverThumbnailUrl,
            MediaCount = a.AlbumMedia.Count(am => am.Media != null && !am.Media.IsDeleted),
            IsHidden = a.IsHidden,
            CreatedAt = a.CreatedAt
        }).ToList();
    }

    public async Task AddMediaAsync(Guid albumId, List<Guid> mediaIds, CancellationToken ct)
    {
        for (var i = 0; i < mediaIds.Count; i++)
            await _albumRepo.AddMediaAsync(albumId, mediaIds[i], i, ct);
    }

    public async Task<AlbumDto?> GetByIdAsync(Guid albumId, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct);
        if (album == null) return null;
        return new AlbumDto
        {
            Id = album.Id,
            Name = album.Name,
            Description = album.Description,
            CoverThumbnailUrl = album.CoverThumbnailUrl,
            MediaCount = album.AlbumMedia.Count,
            CreatedAt = album.CreatedAt
        };
    }

    public async Task RemoveMediaAsync(Guid albumId, Guid mediaId, CancellationToken ct)
    {
        await _albumRepo.RemoveMediaAsync(albumId, mediaId, ct);
    }

    public async Task DeleteAlbumAsync(Guid albumId, bool deleteMedia, CancellationToken ct)
    {
        if (deleteMedia)
        {
            var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct);
            if (album != null)
            {
                foreach (var am in album.AlbumMedia)
                    await _mediaService.DeleteMediaWithBlobsAsync(am.MediaId, ct);
            }
        }
        await _albumRepo.DeleteAsync(albumId, ct);
    }

    public async Task<bool> ToggleHiddenAsync(Guid albumId, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct)
            ?? throw new KeyNotFoundException("Album not found");
        album.IsHidden = !album.IsHidden;
        await _albumRepo.UpdateAsync(album, ct);
        return album.IsHidden;
    }
}
