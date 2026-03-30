import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import type { MediaItem } from '../types/media';
import { Calendar, HardDrive, Download, AlertCircle, Loader2 } from 'lucide-react';

interface SharedData {
  type: 'media' | 'unknown';
  expiresAt: string;
  media?: MediaItem;
}

export function SharedPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharedData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
    axios.get(`${baseUrl}/api/share/${encodeURIComponent(token)}`)
      .then(res => setData(res.data))
      .catch(err => setError(err.response?.data?.error || 'This share link is invalid or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleDownload = async (url: string, fileName: string) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(objectUrl);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--content-bg)' }}>
        <Loader2 size={32} className="animate-spin" style={{ color: 'var(--accent)' }} />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--content-bg)' }}>
        <div className="text-center max-w-sm">
          <AlertCircle size={48} className="mx-auto mb-4" style={{ color: '#f87171' }} />
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Link Expired</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{error || 'This share link is no longer valid.'}</p>
        </div>
      </div>
    );
  }

  if (data.type === 'media' && data.media) {
    const m = data.media;
    const isVideo = m.mediaType === 1;
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--content-bg)', color: 'var(--text-primary)' }}>
        <header className="px-6 h-14 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)', background: 'var(--sidebar-bg)' }}>
          <h1 className="text-lg font-medium">CleanSweep</h1>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Shared link · Expires {new Date(data.expiresAt).toLocaleDateString()}</span>
        </header>
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-5xl w-full">
            {isVideo && m.playbackUrl ? (
              <video src={m.playbackUrl} controls className="w-full max-h-[80vh] rounded-lg mx-auto" />
            ) : m.playbackUrl || m.thumbnailUrl ? (
              <img src={m.playbackUrl || m.thumbnailUrl} alt={m.fileName} className="w-full max-h-[80vh] object-contain rounded-lg mx-auto" />
            ) : (
              <div className="flex items-center justify-center h-64" style={{ color: 'var(--text-muted)' }}>Media not available</div>
            )}
            <div className="mt-4 flex items-center justify-between text-sm flex-wrap gap-2" style={{ color: 'var(--text-secondary)' }}>
              <div className="flex items-center gap-3 min-w-0">
                <span className="truncate font-medium">{m.fileName}</span>
                {m.capturedAt && <span className="flex items-center gap-1"><Calendar size={14} /> {new Date(m.capturedAt).toLocaleDateString()}</span>}
                <span className="flex items-center gap-1"><HardDrive size={14} /> {(m.fileSizeBytes / 1024 / 1024).toFixed(1)} MB</span>
              </div>
              {(m.playbackUrl || m.thumbnailUrl) && (
                <button
                  onClick={() => handleDownload((m.playbackUrl || m.thumbnailUrl)!, m.fileName)}
                  className="px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-1.5"
                  style={{ background: 'var(--accent)', color: '#1a1a1a' }}
                >
                  <Download size={16} /> Download
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--content-bg)' }}>
      <div className="text-center">
        <AlertCircle size={48} className="mx-auto mb-4" style={{ color: 'var(--text-muted)' }} />
        <p style={{ color: 'var(--text-muted)' }}>Unsupported share type</p>
      </div>
    </div>
  );
}
