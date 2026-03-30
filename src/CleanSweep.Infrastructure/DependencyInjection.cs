using CleanSweep.Application.Configuration;
using CleanSweep.Application.Interfaces;
using CleanSweep.Infrastructure.Identity;
using CleanSweep.Infrastructure.Notifications;
using CleanSweep.Infrastructure.Persistence;
using CleanSweep.Infrastructure.Persistence.Repositories;
using CleanSweep.Infrastructure.Processing;
using CleanSweep.Infrastructure.Queue;
using CleanSweep.Infrastructure.Storage;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace CleanSweep.Infrastructure;

public static class DependencyInjection
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, IConfiguration config)
    {
        // ═══ DATABASE (Azure Postgres — password auth via dbadmin) ═══
        services.AddDbContext<AppDbContext>(opt =>
            opt.UseNpgsql(config.GetConnectionString("Postgres"))
               .UseSnakeCaseNamingConvention());

        services.AddScoped<IMediaRepository, MediaRepository>();
        services.AddScoped<IAlbumRepository, AlbumRepository>();
        services.AddScoped<IShareLinkRepository, ShareLinkRepository>();
        services.AddScoped<IUserRepository, UserRepository>();
        services.AddScoped<IFamilyRepository, FamilyRepository>();

        // ═══ BLOB STORAGE ═══
        services.AddSingleton<IBlobStorageService, AzureBlobStorageService>();

        // ═══ QUEUES ═══
        services.AddSingleton<IMediaProcessingQueue, AzureMediaProcessingQueue>();
        services.AddSingleton<ITranscodeQueue, AzureTranscodeQueue>();

        // ═══ TRANSCODER ═══
        services.AddScoped<ITranscoder, AciTranscoder>();

        // ═══ NOTIFICATIONS ═══
        services.AddScoped<INotificationService, SignalRNotificationService>();

        // ═══ PROCESSORS ═══
        services.AddScoped<IMetadataExtractor, ExifMetadataExtractor>();
        services.AddScoped<IThumbnailGenerator, ImageThumbnailGenerator>();
        services.AddScoped<IThumbnailGenerator, HeicThumbnailGenerator>();
        services.AddScoped<IThumbnailGenerator, VideoThumbnailGenerator>();

        // ═══ CURRENT USER ═══
        services.AddScoped<ICurrentUserService, CurrentUserService>();

        return services;
    }
}
