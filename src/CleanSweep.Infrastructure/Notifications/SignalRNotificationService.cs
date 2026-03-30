using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Logging;

namespace CleanSweep.Infrastructure.Notifications;

public class SignalRNotificationService : INotificationService
{
    private readonly IHubContext<MediaHub> _hubContext;
    private readonly ILogger<SignalRNotificationService> _logger;

    public SignalRNotificationService(IHubContext<MediaHub> hubContext, ILogger<SignalRNotificationService> logger)
    {
        _hubContext = hubContext;
        _logger = logger;
    }

    public async Task NotifyMediaStatusChangedAsync(string userId, MediaStatusUpdate update, CancellationToken ct)
    {
        _logger.LogInformation("Pushing status update via SignalR: MediaId={MediaId}, Status={Status}, UserId={UserId}",
            update.MediaId, update.Status, userId);
        await _hubContext.Clients.User(userId).SendAsync("MediaStatusChanged", update, ct);
    }

    public async Task BroadcastMediaChangedAsync(CancellationToken ct)
    {
        _logger.LogInformation("Broadcasting MediaChanged to all clients");
        await _hubContext.Clients.All.SendAsync("MediaChanged", ct);
    }
}

/// <summary>
/// Hub class owned by Infrastructure for SignalR context injection.
/// The API project's MediaHub inherits from this or the API maps this directly.
/// </summary>
public class MediaHub : Hub { }
