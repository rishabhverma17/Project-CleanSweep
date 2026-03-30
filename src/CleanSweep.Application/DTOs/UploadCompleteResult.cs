using CleanSweep.Domain.Enums;

namespace CleanSweep.Application.DTOs;

public class UploadCompleteResult
{
    public Guid MediaId { get; set; }
    public ProcessingStatus Status { get; set; }
}
