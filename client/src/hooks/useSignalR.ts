import { useEffect, useRef } from 'react';
import { HubConnectionBuilder, HubConnectionState } from '@microsoft/signalr';
import { useQueryClient } from '@tanstack/react-query';

export function useSignalR() {
  const queryClient = useQueryClient();
  const connectionRef = useRef<ReturnType<typeof HubConnectionBuilder.prototype.build> | null>(null);

  useEffect(() => {
    const connection = new HubConnectionBuilder()
      .withUrl(`${import.meta.env.VITE_API_BASE_URL}/hubs/media`)
      .withAutomaticReconnect([0, 2000, 5000, 10000, 30000])
      .build();

    connection.on('MediaStatusChanged', (_update: { mediaId: string; status: string; thumbnailUrl?: string; playbackUrl?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['album'] });
      queryClient.invalidateQueries({ queryKey: ['quota'] });
    });

    // Broadcast event: another user changed media (upload, delete, share, unshare)
    connection.on('MediaChanged', () => {
      queryClient.invalidateQueries({ queryKey: ['media'] });
      queryClient.invalidateQueries({ queryKey: ['albums'] });
      queryClient.invalidateQueries({ queryKey: ['album'] });
      queryClient.invalidateQueries({ queryKey: ['families'] });
      queryClient.invalidateQueries({ queryKey: ['family-media'] });
      queryClient.invalidateQueries({ queryKey: ['quota'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    });

    connection.start().catch(err => console.warn('SignalR connection failed:', err));
    connectionRef.current = connection;

    return () => {
      if (connectionRef.current?.state === HubConnectionState.Connected) {
        connectionRef.current.stop();
      }
    };
  }, [queryClient]);
}
