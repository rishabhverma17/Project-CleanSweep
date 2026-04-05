import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, quotaApi } from '../api/familyApi';
import { useTrackedTask } from '../hooks/useTrackedTask';
import { RefreshCw, AlertTriangle } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes > 0) return `${(bytes / 1024).toFixed(0)} KB`;
  return '0 KB';
}

export function AdminPage() {
  const queryClient = useQueryClient();
  const { runTask } = useTrackedTask();
  const { data: users, isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: adminApi.getUsers });
  const [editingQuota, setEditingQuota] = useState<{ userId: string; displayName: string; current: number } | null>(null);
  const [quotaInput, setQuotaInput] = useState('');

  const handleReset = async () => {
    if (!confirm('DELETE ALL DATA including blobs? This cannot be undone.')) return;
    await runTask('Resetting all data', async () => {
      await adminApi.resetAll();
      queryClient.invalidateQueries();
    });
  };

  const handleReprocess = async () => {
    await runTask('Reprocessing all media', async () => {
      const result = await adminApi.reprocess();
      alert(result.message);
    });
  };

  const handleReprocessStuck = async () => {
    await runTask('Reprocessing stuck media', async () => {
      const result = await adminApi.reprocessStuck();
      alert(result.message);
    });
  };

  const handleFixStuck = async () => {
    await runTask('Fixing stuck statuses', async () => {
      const result = await adminApi.fixStuckStatus();
      alert(result.message);
    });
  };

  const handleResetProcessing = async () => {
    await runTask('Resetting stuck processing items', async () => {
      const result = await adminApi.resetProcessing();
      alert(result.message);
    });
  };

  const handlePurgeFailed = async () => {
    if (!confirm('This will remove all failed items (orphan records). Continue?')) return;
    await runTask('Purging failed items', async () => {
      const result = await adminApi.purgeFailed();
      alert(result.message);
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    });
  };

  const handleTriggerCleanup = async () => {
    await runTask('Triggering blob cleanup', async () => {
      const result = await adminApi.triggerCleanup();
      alert(result.message);
    });
  };

  const handleSaveQuota = async () => {
    if (!editingQuota) return;
    const gb = parseFloat(quotaInput);
    if (isNaN(gb) || gb <= 0) { alert('Enter a valid number in GB'); return; }
    await runTask(`Setting quota for ${editingQuota.displayName}`, async () => {
      await quotaApi.setUserQuota(editingQuota.userId, Math.round(gb * 1024 * 1024 * 1024));
    });
    setEditingQuota(null);
    queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    queryClient.invalidateQueries({ queryKey: ['quota'] });
  };

  const totalUsed = users?.reduce((sum: number, u: any) => sum + (u.usedBytes || 0), 0) ?? 0;
  const totalMedia = users?.reduce((sum: number, u: any) => sum + (u.mediaCount || 0), 0) ?? 0;

  // Live processing stats — auto-refresh every 5 seconds
  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: adminApi.getStats,
    refetchInterval: 5000,
  });

  const isProcessing = stats && (stats.queueDepth > 0 || stats.processing > 0);

  if (isLoading) return <div className="py-20 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <div className="max-w-5xl">
      <h2 className="text-2xl font-bold mb-6" style={{ color: 'var(--text-primary)' }}>Admin</h2>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="rounded-xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Total Users</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{users?.length ?? 0}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Total Media</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{totalMedia}</p>
        </div>
        <div className="rounded-xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
          <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Total Storage</p>
          <p className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{formatBytes(totalUsed)}</p>
        </div>
      </div>

      {/* Live Processing Stats */}
      {stats && (
        <div className="rounded-xl p-5 mb-6" style={{ background: 'var(--card-bg)', border: `1px solid ${isProcessing ? 'var(--accent)' : 'var(--border)'}` }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
              Processing Status
              {isProcessing && <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-500" /></span>}
            </h3>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Auto-refreshing every 5s</span>
          </div>
          {/* Progress bar */}
          {stats.total > 0 && (
            <div className="mb-3">
              <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                <span>{stats.complete} / {stats.total} complete</span>
                <span>{Math.round((stats.complete / stats.total) * 100)}%</span>
              </div>
              <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${(stats.complete / stats.total) * 100}%`, background: 'var(--accent)' }} />
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Queue Depth</p>
              <p className="text-lg font-bold" style={{ color: stats.queueDepth > 0 ? 'var(--accent)' : 'var(--text-primary)' }}>{stats.queueDepth.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Processing Now</p>
              <p className="text-lg font-bold" style={{ color: stats.processing > 0 ? '#fbbf24' : 'var(--text-primary)' }}>{stats.processing}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No Thumbnail</p>
              <p className="text-lg font-bold" style={{ color: stats.noThumbnail > 0 ? '#f87171' : '#4ade80' }}>{stats.noThumbnail.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Failed</p>
              <p className="text-lg font-bold" style={{ color: stats.failed > 0 ? '#f87171' : 'var(--text-primary)' }}>{stats.failed}</p>
            </div>
          </div>
          {stats.softDeleted > 0 && (
            <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>{stats.softDeleted} items pending blob cleanup</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 mb-8 flex-wrap">
        <button onClick={handleReprocess} className="px-4 py-2 rounded-lg text-sm transition flex items-center gap-1.5" style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          <RefreshCw size={14} /> Reprocess All Media
        </button>
        <button onClick={handleReprocessStuck} className="px-4 py-2 rounded-lg text-sm transition flex items-center gap-1.5" style={{ background: 'var(--card-bg)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
          <RefreshCw size={14} /> Reprocess Stuck (no thumbnail)
        </button>
        <button onClick={handleFixStuck} className="px-4 py-2 rounded-lg text-sm transition flex items-center gap-1.5" style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          Fix Stuck Statuses
        </button>
        {stats && stats.processing > 10 && (
          <button onClick={handleResetProcessing} className="px-4 py-2 rounded-lg text-sm transition flex items-center gap-1.5" style={{ background: 'var(--card-bg)', color: '#f87171', border: '1px solid var(--border)' }}>
            Reset {stats.processing} Stuck Processing
          </button>
        )}
        {stats && stats.failed > 0 && (
          <button onClick={handlePurgeFailed} className="px-4 py-2 rounded-lg text-sm transition flex items-center gap-1.5" style={{ background: 'var(--card-bg)', color: '#f87171', border: '1px solid var(--border)' }}>
            Purge {stats.failed} Failed
          </button>
        )}
        <button onClick={handleTriggerCleanup} className="px-4 py-2 rounded-lg text-sm transition flex items-center gap-1.5" style={{ background: 'var(--card-bg)', color: '#fbbf24', border: '1px solid var(--border)' }}>
          Cleanup Blobs {stats?.softDeleted ? `(${stats.softDeleted})` : ''}
        </button>
        <button onClick={handleReset} className="px-4 py-2 bg-red-800 hover:bg-red-700 rounded-lg text-sm text-white transition flex items-center gap-1.5">
          <AlertTriangle size={14} /> Reset All Data
        </button>
      </div>

      {/* Users */}
      <h3 className="text-lg font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Users & Quotas</h3>
      <div className="space-y-3">
        {users?.map((user: any) => {
          const usedPercent = user.quotaBytes > 0 ? (user.usedBytes / user.quotaBytes) * 100 : 0;
          return (
            <div key={user.id} className="rounded-xl p-4" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{user.displayName}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user.email}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{user.mediaCount} files</span>
                  <button
                    onClick={() => { setEditingQuota({ userId: user.id, displayName: user.displayName, current: user.quotaBytes / (1024 * 1024 * 1024) }); setQuotaInput(String(Math.round(user.quotaBytes / (1024 * 1024 * 1024)))); }}
                    className="text-xs px-3 py-1.5 rounded-lg transition"
                    style={{ background: 'var(--content-bg)', color: 'var(--accent)', border: '1px solid var(--border)' }}
                  >
                    Edit Quota
                  </button>
                </div>
              </div>
              <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                <span>{formatBytes(user.usedBytes)} used</span>
                <span>{formatBytes(user.quotaBytes)} quota</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, usedPercent)}%`, background: usedPercent > 90 ? '#f87171' : usedPercent > 70 ? '#fbbf24' : 'var(--accent)' }} />
              </div>
              <div className="flex gap-4 mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                <span>First seen: {new Date(user.firstSeenAt).toLocaleDateString()}</span>
                <span>Last seen: {new Date(user.lastSeenAt).toLocaleDateString()}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Edit Quota Modal */}
      {editingQuota && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setEditingQuota(null)}>
          <div className="rounded-xl p-6 w-full max-w-sm" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Edit Quota</h3>
            <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{editingQuota.displayName}</p>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="number"
                value={quotaInput}
                onChange={e => setQuotaInput(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg text-white focus:outline-none focus:ring-2"
                style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}
                autoFocus
              />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>GB</span>
            </div>
            <div className="flex gap-2 mb-4">
              {[10, 50, 100, 200, 500].map(gb => (
                <button key={gb} onClick={() => setQuotaInput(String(gb))} className="text-xs px-2 py-1 rounded transition" style={{ background: quotaInput === String(gb) ? 'var(--accent)' : 'var(--content-bg)', color: quotaInput === String(gb) ? '#1a1a1a' : 'var(--text-muted)' }}>
                  {gb} GB
                </button>
              ))}
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setEditingQuota(null)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
              <button onClick={handleSaveQuota} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
