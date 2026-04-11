using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Application.Services;
using CleanSweep.Infrastructure.Persistence;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class FamilyController : ControllerBase
{
    private readonly FamilyService _familyService;
    private readonly IFamilyRepository _familyRepo;
    private readonly IAlbumRepository _albumRepo;
    private readonly IBlobStorageService _blobService;
    private readonly INotificationService _notificationService;
    private readonly StorageOptions _storageOptions;
    private readonly AppDbContext _db;

    public FamilyController(FamilyService familyService, IFamilyRepository familyRepo, IAlbumRepository albumRepo, IBlobStorageService blobService, INotificationService notificationService, IOptions<StorageOptions> storageOptions, AppDbContext db)
    {
        _familyService = familyService;
        _familyRepo = familyRepo;
        _albumRepo = albumRepo;
        _blobService = blobService;
        _notificationService = notificationService;
        _storageOptions = storageOptions.Value;
        _db = db;
    }

    [HttpGet]
    public async Task<ActionResult<List<FamilyDto>>> GetMyFamilies(CancellationToken ct)
        => Ok(await _familyService.GetMyFamiliesAsync(ct));

    [HttpPost]
    public async Task<ActionResult<FamilyDto>> Create([FromBody] CreateFamilyInput input, CancellationToken ct)
        => Ok(await _familyService.CreateAsync(input.Name, ct));

    [HttpPost("join")]
    public async Task<ActionResult> Join([FromBody] JoinFamilyInput input, CancellationToken ct)
    {
        var familyName = await _familyService.JoinByInviteCodeAsync(input.InviteCode, ct);
        return Ok(new { familyName });
    }

    [HttpPost("{familyId:guid}/share")]
    public async Task<ActionResult> ShareMedia(Guid familyId, [FromBody] ShareMediaInput input, CancellationToken ct)
    {
        await _familyService.ShareMediaToFamilyAsync(familyId, input.MediaIds, ct);
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return Ok();
    }

    [HttpDelete("{familyId:guid}/media/{mediaId:guid}")]
    public async Task<ActionResult> UnshareMedia(Guid familyId, Guid mediaId, CancellationToken ct)
    {
        await _familyService.UnshareMediaFromFamilyAsync(familyId, mediaId, ct);
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return NoContent();
    }

    [HttpGet("{familyId:guid}/media")]
    public async Task<ActionResult> GetFamilyMedia(Guid familyId, [FromQuery] int page = 1, [FromQuery] int pageSize = 50, CancellationToken ct = default)
    {
        var userId = HttpContext.User.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
                  ?? HttpContext.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null || !await _familyRepo.IsMemberAsync(familyId, userId, ct))
            return Forbid();

        var items = await _familyRepo.GetFamilyMediaAsync(familyId, page, pageSize, ct);
        var totalCount = await _familyRepo.GetFamilyMediaCountAsync(familyId, ct);
        var sasExpiry = TimeSpan.FromMinutes(_storageOptions.ReadSasExpiryMinutes);

        var dtos = new List<MediaItemDto>();
        foreach (var fm in items)
        {
            var m = fm.Media;
            string? thumbUrl = null, playbackUrl = null;
            if (m.ThumbnailBlobPath != null)
                thumbUrl = (await _blobService.GenerateReadSasUriAsync(_storageOptions.ThumbnailsContainer, m.ThumbnailBlobPath, sasExpiry, ct)).ToString();
            if (m.PlaybackBlobPath != null)
            {
                var container = m.PlaybackBlobPath == m.OriginalBlobPath ? _storageOptions.OriginalsContainer : _storageOptions.PlaybackContainer;
                playbackUrl = (await _blobService.GenerateReadSasUriAsync(container, m.PlaybackBlobPath, sasExpiry, ct)).ToString();
            }
            dtos.Add(new MediaItemDto
            {
                Id = m.Id, FileName = m.FileName, MediaType = m.MediaType, ContentType = m.ContentType,
                FileSizeBytes = m.FileSizeBytes, Width = m.Width, Height = m.Height, DurationSeconds = m.DurationSeconds,
                CapturedAt = m.CapturedAt, UploadedAt = m.UploadedAt, ProcessingStatus = m.ProcessingStatus,
                ThumbnailUrl = thumbUrl, PlaybackUrl = playbackUrl
            });
        }

        return Ok(new PaginatedResult<MediaItemDto> { Items = dtos, TotalCount = totalCount, Page = page, PageSize = pageSize });
    }

    [HttpDelete("{familyId:guid}/members/{userId}")]
    public async Task<ActionResult> RemoveMember(Guid familyId, string userId, CancellationToken ct)
    {
        await _familyService.RemoveMemberAsync(familyId, userId, ct);
        return NoContent();
    }

    [HttpDelete("{familyId:guid}")]
    [Authorize(Roles = "owner")]
    public async Task<ActionResult> DeleteFamily(Guid familyId, CancellationToken ct)
    {
        await _familyService.DeleteFamilyAsync(familyId, ct);
        return NoContent();
    }

    [HttpPost("{familyId:guid}/invite")]
    public async Task<ActionResult> RegenerateInvite(Guid familyId, [FromBody] RegenerateInviteInput input, CancellationToken ct)
    {
        var code = await _familyService.RegenerateInviteCodeAsync(familyId, input.ExpiryDays, ct);
        return Ok(new { inviteCode = code });
    }

    [HttpPost("{familyId:guid}/albums/{albumId:guid}")]
    public async Task<ActionResult> ShareAlbum(Guid familyId, Guid albumId, CancellationToken ct)
    {
        var userId = HttpContext.User.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
                  ?? HttpContext.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null || !await _familyRepo.IsMemberAsync(familyId, userId, ct))
            return Forbid();

        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct);
        if (album == null || album.UserId != userId) return NotFound();

        album.FamilyId = familyId;
        await _albumRepo.UpdateAsync(album, ct);
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return Ok();
    }

    [HttpDelete("{familyId:guid}/albums/{albumId:guid}")]
    public async Task<ActionResult> UnshareAlbum(Guid familyId, Guid albumId, CancellationToken ct)
    {
        var userId = HttpContext.User.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
                  ?? HttpContext.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null) return Forbid();

        var album = await _albumRepo.GetByIdWithMediaAsync(albumId, ct);
        if (album == null) return NotFound();
        if (album.UserId != userId && !await _familyRepo.IsMemberAsync(familyId, userId, ct))
            return Forbid();

        if (album.FamilyId == familyId)
        {
            album.FamilyId = null;
            await _albumRepo.UpdateAsync(album, ct);
        }
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return NoContent();
    }

    [HttpGet("{familyId:guid}/albums")]
    public async Task<ActionResult> GetFamilyAlbums(Guid familyId, CancellationToken ct)
    {
        var userId = HttpContext.User.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
                  ?? HttpContext.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (userId == null || !await _familyRepo.IsMemberAsync(familyId, userId, ct))
            return Forbid();

        var sasExpiry = TimeSpan.FromMinutes(_storageOptions.ReadSasExpiryMinutes);

        var albums = await _db.Albums
            .Include(a => a.AlbumMedia).ThenInclude(am => am.Media)
            .Where(a => a.FamilyId == familyId && !a.IsHidden)
            .OrderByDescending(a => a.CreatedAt)
            .ToListAsync(ct);

        var dtos = new List<object>();
        foreach (var a in albums)
        {
            string? coverUrl = null;
            var coverMedia = a.AlbumMedia.FirstOrDefault(am => am.Media.ThumbnailBlobPath != null)?.Media;
            if (coverMedia?.ThumbnailBlobPath != null)
                coverUrl = (await _blobService.GenerateReadSasUriAsync(_storageOptions.ThumbnailsContainer, coverMedia.ThumbnailBlobPath, sasExpiry, ct)).ToString();

            dtos.Add(new
            {
                a.Id,
                a.Name,
                a.Description,
                CoverThumbnailUrl = coverUrl,
                MediaCount = a.AlbumMedia.Count(am => am.Media != null && !am.Media.IsDeleted),
                a.CreatedAt,
                OwnerUserId = a.UserId
            });
        }

        return Ok(dtos);
    }
}

public record CreateFamilyInput(string Name);
public record JoinFamilyInput(string InviteCode);
public record ShareMediaInput(List<Guid> MediaIds);
public record RegenerateInviteInput(int ExpiryDays = 30);
