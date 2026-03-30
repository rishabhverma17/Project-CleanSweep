namespace CleanSweep.Application.Interfaces;

public interface IBlobStorageService
{
    Task<Uri> GenerateWriteSasUriAsync(string containerName, string blobPath, string contentType, TimeSpan expiry, CancellationToken ct = default);
    Task<Uri> GenerateReadSasUriAsync(string containerName, string blobPath, TimeSpan expiry, CancellationToken ct = default);
    Task UploadAsync(Stream content, string containerName, string blobPath, string contentType, CancellationToken ct = default);
    Task<Stream> DownloadAsync(string containerName, string blobPath, CancellationToken ct = default);
    Task DeleteAsync(string containerName, string blobPath, CancellationToken ct = default);
    Task<bool> ExistsAsync(string containerName, string blobPath, CancellationToken ct = default);
    Task<long> GetBlobSizeAsync(string containerName, string blobPath, CancellationToken ct = default);
}
