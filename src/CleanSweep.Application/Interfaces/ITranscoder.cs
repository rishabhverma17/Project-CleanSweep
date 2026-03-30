using CleanSweep.Application.DTOs;

namespace CleanSweep.Application.Interfaces;

public interface ITranscoder
{
    Task<TranscodeResult> TranscodeAsync(string sourceBlobPath, string targetBlobPath, CancellationToken ct = default);
}
