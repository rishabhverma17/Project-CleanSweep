namespace CleanSweep.Application.Configuration;

public class QuotaOptions
{
    public const string SectionName = "Quota";

    public long DefaultUserQuotaBytes { get; set; } = 500L * 1024 * 1024 * 1024;  // 500 GB
    public long DefaultFamilyQuotaBytes { get; set; } = 500L * 1024 * 1024 * 1024; // 500 GB
}
