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
[Authorize]
public class AlbumController : ControllerBase
{
    private readonly AlbumService _albumService;
    private readonly IAlbumRepository _albumRepo;
    private readonly IBlobStorageService _blobService;
    private readonly INotificationService _notificationService;
    private readonly StorageOptions _storageOptions;

    public AlbumController(AlbumService albumService, IAlbumRepository albumRepo, IBlobStorageService blobService, INotificationService notificationService, IOptions<StorageOptions> storageOptions)
    {
        _albumService = albumService;
        _albumRepo = albumRepo;
        _blobService = blobService;
        _notificationService = notificationService;
        _storageOptions = storageOptions.Value;
    }

    [HttpGet]
    public async Task<ActionResult<List<AlbumDto>>> GetAll(CancellationToken ct)
        => Ok(await _albumService.GetAllAsync(ct));

    [HttpPost]
    public async Task<ActionResult<AlbumDto>> Create([FromBody] CreateAlbumInput input, CancellationToken ct)
        => Ok(await _albumService.CreateAsync(input.Name, input.Description, ct));

    [HttpPost("{albumId:guid}/media")]
    public async Task<ActionResult> AddMedia(Guid albumId, [FromBody] AddMediaInput input, CancellationToken ct)
    {
        await _albumService.AddMediaAsync(albumId, input.MediaIds, ct);
        return Ok();
    }

    [HttpDelete("{albumId:guid}/media/{mediaId:guid}")]
    public async Task<ActionResult> RemoveMedia(Guid albumId, Guid mediaId, CancellationToken ct)
    {
        await _albumService.RemoveMediaAsync(albumId, mediaId, ct);
        return NoContent();
    }

    [HttpDelete("{albumId:guid}")]
    [Authorize(Roles = "owner")]
    public async Task<ActionResult> DeleteAlbum(Guid albumId, [FromQuery] bool deleteMedia = false, CancellationToken ct = default)
    {
        await _albumService.DeleteAlbumAsync(albumId, deleteMedia, ct);
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return NoContent();
    }

    [HttpPut("{albumId:guid}")]
    public async Task<ActionResult<AlbumDto>> Rename(Guid albumId, [FromBody] RenameAlbumInput input, CancellationToken ct)
    {
        var album = await _albumService.RenameAsync(albumId, input.Name, input.Description, ct);
        if (album == null) return NotFound();
        return Ok(album);
    }

    [HttpPatch("{albumId:guid}/hidden")]
    public async Task<ActionResult> ToggleHidden(Guid albumId, [FromBody] ToggleHiddenInput? input, CancellationToken ct)
    {
        try
        {
            var isHidden = await _albumService.ToggleHiddenAsync(albumId, input?.Password, ct);
            return Ok(new { isHidden });
        }
        catch (UnauthorizedAccessException ex)
        {
            return Unauthorized(new { error = ex.Message });
        }
    }

    [HttpPost("{albumId:guid}/password")]
    public async Task<ActionResult> SetPassword(Guid albumId, [FromBody] SetPasswordInput input, CancellationToken ct)
    {
        await _albumService.SetPasswordAsync(albumId, input.Password, ct);
        return Ok(new { isPasswordProtected = !string.IsNullOrEmpty(input.Password) });
    }

    [HttpPost("{albumId:guid}/unlock")]
    public async Task<ActionResult> Unlock(Guid albumId, [FromBody] UnlockInput input, CancellationToken ct)
    {
        var valid = await _albumService.VerifyPasswordAsync(albumId, input.Password, ct);
        if (!valid) return Unauthorized(new { error = "Incorrect password" });
        return Ok(new { unlocked = true });
    }

    [HttpGet("{albumId:guid}")]
    public async Task<ActionResult> GetById(Guid albumId, [FromHeader(Name = "X-Album-Password")] string? albumPassword, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct);
        if (album == null) return NotFound();

        // If album is password-protected, require password header
        if (album.PasswordHash != null)
        {
            if (string.IsNullOrEmpty(albumPassword))
                return StatusCode(403, new { error = "Password required", isPasswordProtected = true });

            var valid = await _albumService.VerifyPasswordAsync(albumId, albumPassword, ct);
            if (!valid)
                return Unauthorized(new { error = "Incorrect password" });
        }

        var sasExpiry = TimeSpan.FromMinutes(_storageOptions.ReadSasExpiryMinutes);
        var mediaItems = new List<MediaItemDto>();

        foreach (var am in album.AlbumMedia.OrderBy(x => x.SortOrder))
        {
            var m = am.Media;
            if (m.IsDeleted) continue;

            string? thumbUrl = null;
            string? playbackUrl = null;

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

        return Ok(new { album = new AlbumDto { Id = album.Id, Name = album.Name, Description = album.Description, CoverThumbnailUrl = album.CoverThumbnailUrl, MediaCount = mediaItems.Count, IsHidden = album.IsHidden, IsPasswordProtected = album.PasswordHash != null, CreatedAt = album.CreatedAt }, media = mediaItems });
    }
}

public record CreateAlbumInput(string Name, string? Description);
public record RenameAlbumInput(string Name, string? Description);
public record SetPasswordInput(string? Password);
public record UnlockInput(string Password);
public record AddMediaInput(List<Guid> MediaIds);
public record ToggleHiddenInput(string? Password);
