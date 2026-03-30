using System.Security.Claims;
using CleanSweep.Application.Interfaces;
using Microsoft.AspNetCore.Http;

namespace CleanSweep.Infrastructure.Identity;

public class CurrentUserService : ICurrentUserService
{
    private readonly IHttpContextAccessor _httpContextAccessor;

    public CurrentUserService(IHttpContextAccessor httpContextAccessor) => _httpContextAccessor = httpContextAccessor;

    private ClaimsPrincipal? User => _httpContextAccessor.HttpContext?.User;

    public string? UserId => User?.FindFirstValue("http://schemas.microsoft.com/identity/claims/objectidentifier")
                          ?? User?.FindFirstValue(ClaimTypes.NameIdentifier);

    public string? Email => User?.FindFirstValue("preferred_username")
                         ?? User?.FindFirstValue(ClaimTypes.Email);

    public string? DisplayName => User?.FindFirstValue("name")
                               ?? User?.FindFirstValue(ClaimTypes.Name);

    public bool IsAuthenticated => User?.Identity?.IsAuthenticated ?? false;

    public bool IsOwner => User?.IsInRole("owner") ?? false;
}
