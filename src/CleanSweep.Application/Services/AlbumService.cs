using System.Security.Cryptography;
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
        return new AlbumDto { Id = album.Id, Name = album.Name, Description = album.Description, CreatedAt = album.CreatedAt, IsPasswordProtected = false };
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
            IsPasswordProtected = a.PasswordHash != null,
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
            IsPasswordProtected = album.PasswordHash != null,
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

    public async Task<AlbumDto?> RenameAsync(Guid albumId, string name, string? description, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct);
        if (album == null) return null;
        album.Name = name;
        album.Description = description;
        await _albumRepo.UpdateAsync(album, ct);
        return new AlbumDto
        {
            Id = album.Id, Name = album.Name, Description = album.Description,
            CoverThumbnailUrl = album.CoverThumbnailUrl,
            MediaCount = album.AlbumMedia.Count(am => am.Media != null && !am.Media.IsDeleted),
            IsHidden = album.IsHidden, IsPasswordProtected = album.PasswordHash != null, CreatedAt = album.CreatedAt
        };
    }

    public async Task<bool> ToggleHiddenAsync(Guid albumId, string? password, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct)
            ?? throw new KeyNotFoundException("Album not found");

        // Unhiding a password-protected album requires the correct password
        if (album.IsHidden && album.PasswordHash != null)
        {
            if (string.IsNullOrEmpty(password) || !VerifyPassword(password, album.PasswordHash))
                throw new UnauthorizedAccessException("Password required to unhide this album.");
        }

        album.IsHidden = !album.IsHidden;
        await _albumRepo.UpdateAsync(album, ct);
        return album.IsHidden;
    }

    public async Task SetPasswordAsync(Guid albumId, string? password, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct)
            ?? throw new KeyNotFoundException("Album not found");

        if (string.IsNullOrEmpty(password))
        {
            album.PasswordHash = null;
        }
        else
        {
            album.PasswordHash = HashPassword(password);
            // Auto-hide album when password is set
            album.IsHidden = true;
        }
        await _albumRepo.UpdateAsync(album, ct);
    }

    public async Task<bool> VerifyPasswordAsync(Guid albumId, string password, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct)
            ?? throw new KeyNotFoundException("Album not found");

        if (album.PasswordHash == null) return true; // not protected
        return VerifyPassword(password, album.PasswordHash);
    }

    public async Task<bool> IsPasswordProtectedAsync(Guid albumId, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct)
            ?? throw new KeyNotFoundException("Album not found");
        return album.PasswordHash != null;
    }

    private static string HashPassword(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
        var result = new byte[48]; // 16 salt + 32 hash
        salt.CopyTo(result, 0);
        hash.CopyTo(result, 16);
        return Convert.ToBase64String(result);
    }

    private static bool VerifyPassword(string password, string stored)
    {
        var data = Convert.FromBase64String(stored);
        if (data.Length != 48) return false;
        var salt = data[..16];
        var expectedHash = data[16..];
        var actualHash = Rfc2898DeriveBytes.Pbkdf2(password, salt, 100_000, HashAlgorithmName.SHA256, 32);
        return CryptographicOperations.FixedTimeEquals(actualHash, expectedHash);
    }
}
