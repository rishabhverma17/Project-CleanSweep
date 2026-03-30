using CleanSweep.Application.DTOs;

namespace CleanSweep.Application.Interfaces;

public interface INotificationService
{
    Task NotifyMediaStatusChangedAsync(string userId, MediaStatusUpdate update, CancellationToken ct = default);
    Task BroadcastMediaChangedAsync(CancellationToken ct = default);
}
