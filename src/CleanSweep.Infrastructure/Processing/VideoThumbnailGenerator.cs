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

            // Try at 2s first, fall back to 1s, then first frame (0s) for short videos
            var seekTimes = new[] { "00:00:02", "00:00:01", "00:00:00" };
            var success = false;

            foreach (var seekTime in seekTimes)
            {
                // Delete previous attempt output if any
                if (File.Exists(tempOutput)) File.Delete(tempOutput);

                var args = $"-y -i \"{tempInput}\" -ss {seekTime} -frames:v 1 -vf scale={maxDimension}:-1 -f image2 \"{tempOutput}\"";
                var process = Process.Start(new ProcessStartInfo("ffmpeg", args)
                {
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                });

                if (process == null) throw new InvalidOperationException("Failed to start FFmpeg process.");

                await process.WaitForExitAsync(ct);

                if (process.ExitCode == 0 && File.Exists(tempOutput) && new FileInfo(tempOutput).Length > 0)
                {
                    success = true;
                    break;
                }

                var err = await process.StandardError.ReadToEndAsync(ct);
                _logger.LogWarning("FFmpeg thumbnail at {SeekTime} failed (exit={ExitCode}): {Error}", seekTime, process.ExitCode, err);
            }

            if (!success)
            {
                throw new InvalidOperationException($"FFmpeg failed to generate thumbnail for video after all seek attempts.");
            }

            var output = new MemoryStream();
            await using (var fs = File.OpenRead(tempOutput))
                await fs.CopyToAsync(output, ct);
            output.Position = 0;
            return output;
        }
        finally
        {
            if (File.Exists(tempInput)) File.Delete(tempInput);
            if (File.Exists(tempOutput)) File.Delete(tempOutput);
        }
    }
}
