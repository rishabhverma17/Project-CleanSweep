namespace CleanSweep.Application.Configuration;

public class TranscodeOptions
{
    public const string SectionName = "Transcode";

    public string ResourceGroup { get; set; } = null!;
    public string Location { get; set; } = "centralindia";
    public string FfmpegImage { get; set; } = "jrottenberg/ffmpeg:latest";
    public int CpuCores { get; set; } = 1;
    public double MemoryGb { get; set; } = 1.5;
    public int Crf { get; set; } = 23;
    public string Preset { get; set; } = "medium";
}
