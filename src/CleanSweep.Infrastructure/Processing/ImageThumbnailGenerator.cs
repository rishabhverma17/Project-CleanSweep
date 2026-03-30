using CleanSweep.Application.Interfaces;
using SixLabors.ImageSharp;
using SixLabors.ImageSharp.Processing;

namespace CleanSweep.Infrastructure.Processing;

public class ImageThumbnailGenerator : IThumbnailGenerator
{
    private static readonly HashSet<string> SupportedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff"
    };

    public bool CanHandle(string contentType) => SupportedTypes.Contains(contentType);

    public async Task<Stream> GenerateAsync(Stream source, string contentType, int maxDimension, CancellationToken ct)
    {
        using var image = await Image.LoadAsync(source, ct);
        image.Mutate(x => x.Resize(new ResizeOptions
        {
            Size = new Size(maxDimension, maxDimension),
            Mode = ResizeMode.Max
        }));

        var output = new MemoryStream();
        await image.SaveAsJpegAsync(output, ct);
        output.Position = 0;
        return output;
    }
}
