using System.Diagnostics;

namespace CleanSweep.API.Middleware;

public class RequestLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<RequestLoggingMiddleware> _logger;

    public RequestLoggingMiddleware(RequestDelegate next, ILogger<RequestLoggingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    private static readonly HashSet<string> _skipPrefixes = new(StringComparer.OrdinalIgnoreCase)
    {
        "/hub", "/_blazor", "/favicon.ico"
    };

    public async Task InvokeAsync(HttpContext context)
    {
        var path = context.Request.Path;

        // Skip noisy paths entirely (SignalR, static assets)
        if (_skipPrefixes.Any(p => path.StartsWithSegments(p)))
        {
            await _next(context);
            return;
        }

        var sw = Stopwatch.StartNew();
        var method = context.Request.Method;

        try
        {
            await _next(context);
        }
        finally
        {
            sw.Stop();
            var statusCode = context.Response.StatusCode;
            var elapsed = sw.ElapsedMilliseconds;

            // Only log failed requests (4xx/5xx) or slow requests (>500ms)
            if (statusCode >= 400)
            {
                _logger.LogWarning("{Method} {Path} {StatusCode} {ElapsedMs}ms",
                    method, path, statusCode, elapsed);
            }
            else if (elapsed > 500)
            {
                _logger.LogInformation("SLOW {Method} {Path} {StatusCode} {ElapsedMs}ms",
                    method, path, statusCode, elapsed);
            }
        }
    }
}
