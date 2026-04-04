using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Application.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ShareController : ControllerBase
{
    private readonly ShareService _shareService;
    private readonly IAlbumRepository _albumRepo;
    private readonly IBlobStorageService _blobService;
    private readonly StorageOptions _storageOptions;

    public ShareController(ShareService shareService, IAlbumRepository albumRepo, IBlobStorageService blobService, IOptions<StorageOptions> storageOptions)
    {
        _shareService = shareService;
        _albumRepo = albumRepo;
        _blobService = blobService;
        _storageOptions = storageOptions.Value;
    }

    [HttpPost]
    [Authorize]
    public async Task<ActionResult> Create([FromBody] CreateShareInput input, CancellationToken ct)
    {
        var token = await _shareService.CreateShareLinkAsync(input.AlbumId, input.MediaId, input.ExpiryHours, ct);
        return Ok(new { token });
    }

    [HttpGet("{token}")]
    [AllowAnonymous]
    public async Task<ActionResult> GetByToken(string token, CancellationToken ct)
    {
        var link = await _shareService.ValidateTokenAsync(token, ct);
        if (link == null) return NotFound(new { error = "Share link not found or expired." });

        var sasExpiry = TimeSpan.FromMinutes(_storageOptions.ReadSasExpiryMinutes);

        if (link.Media != null)
        {
            var m = link.Media;
            string? thumbUrl = null, playbackUrl = null;
            if (m.ThumbnailBlobPath != null)
                thumbUrl = (await _blobService.GenerateReadSasUriAsync(_storageOptions.ThumbnailsContainer, m.ThumbnailBlobPath, sasExpiry, ct)).ToString();
            if (m.PlaybackBlobPath != null)
            {
                var container = m.PlaybackBlobPath == m.OriginalBlobPath ? _storageOptions.OriginalsContainer : _storageOptions.PlaybackContainer;
                playbackUrl = (await _blobService.GenerateReadSasUriAsync(container, m.PlaybackBlobPath, sasExpiry, ct)).ToString();
            }
            return Ok(new
            {
                type = "media",
                expiresAt = link.ExpiresAt,
                media = new MediaItemDto
                {
                    Id = m.Id, FileName = m.FileName, MediaType = m.MediaType, ContentType = m.ContentType,
                    FileSizeBytes = m.FileSizeBytes, Width = m.Width, Height = m.Height, DurationSeconds = m.DurationSeconds,
                    CapturedAt = m.CapturedAt, UploadedAt = m.UploadedAt, ProcessingStatus = m.ProcessingStatus,
                    ThumbnailUrl = thumbUrl, PlaybackUrl = playbackUrl
                }
            });
        }

        if (link.AlbumId.HasValue)
        {
            var album = await _albumRepo.GetByIdWithMediaAsync(link.AlbumId.Value, ct);
            if (album == null) return NotFound(new { error = "Album not found." });

            var mediaItems = new List<MediaItemDto>();
            foreach (var am in album.AlbumMedia.OrderBy(x => x.SortOrder))
            {
                var m = am.Media;
                if (m.IsDeleted) continue;
                string? thumbUrl = null, playbackUrl = null;
                if (m.ThumbnailBlobPath != null)
                    thumbUrl = (await _blobService.GenerateReadSasUriAsync(_storageOptions.ThumbnailsContainer, m.ThumbnailBlobPath, sasExpiry, ct)).ToString();
                if (m.PlaybackBlobPath != null)
                {
                    var container = m.PlaybackBlobPath == m.OriginalBlobPath ? _storageOptions.OriginalsContainer : _storageOptions.PlaybackContainer;
                    playbackUrl = (await _blobService.GenerateReadSasUriAsync(container, m.PlaybackBlobPath, sasExpiry, ct)).ToString();
                }
                mediaItems.Add(new MediaItemDto
                {
                    Id = m.Id, FileName = m.FileName, MediaType = m.MediaType, ContentType = m.ContentType,
                    FileSizeBytes = m.FileSizeBytes, Width = m.Width, Height = m.Height, DurationSeconds = m.DurationSeconds,
                    CapturedAt = m.CapturedAt, UploadedAt = m.UploadedAt, ProcessingStatus = m.ProcessingStatus,
                    ThumbnailUrl = thumbUrl, PlaybackUrl = playbackUrl
                });
            }

            return Ok(new
            {
                type = "album",
                expiresAt = link.ExpiresAt,
                album = new AlbumDto
                {
                    Id = album.Id, Name = album.Name, Description = album.Description,
                    CoverThumbnailUrl = album.CoverThumbnailUrl,
                    MediaCount = mediaItems.Count, IsHidden = album.IsHidden, CreatedAt = album.CreatedAt
                },
                media = mediaItems
            });
        }

        return Ok(new { type = "unknown", albumId = link.AlbumId, mediaId = link.MediaId, expiresAt = link.ExpiresAt });
    }
}

public record CreateShareInput(Guid? AlbumId, Guid? MediaId, int ExpiryHours = 72);
