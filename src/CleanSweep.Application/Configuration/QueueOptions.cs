namespace CleanSweep.Application.Configuration;

public class QueueOptions
{
    public const string SectionName = "Queue";

    public string ConnectionString { get; set; } = null!;
    public string MediaProcessingQueue { get; set; } = "media-processing";
    public string TranscodeQueue { get; set; } = "transcode-jobs";
    public int ProcessingVisibilityTimeoutSeconds { get; set; } = 300;
    public int TranscodeVisibilityTimeoutSeconds { get; set; } = 1800;
    public int MaxDequeueCount { get; set; } = 5;
}
