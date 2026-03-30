using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using MetadataExtractor;
using MetadataExtractor.Formats.Exif;
using MetadataExtractor.Formats.QuickTime;

namespace CleanSweep.Infrastructure.Processing;

public class ExifMetadataExtractor : IMetadataExtractor
{
    public Task<MediaMetadata> ExtractAsync(Stream fileStream, string fileName, CancellationToken ct)
    {
        var directories = ImageMetadataReader.ReadMetadata(fileStream);

        DateTimeOffset? dateTaken = null;
        var subIfd = directories.OfType<ExifSubIfdDirectory>().FirstOrDefault();
        if (subIfd != null && subIfd.TryGetDateTime(ExifDirectoryBase.TagDateTimeOriginal, out var dt))
            dateTaken = new DateTimeOffset(dt, TimeSpan.Zero);

        int? width = null, height = null;
        var ifd0 = directories.OfType<ExifIfd0Directory>().FirstOrDefault();
        if (ifd0 != null)
        {
            if (ifd0.TryGetInt32(ExifDirectoryBase.TagImageWidth, out var w)) width = w;
            if (ifd0.TryGetInt32(ExifDirectoryBase.TagImageHeight, out var h)) height = h;
        }

        double? duration = null;
        var qtDir = directories.OfType<QuickTimeMovieHeaderDirectory>().FirstOrDefault();
        if (qtDir != null && qtDir.TryGetInt64(QuickTimeMovieHeaderDirectory.TagDuration, out var dur) && qtDir.TryGetInt64(QuickTimeMovieHeaderDirectory.TagTimeScale, out var scale) && scale > 0)
            duration = (double)dur / scale;

        string? codec = null;
        var qtTrack = directories.OfType<QuickTimeTrackHeaderDirectory>().FirstOrDefault();
        // Codec detection is best-effort; full detection may require deeper parsing

        return Task.FromResult(new MediaMetadata
        {
            DateTaken = dateTaken,
            Width = width,
            Height = height,
            DurationSeconds = duration,
            Codec = codec
        });
    }
}
