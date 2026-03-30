namespace CleanSweep.Application.Interfaces;

public interface IThumbnailGenerator
{
    Task<Stream> GenerateAsync(Stream source, string contentType, int maxDimension = 300, CancellationToken ct = default);
    bool CanHandle(string contentType);
}
