using System.Security.Cryptography;
using CleanSweep.Application.Configuration;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using Microsoft.Extensions.Options;

namespace CleanSweep.Application.Services;

public class ShareService
{
    private readonly IShareLinkRepository _shareLinkRepo;
    private readonly IAlbumRepository _albumRepo;
    private readonly IBlobStorageService _blobService;
    private readonly ICurrentUserService _currentUser;
    private readonly StorageOptions _storageOptions;

    public ShareService(
        IShareLinkRepository shareLinkRepo,
        IAlbumRepository albumRepo,
        IBlobStorageService blobService,
        ICurrentUserService currentUser,
        IOptions<StorageOptions> storageOptions)
    {
        _shareLinkRepo = shareLinkRepo;
        _albumRepo = albumRepo;
        _blobService = blobService;
        _currentUser = currentUser;
        _storageOptions = storageOptions.Value;
    }

    public async Task<string> CreateShareLinkAsync(Guid? albumId, Guid? mediaId, int expiryHours, CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        var tokenBytes = RandomNumberGenerator.GetBytes(32);
        var token = Convert.ToBase64String(tokenBytes).Replace("+", "-").Replace("/", "_").TrimEnd('=');

        var shareLink = new ShareLink
        {
            Id = Guid.NewGuid(),
            Token = token,
            AlbumId = albumId,
            MediaId = mediaId,
            CreatedByUserId = userId,
            ExpiresAt = DateTimeOffset.UtcNow.AddHours(expiryHours),
            CreatedAt = DateTimeOffset.UtcNow
        };

        await _shareLinkRepo.AddAsync(shareLink, ct);
        return token;
    }

    public async Task<ShareLink?> ValidateTokenAsync(string token, CancellationToken ct)
    {
        var link = await _shareLinkRepo.GetByTokenAsync(token, ct);
        if (link == null || link.ExpiresAt < DateTimeOffset.UtcNow)
            return null;
        return link;
    }
}
