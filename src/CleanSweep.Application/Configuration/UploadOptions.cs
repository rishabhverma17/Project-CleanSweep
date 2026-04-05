namespace CleanSweep.Application.Configuration;

public class UploadOptions
{
    public const string SectionName = "Upload";

    public long MaxFileSizeBytes { get; set; } = 5L * 1024 * 1024 * 1024;
    public string[] AllowedExtensions { get; set; } = [".jpg", ".jpeg", ".png", ".heic", ".heif", ".mp4", ".mov", ".m4v", ".flv"];
    public string[] AllowedContentTypes { get; set; } = ["image/jpeg", "image/png", "image/heic", "image/heif", "video/mp4", "video/quicktime", "video/x-m4v", "video/x-flv"];
}
