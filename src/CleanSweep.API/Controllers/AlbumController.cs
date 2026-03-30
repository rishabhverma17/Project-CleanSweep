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
    private readonly StorageOptions _storageOptions;

    public AlbumController(AlbumService albumService, IAlbumRepository albumRepo, IBlobStorageService blobService, IOptions<StorageOptions> storageOptions)
    {
        _albumService = albumService;
        _albumRepo = albumRepo;
        _blobService = blobService;
        _storageOptions = storageOptions.Value;
    }

    [HttpGet]
    public async Task<ActionResult<List<AlbumDto>>> GetAll(CancellationToken ct)
        => Ok(await _albumService.GetAllAsync(ct));

    [HttpGet("{albumId:guid}")]
    public async Task<ActionResult> GetById(Guid albumId, CancellationToken ct)
    {
        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct);
        if (album == null) return NotFound();

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

        return Ok(new { album = new AlbumDto { Id = album.Id, Name = album.Name, Description = album.Description, CoverThumbnailUrl = album.CoverThumbnailUrl, MediaCount = mediaItems.Count, CreatedAt = album.CreatedAt }, media = mediaItems });
    }

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
        return NoContent();
    }
}

public record CreateAlbumInput(string Name, string? Description);
public record AddMediaInput(List<Guid> MediaIds);
