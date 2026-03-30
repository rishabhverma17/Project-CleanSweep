using CleanSweep.Application.DTOs;

namespace CleanSweep.Application.Interfaces;

public interface IMetadataExtractor
{
    Task<MediaMetadata> ExtractAsync(Stream fileStream, string fileName, CancellationToken ct = default);
}
