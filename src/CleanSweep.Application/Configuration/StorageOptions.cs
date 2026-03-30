namespace CleanSweep.Application.Configuration;

public class StorageOptions
{
    public const string SectionName = "Storage";

    public string ConnectionString { get; set; } = null!;
    public string OriginalsContainer { get; set; } = "originals";
    public string PlaybackContainer { get; set; } = "playback";
    public string ThumbnailsContainer { get; set; } = "thumbnails";
    public int ReadSasExpiryMinutes { get; set; } = 15;
    public int WriteSasExpiryMinutes { get; set; } = 30;
}
