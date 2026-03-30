using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using CleanSweep.Application.Configuration;
using CleanSweep.Application.Interfaces;
using Microsoft.Extensions.Options;

namespace CleanSweep.Infrastructure.Storage;

public class AzureBlobStorageService : IBlobStorageService
{
    private readonly BlobServiceClient _serviceClient;

    public AzureBlobStorageService(IOptions<StorageOptions> options)
    {
        _serviceClient = new BlobServiceClient(options.Value.ConnectionString);
    }

    public Task<Uri> GenerateWriteSasUriAsync(string containerName, string blobPath, string contentType, TimeSpan expiry, CancellationToken ct)
    {
        var blob = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
        var builder = new BlobSasBuilder
        {
            BlobContainerName = containerName,
            BlobName = blobPath,
            Resource = "b",
            ExpiresOn = DateTimeOffset.UtcNow.Add(expiry),
            ContentType = contentType
        };
        builder.SetPermissions(BlobSasPermissions.Write | BlobSasPermissions.Create);
        var sasUri = blob.GenerateSasUri(builder);
        return Task.FromResult(sasUri);
    }

    public Task<Uri> GenerateReadSasUriAsync(string containerName, string blobPath, TimeSpan expiry, CancellationToken ct)
    {
        var blob = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
        var sasUri = blob.GenerateSasUri(BlobSasPermissions.Read, DateTimeOffset.UtcNow.Add(expiry));
        return Task.FromResult(sasUri);
    }

    public async Task UploadAsync(Stream content, string containerName, string blobPath, string contentType, CancellationToken ct)
    {
        var blob = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
        await blob.UploadAsync(content, new BlobHttpHeaders { ContentType = contentType }, cancellationToken: ct);
    }

    public async Task<Stream> DownloadAsync(string containerName, string blobPath, CancellationToken ct)
    {
        var blob = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
        var response = await blob.DownloadStreamingAsync(cancellationToken: ct);
        return response.Value.Content;
    }

    public async Task DeleteAsync(string containerName, string blobPath, CancellationToken ct)
    {
        var blob = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
        await blob.DeleteIfExistsAsync(cancellationToken: ct);
    }

    public async Task<bool> ExistsAsync(string containerName, string blobPath, CancellationToken ct)
    {
        var blob = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
        return await blob.ExistsAsync(ct);
    }

    public async Task<long> GetBlobSizeAsync(string containerName, string blobPath, CancellationToken ct)
    {
        var blob = _serviceClient.GetBlobContainerClient(containerName).GetBlobClient(blobPath);
        var props = await blob.GetPropertiesAsync(cancellationToken: ct);
        return props.Value.ContentLength;
    }
}
