using Microsoft.AspNetCore.Authorization;

namespace CleanSweep.API.Hubs;

/// <summary>
/// API-level hub that maps to /hubs/media.
/// Inherits from Infrastructure's MediaHub which is used by SignalRNotificationService via IHubContext.
/// Since both are the same type (Infrastructure.Notifications.MediaHub), SignalR routing works.
/// This file exists to apply [Authorize] and keep the API as the hub mapping owner.
/// </summary>
[Authorize]
public class MediaHub : CleanSweep.Infrastructure.Notifications.MediaHub
{
}
