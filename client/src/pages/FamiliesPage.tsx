import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { familyApi, type FamilyDto } from '../api/familyApi';
import { Link2, Users, Check, Copy, LinkIcon, Image } from 'lucide-react';

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export function FamiliesPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data: families, isLoading } = useQuery({ queryKey: ['families'], queryFn: familyApi.getMyFamilies });
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const handleCreate = async () => {
    if (!name.trim()) return;
    await familyApi.create(name.trim());
    setName('');
    setShowCreate(false);
    queryClient.invalidateQueries({ queryKey: ['families'] });
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    try {
      const result = await familyApi.join(inviteCode.trim());
      alert(`Joined family: ${result.familyName}`);
      setInviteCode('');
      setShowJoin(false);
      queryClient.invalidateQueries({ queryKey: ['families'] });
    } catch (e: any) {
      alert(e.response?.data?.error || 'Invalid invite code');
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const handleDelete = async (family: FamilyDto) => {
    if (!confirm(`Delete family "${family.name}"? This removes all sharing (media stays with owners).`)) return;
    await familyApi.deleteFamily(family.id);
    queryClient.invalidateQueries({ queryKey: ['families'] });
  };

  if (isLoading) return <div className="py-20 text-center" style={{ color: 'var(--text-muted)' }}>Loading...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Families</h2>
        <div className="flex gap-2">
          <button onClick={() => setShowJoin(true)} className="px-4 py-2 rounded-lg text-sm transition flex items-center gap-1.5" style={{ background: 'var(--card-bg)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            <Link2 size={14} /> Join Family
          </button>
          <button onClick={() => setShowCreate(true)} className="px-4 py-2 rounded-lg text-sm font-medium transition" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>
            + Create Family
          </button>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setShowCreate(false)}>
          <div className="rounded-xl p-6 w-full max-w-sm" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Create Family</h3>
            <input type="text" placeholder="Family name" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-4 py-2 rounded-lg mb-4 text-white focus:outline-none" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }} autoFocus />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
              <button onClick={handleCreate} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Join Modal */}
      {showJoin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={() => setShowJoin(false)}>
          <div className="rounded-xl p-6 w-full max-w-sm" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-bold mb-4" style={{ color: 'var(--text-primary)' }}>Join Family</h3>
            <input type="text" placeholder="Enter invite code" value={inviteCode} onChange={e => setInviteCode(e.target.value)}
              className="w-full px-4 py-2 rounded-lg mb-4 text-white focus:outline-none uppercase tracking-widest text-center text-lg" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }} autoFocus />
            <div className="flex gap-3 justify-end">
              <button onClick={() => setShowJoin(false)} className="px-4 py-2 text-sm" style={{ color: 'var(--text-muted)' }}>Cancel</button>
              <button onClick={handleJoin} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>Join</button>
            </div>
          </div>
        </div>
      )}

      {/* Family List */}
      {(!families || families.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20" style={{ color: 'var(--text-muted)' }}>
          <Users size={48} className="mb-4" />
          <p className="text-lg">No families yet</p>
          <p className="text-sm mt-1">Create one or join with an invite code</p>
        </div>
      ) : (
        <div className="space-y-4">
          {families.map(family => (
            <div key={family.id} className="rounded-xl p-5" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>{family.name}</h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                    {family.memberCount} member{family.memberCount !== 1 ? 's' : ''} · {family.mediaCount} shared photos · {formatBytes(family.storageUsedBytes)}
                  </p>
                </div>
                <span className="text-xs px-2 py-1 rounded-full" style={{ background: family.role === 'admin' ? 'rgba(138,180,248,0.15)' : 'rgba(255,255,255,0.05)', color: family.role === 'admin' ? 'var(--accent)' : 'var(--text-muted)' }}>
                  {family.role}
                </span>
              </div>

              {family.inviteCode && (
                <div className="mt-4 flex items-center gap-3 flex-wrap">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Invite:</span>
                  <code className="px-3 py-1 rounded text-sm tracking-widest font-mono" style={{ background: 'var(--content-bg)', color: 'var(--accent)' }}>
                    {family.inviteCode}
                  </code>
                  <button onClick={() => handleCopyCode(family.inviteCode!)} className="text-xs px-2 py-1 rounded transition flex items-center gap-1" style={{ background: 'var(--content-bg)', color: copiedCode === family.inviteCode ? '#4ade80' : 'var(--text-secondary)' }}>
                    {copiedCode === family.inviteCode ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy Code</>}
                  </button>
                  <button onClick={() => {
                    const link = `${window.location.origin}/join/${family.inviteCode}`;
                    navigator.clipboard.writeText(link);
                    setCopiedCode('link-' + family.id);
                    setTimeout(() => setCopiedCode(null), 2000);
                  }} className="text-xs px-2 py-1 rounded transition flex items-center gap-1" style={{ background: 'var(--content-bg)', color: copiedCode === 'link-' + family.id ? '#4ade80' : 'var(--text-secondary)' }}>
                    {copiedCode === 'link-' + family.id ? <><Check size={12} /> Link Copied</> : <><LinkIcon size={12} /> Copy Link</>}
                  </button>
                </div>
              )}

              {/* Total used */}
              <div className="mt-4">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatBytes(family.storageUsedBytes)} total shared</span>
              </div>

              {family.role === 'admin' && (
                <div className="mt-3 flex gap-2">
                  <button onClick={() => navigate(`/families/${family.id}`)} className="text-xs px-3 py-1.5 rounded transition flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                    <Image size={12} /> Browse Media ({family.mediaCount})
                  </button>
                  <button onClick={() => handleDelete(family)} className="text-xs px-3 py-1.5 rounded transition text-red-400 hover:bg-red-500/10">
                    Delete Family
                  </button>
                </div>
              )}
              {family.role !== 'admin' && (
                <div className="mt-3">
                  <button onClick={() => navigate(`/families/${family.id}`)} className="text-xs px-3 py-1.5 rounded transition flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                    <Image size={12} /> Browse Media ({family.mediaCount})
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
