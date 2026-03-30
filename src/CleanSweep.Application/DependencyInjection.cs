using CleanSweep.Application.Services;
using Microsoft.Extensions.DependencyInjection;

namespace CleanSweep.Application;

public static class DependencyInjection
{
    public static IServiceCollection AddApplication(this IServiceCollection services)
    {
        services.AddScoped<UploadService>();
        services.AddScoped<MediaService>();
        services.AddScoped<BrowseService>();
        services.AddScoped<AlbumService>();
        services.AddScoped<ShareService>();
        services.AddScoped<FamilyService>();
        return services;
    }
}
