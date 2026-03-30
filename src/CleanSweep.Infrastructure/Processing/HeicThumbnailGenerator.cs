using CleanSweep.Application.Interfaces;
using ImageMagick;

namespace CleanSweep.Infrastructure.Processing;

public class HeicThumbnailGenerator : IThumbnailGenerator
{
    private static readonly HashSet<string> SupportedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/heic", "image/heif"
    };

    public bool CanHandle(string contentType) => SupportedTypes.Contains(contentType);

    public Task<Stream> GenerateAsync(Stream source, string contentType, int maxDimension, CancellationToken ct)
    {
        using var image = new MagickImage(source);
        image.Resize(new MagickGeometry((uint)maxDimension, (uint)maxDimension) { IgnoreAspectRatio = false });
        image.Format = MagickFormat.Jpeg;

        var output = new MemoryStream();
        image.Write(output);
        output.Position = 0;
        return Task.FromResult<Stream>(output);
    }
}
