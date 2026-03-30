using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CleanSweep.Infrastructure.Processing;

public class AciTranscoder : ITranscoder
{
    private readonly TranscodeOptions _options;
    private readonly ILogger<AciTranscoder> _logger;

    public AciTranscoder(IOptions<TranscodeOptions> options, ILogger<AciTranscoder> logger)
    {
        _options = options.Value;
        _logger = logger;
    }

    public async Task<TranscodeResult> TranscodeAsync(string sourceBlobPath, string targetBlobPath, CancellationToken ct)
    {
        // TODO: Implement ACI creation via Azure.ResourceManager.ContainerInstance SDK
        // 1. Generate SAS URLs for source (read) and target (write)
        // 2. Create container group with FFmpeg image
        // 3. Poll until terminated
        // 4. Return result

        _logger.LogInformation("ACI transcode requested: {Source} → {Target}. CRF={Crf}, Preset={Preset}",
            sourceBlobPath, targetBlobPath, _options.Crf, _options.Preset);

        await Task.Delay(1000, ct); // Placeholder

        return new TranscodeResult { Success = false, ErrorMessage = "ACI transcode not yet implemented." };
    }
}
