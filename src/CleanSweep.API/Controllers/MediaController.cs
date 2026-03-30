using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Application.Services;
using CleanSweep.Domain.Enums;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class MediaController : ControllerBase
{
    private readonly UploadService _uploadService;
    private readonly BrowseService _browseService;
    private readonly MediaService _mediaService;
    private readonly IMediaRepository _mediaRepo;
    private readonly IBlobStorageService _blobService;
    private readonly INotificationService _notificationService;
    private readonly StorageOptions _storageOptions;

    public MediaController(
        UploadService uploadService,
        BrowseService browseService,
        MediaService mediaService,
        IMediaRepository mediaRepo,
        IBlobStorageService blobService,
        INotificationService notificationService,
        IOptions<StorageOptions> storageOptions)
    {
        _uploadService = uploadService;
        _browseService = browseService;
        _mediaService = mediaService;
        _mediaRepo = mediaRepo;
        _blobService = blobService;
        _notificationService = notificationService;
        _storageOptions = storageOptions.Value;
    }

    [HttpPost("upload/request")]
    public async Task<ActionResult<UploadRequest>> RequestUpload([FromBody] UploadRequestInput input, CancellationToken ct)
    {
        var result = await _uploadService.RequestUploadAsync(input.FileName, input.ContentType, input.SizeBytes, ct);
        return Ok(result);
    }

    [HttpPost("upload/complete")]
    public async Task<ActionResult<UploadCompleteResult>> CompleteUpload([FromBody] UploadCompleteInput input, CancellationToken ct)
    {
        var correlationId = HttpContext.Items["CorrelationId"]?.ToString() ?? Guid.NewGuid().ToString("N");
        var result = await _uploadService.CompleteUploadAsync(input.MediaId, correlationId, ct);
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return Ok(result);
    }

    [HttpGet]
    public async Task<ActionResult<PaginatedResult<MediaItemDto>>> Browse(
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        [FromQuery] MediaType? type = null,
        [FromQuery] DateTimeOffset? from = null,
        [FromQuery] DateTimeOffset? to = null,
        [FromQuery] string? sort = null,
        CancellationToken ct = default)
    {
        var result = await _browseService.BrowseAsync(page, pageSize, type, from, to, sort, ct);
        return Ok(result);
    }

    [HttpGet("{id:guid}/download")]
    public async Task<ActionResult> Download(Guid id, CancellationToken ct)
    {
        var item = await _mediaRepo.GetByIdAsync(id, ct);
        if (item == null) return NotFound();

        var sasUri = await _blobService.GenerateReadSasUriAsync(
            _storageOptions.OriginalsContainer, item.OriginalBlobPath,
            TimeSpan.FromMinutes(15), ct);

        return Ok(new { downloadUrl = sasUri.ToString(), fileName = item.FileName });
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Roles = "owner")]
    public async Task<ActionResult> Delete(Guid id, CancellationToken ct)
    {
        await _mediaService.DeleteMediaWithBlobsAsync(id, ct);
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return NoContent();
    }

    [HttpPost("delete-batch")]
    [Authorize(Roles = "owner")]
    public async Task<ActionResult> DeleteBatch([FromBody] DeleteBatchInput input, CancellationToken ct)
    {
        foreach (var id in input.MediaIds)
            await _mediaService.DeleteMediaWithBlobsAsync(id, ct);
        await _notificationService.BroadcastMediaChangedAsync(ct);
        return NoContent();
    }

    [HttpPost("download-batch")]
    public async Task<ActionResult> DownloadBatch([FromBody] DownloadBatchInput input, CancellationToken ct)
    {
        if (input.MediaIds.Count == 1)
        {
            // Single file — return direct SAS URL
            var item = await _mediaRepo.GetByIdAsync(input.MediaIds[0], ct);
            if (item == null) return NotFound();
            var sasUri = await _blobService.GenerateReadSasUriAsync(
                _storageOptions.OriginalsContainer, item.OriginalBlobPath,
                TimeSpan.FromMinutes(15), ct);
            return Ok(new { downloadUrl = sasUri.ToString(), fileName = item.FileName });
        }

        // Multiple files — create ZIP
        using var zipStream = new MemoryStream();
        using (var archive = new System.IO.Compression.ZipArchive(zipStream, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
        {
            var fileNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var id in input.MediaIds)
            {
                var item = await _mediaRepo.GetByIdAsync(id, ct);
                if (item == null) continue;

                // Ensure unique file names in ZIP
                var fileName = item.FileName;
                var baseName = Path.GetFileNameWithoutExtension(fileName);
                var ext = Path.GetExtension(fileName);
                var counter = 1;
                while (!fileNames.Add(fileName))
                    fileName = $"{baseName}_{counter++}{ext}";

                await using var blobStream = await _blobService.DownloadAsync(
                    _storageOptions.OriginalsContainer, item.OriginalBlobPath, ct);

                var entry = archive.CreateEntry(fileName, System.IO.Compression.CompressionLevel.Fastest);
                await using var entryStream = entry.Open();
                await blobStream.CopyToAsync(entryStream, ct);
            }
        }

        // Upload ZIP to a temp blob
        zipStream.Position = 0;
        var zipBlobPath = $"temp-downloads/{Guid.NewGuid():N}.zip";
        await _blobService.UploadAsync(zipStream, _storageOptions.OriginalsContainer, zipBlobPath, "application/zip", ct);
        var zipSasUri = await _blobService.GenerateReadSasUriAsync(
            _storageOptions.OriginalsContainer, zipBlobPath,
            TimeSpan.FromMinutes(30), ct);

        return Ok(new { downloadUrl = zipSasUri.ToString(), fileName = $"CleanSweep-{DateTime.UtcNow:yyyyMMdd-HHmmss}.zip" });
    }
}

public record UploadRequestInput(string FileName, string ContentType, long SizeBytes);
public record UploadCompleteInput(Guid MediaId);
public record DeleteBatchInput(List<Guid> MediaIds);
public record DownloadBatchInput(List<Guid> MediaIds);
