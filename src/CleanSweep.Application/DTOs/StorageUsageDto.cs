namespace CleanSweep.Application.DTOs;

public class StorageUsageDto
{
    public long UsedBytes { get; set; }
    public long QuotaBytes { get; set; }
    public double UsedPercent => QuotaBytes > 0 ? Math.Round((double)UsedBytes / QuotaBytes * 100, 1) : 0;
    public string UsedFormatted => FormatBytes(UsedBytes);
    public string QuotaFormatted => FormatBytes(QuotaBytes);

    private static string FormatBytes(long bytes)
    {
        if (bytes >= 1L * 1024 * 1024 * 1024) return $"{bytes / (1024.0 * 1024 * 1024):F1} GB";
        if (bytes >= 1L * 1024 * 1024) return $"{bytes / (1024.0 * 1024):F1} MB";
        return $"{bytes / 1024.0:F1} KB";
    }
}
