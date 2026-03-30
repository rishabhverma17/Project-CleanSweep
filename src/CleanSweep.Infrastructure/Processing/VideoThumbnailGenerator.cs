using System.Diagnostics;
using CleanSweep.Application.Interfaces;
using Microsoft.Extensions.Logging;

namespace CleanSweep.Infrastructure.Processing;

public class VideoThumbnailGenerator : IThumbnailGenerator
{
    private readonly ILogger<VideoThumbnailGenerator> _logger;

    private static readonly HashSet<string> SupportedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "video/mp4", "video/quicktime", "video/x-m4v"
    };

    public VideoThumbnailGenerator(ILogger<VideoThumbnailGenerator> logger) => _logger = logger;

    public bool CanHandle(string contentType) => SupportedTypes.Contains(contentType);

    public async Task<Stream> GenerateAsync(Stream source, string contentType, int maxDimension, CancellationToken ct)
    {
        var tempInput = Path.GetTempFileName();
        var tempOutput = Path.ChangeExtension(Path.GetTempFileName(), ".jpg");

        try
        {
            await using (var fs = File.Create(tempInput))
                await source.CopyToAsync(fs, ct);

            var args = $"-i \"{tempInput}\" -ss 00:00:02 -frames:v 1 -vf scale={maxDimension}:-1 -f image2 \"{tempOutput}\"";
            var process = Process.Start(new ProcessStartInfo("ffmpeg", args) { RedirectStandardError = true, UseShellExecute = false, CreateNoWindow = true });

            if (process == null) throw new InvalidOperationException("Failed to start FFmpeg process.");

            await process.WaitForExitAsync(ct);
            if (process.ExitCode != 0)
            {
                var err = await process.StandardError.ReadToEndAsync(ct);
                _logger.LogWarning("FFmpeg exited with code {ExitCode}: {Error}", process.ExitCode, err);
            }

            var output = new MemoryStream();
            await using (var fs = File.OpenRead(tempOutput))
                await fs.CopyToAsync(output, ct);
            output.Position = 0;
            return output;
        }
        finally
        {
            File.Delete(tempInput);
            File.Delete(tempOutput);
        }
    }
}
