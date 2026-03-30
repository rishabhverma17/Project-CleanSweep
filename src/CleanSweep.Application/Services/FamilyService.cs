using System.Security.Cryptography;
using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using CleanSweep.Domain.Entities;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace CleanSweep.Application.Services;

public class FamilyService
{
    private readonly IFamilyRepository _familyRepo;
    private readonly IUserRepository _userRepo;
    private readonly ICurrentUserService _currentUser;
    private readonly QuotaOptions _quotaOptions;
    private readonly ILogger<FamilyService> _logger;

    public FamilyService(
        IFamilyRepository familyRepo,
        IUserRepository userRepo,
        ICurrentUserService currentUser,
        IOptions<QuotaOptions> quotaOptions,
        ILogger<FamilyService> logger)
    {
        _familyRepo = familyRepo;
        _userRepo = userRepo;
        _currentUser = currentUser;
        _quotaOptions = quotaOptions.Value;
        _logger = logger;
    }

    public async Task<FamilyDto> CreateAsync(string name, CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        await _userRepo.UpsertAsync(userId, _currentUser.Email ?? "", _currentUser.DisplayName ?? "", ct);

        var family = new Family
        {
            Id = Guid.NewGuid(),
            Name = name,
            CreatedByUserId = userId,
            InviteCode = GenerateInviteCode(),
            InviteExpiresAt = DateTimeOffset.UtcNow.AddDays(30),
            QuotaBytes = _quotaOptions.DefaultFamilyQuotaBytes,
            CreatedAt = DateTimeOffset.UtcNow
        };

        await _familyRepo.AddAsync(family, ct);
        await _familyRepo.AddMemberAsync(new FamilyMember
        {
            FamilyId = family.Id,
            UserId = userId,
            Role = "admin",
            JoinedAt = DateTimeOffset.UtcNow
        }, ct);

        _logger.LogInformation("Family created: {FamilyId} '{Name}' by {UserId}", family.Id, name, userId);

        return new FamilyDto
        {
            Id = family.Id, Name = family.Name, InviteCode = family.InviteCode,
            MemberCount = 1, MediaCount = 0, StorageUsedBytes = 0,
            QuotaBytes = family.QuotaBytes, Role = "admin", CreatedAt = family.CreatedAt
        };
    }

    public async Task<List<FamilyDto>> GetMyFamiliesAsync(CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        var families = await _familyRepo.GetByUserIdAsync(userId, ct);

        var dtos = new List<FamilyDto>();
        foreach (var f in families)
        {
            var member = f.Members.FirstOrDefault(m => m.UserId == userId);
            dtos.Add(new FamilyDto
            {
                Id = f.Id, Name = f.Name, InviteCode = member?.Role == "admin" ? f.InviteCode : null,
                MemberCount = f.Members.Count,
                MediaCount = await _familyRepo.GetFamilyMediaCountAsync(f.Id, ct),
                StorageUsedBytes = await _familyRepo.GetFamilyStorageUsageAsync(f.Id, ct),
                QuotaBytes = f.QuotaBytes,
                Role = member?.Role ?? "member",
                CreatedAt = f.CreatedAt
            });
        }
        return dtos;
    }

    public async Task<string> JoinByInviteCodeAsync(string code, CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        await _userRepo.UpsertAsync(userId, _currentUser.Email ?? "", _currentUser.DisplayName ?? "", ct);

        var family = await _familyRepo.GetByInviteCodeAsync(code, ct)
            ?? throw new KeyNotFoundException("Invalid invite code.");

        if (family.InviteExpiresAt.HasValue && family.InviteExpiresAt < DateTimeOffset.UtcNow)
            throw new InvalidOperationException("Invite code has expired.");

        if (await _familyRepo.IsMemberAsync(family.Id, userId, ct))
            throw new InvalidOperationException("Already a member of this family.");

        await _familyRepo.AddMemberAsync(new FamilyMember
        {
            FamilyId = family.Id,
            UserId = userId,
            Role = "member",
            JoinedAt = DateTimeOffset.UtcNow
        }, ct);

        _logger.LogInformation("User {UserId} joined family {FamilyId} via invite code", userId, family.Id);
        return family.Name;
    }

    public async Task ShareMediaToFamilyAsync(Guid familyId, List<Guid> mediaIds, CancellationToken ct)
    {
        var userId = _currentUser.UserId ?? throw new UnauthorizedAccessException();
        if (!await _familyRepo.IsMemberAsync(familyId, userId, ct))
            throw new UnauthorizedAccessException("Not a member of this family.");

        foreach (var mediaId in mediaIds)
        {
            try
            {
                await _familyRepo.AddMediaAsync(new FamilyMedia
                {
                    FamilyId = familyId,
                    MediaId = mediaId,
                    SharedByUserId = userId,
                    SharedAt = DateTimeOffset.UtcNow
                }, ct);
            }
            catch { /* Ignore duplicates */ }
        }
    }

    public async Task UnshareMediaFromFamilyAsync(Guid familyId, Guid mediaId, CancellationToken ct)
    {
        await _familyRepo.RemoveMediaAsync(familyId, mediaId, ct);
    }

    public async Task RemoveMemberAsync(Guid familyId, string userId, CancellationToken ct)
    {
        await _familyRepo.RemoveMemberAsync(familyId, userId, ct);
    }

    public async Task DeleteFamilyAsync(Guid familyId, CancellationToken ct)
    {
        await _familyRepo.DeleteAsync(familyId, ct);
    }

    public async Task<string> RegenerateInviteCodeAsync(Guid familyId, int expiryDays, CancellationToken ct)
    {
        var family = await _familyRepo.GetByIdAsync(familyId, ct) ?? throw new KeyNotFoundException();
        family.InviteCode = GenerateInviteCode();
        family.InviteExpiresAt = DateTimeOffset.UtcNow.AddDays(expiryDays);
        await _familyRepo.UpdateAsync(family, ct);
        return family.InviteCode;
    }

    private static string GenerateInviteCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(6);
        return Convert.ToBase64String(bytes).Replace("+", "").Replace("/", "").Replace("=", "")[..8].ToUpper();
    }
}
