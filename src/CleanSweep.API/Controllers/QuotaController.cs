using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace CleanSweep.API.Controllers;

[ApiController]
[Route("api/[controller]")]
[Authorize]
public class QuotaController : ControllerBase
{
    private readonly IMediaRepository _mediaRepo;
    private readonly IUserRepository _userRepo;
    private readonly ICurrentUserService _currentUser;
    private readonly QuotaOptions _quotaOptions;

    public QuotaController(IMediaRepository mediaRepo, IUserRepository userRepo, ICurrentUserService currentUser, IOptions<QuotaOptions> quotaOptions)
    {
        _mediaRepo = mediaRepo;
        _userRepo = userRepo;
        _currentUser = currentUser;
        _quotaOptions = quotaOptions.Value;
    }

    [HttpGet]
    public async Task<ActionResult<StorageUsageDto>> GetMyUsage(CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        var user = await _userRepo.GetByIdAsync(userId, ct);
        var usedBytes = await _mediaRepo.GetUserStorageUsageAsync(userId, ct);
        var quotaBytes = user?.QuotaBytes ?? _quotaOptions.DefaultUserQuotaBytes;

        return Ok(new StorageUsageDto { UsedBytes = usedBytes, QuotaBytes = quotaBytes });
    }

    [HttpPut("users/{userId}/quota")]
    [Authorize(Roles = "owner")]
    public async Task<ActionResult> SetUserQuota(string userId, [FromBody] SetQuotaInput input, CancellationToken ct)
    {
        var user = await _userRepo.GetByIdAsync(userId, ct);
        if (user == null) return NotFound();
        user.QuotaBytes = input.QuotaBytes;
        await _userRepo.UpsertAsync(user.Id, user.Email, user.DisplayName, ct);
        return Ok(new { userId, quotaBytes = input.QuotaBytes });
    }
}

public record SetQuotaInput(long QuotaBytes);
