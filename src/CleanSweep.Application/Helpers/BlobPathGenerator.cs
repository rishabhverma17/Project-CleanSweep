namespace CleanSweep.Application.Helpers;

public static class BlobPathGenerator
{
    public static string Generate(Guid id, string extension)
    {
        var hex = id.ToString("N");
        return $"{hex[0..2]}/{hex[2..4]}/{hex[4..6]}/{hex[6..8]}/{hex}{extension}";
    }
}
