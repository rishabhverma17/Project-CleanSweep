using CleanSweep.API.Auth;
using CleanSweep.API.BackgroundServices;
using CleanSweep.API.Hubs;
using CleanSweep.API.Middleware;
using CleanSweep.Application;
using CleanSweep.Application.Configuration;
using CleanSweep.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Identity.Web;

var builder = WebApplication.CreateBuilder(args);

// ═══ CONFIGURATION ═══
builder.Services.Configure<StorageOptions>(builder.Configuration.GetSection(StorageOptions.SectionName));
builder.Services.Configure<QueueOptions>(builder.Configuration.GetSection(QueueOptions.SectionName));
builder.Services.Configure<TranscodeOptions>(builder.Configuration.GetSection(TranscodeOptions.SectionName));
builder.Services.Configure<UploadOptions>(builder.Configuration.GetSection(UploadOptions.SectionName));
builder.Services.Configure<QuotaOptions>(builder.Configuration.GetSection(QuotaOptions.SectionName));

// ═══ LOGGING ═══
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
if (!builder.Environment.IsDevelopment())
    builder.Logging.AddAzureWebAppDiagnostics();

builder.Services.AddHttpContextAccessor();

// ═══ APPLICATION + INFRASTRUCTURE ═══
builder.Services.AddApplication();
builder.Services.AddInfrastructure(builder.Configuration);

// ═══ BACKGROUND SERVICES ═══
builder.Services.AddHostedService<ProcessingBackgroundService>();
builder.Services.AddHostedService<TranscodeBackgroundService>();
builder.Services.AddHostedService<CleanupBackgroundService>();

// ═══ AUTH ═══
var azureAdEnabled = builder.Configuration.GetValue<bool>("AzureAd:Enabled");

if (azureAdEnabled)
{
    builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
        .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));
}
else
{
    builder.Services.AddAuthentication(DevAuthHandler.SchemeName)
        .AddScheme<AuthenticationSchemeOptions, DevAuthHandler>(DevAuthHandler.SchemeName, _ => { });
}

builder.Services.AddAuthorization();

// ═══ SIGNALR + CONTROLLERS ═══
builder.Services.AddSignalR();
builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

// ═══ CORS ═══
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.WithOrigins("http://localhost:3000", "https://localhost:3000")
              .AllowAnyHeader()
              .AllowAnyMethod()
              .AllowCredentials();
    });
});

// ═══ BUILD ═══
var app = builder.Build();

// ═══ AUTO-MIGRATE DATABASE ═══
using (var scope = app.Services.CreateScope())
{
    var db = scope.ServiceProvider.GetRequiredService<CleanSweep.Infrastructure.Persistence.AppDbContext>();
    await db.Database.MigrateAsync();
}

app.UseMiddleware<CorrelationIdMiddleware>();
app.UseMiddleware<RequestLoggingMiddleware>();
app.UseMiddleware<ExceptionHandlingMiddleware>();

app.UseCors();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

app.UseAuthentication();
app.UseAuthorization();

app.UseStaticFiles();
app.MapControllers();
app.MapHub<MediaHub>("/hubs/media");
app.MapFallbackToFile("index.html");

app.Run();
