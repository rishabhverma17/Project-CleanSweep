using System.Text.Json;
using Azure.Storage.Queues;
using CleanSweep.Application.Configuration;
using CleanSweep.Application.DTOs;
using CleanSweep.Application.Interfaces;
using Microsoft.Extensions.Options;

namespace CleanSweep.Infrastructure.Queue;

public class AzureMediaProcessingQueue : IMediaProcessingQueue
{
    private readonly QueueClient _queueClient;

    public AzureMediaProcessingQueue(IOptions<QueueOptions> options)
    {
        _queueClient = new QueueClient(options.Value.ConnectionString, options.Value.MediaProcessingQueue, new QueueClientOptions { MessageEncoding = QueueMessageEncoding.Base64 });
        _queueClient.CreateIfNotExists();
    }

    public async Task EnqueueAsync(ProcessingMessage message, CancellationToken ct)
    {
        var json = JsonSerializer.Serialize(message);
        await _queueClient.SendMessageAsync(json, ct);
    }

    public async Task<QueueItem<ProcessingMessage>?> DequeueAsync(TimeSpan visibilityTimeout, CancellationToken ct)
    {
        var response = await _queueClient.ReceiveMessageAsync(visibilityTimeout, ct);
        if (response.Value == null) return null;

        var message = JsonSerializer.Deserialize<ProcessingMessage>(response.Value.MessageText)!;
        return new QueueItem<ProcessingMessage>
        {
            Message = message,
            MessageId = response.Value.MessageId,
            PopReceipt = response.Value.PopReceipt
        };
    }

    public async Task CompleteAsync(string messageId, string popReceipt, CancellationToken ct)
    {
        await _queueClient.DeleteMessageAsync(messageId, popReceipt, ct);
    }
}
