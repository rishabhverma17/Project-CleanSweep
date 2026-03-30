import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMsal, AuthenticatedTemplate, UnauthenticatedTemplate } from '@azure/msal-react';
import { familyApi } from '../api/familyApi';
import { loginRequest } from '../auth/msalConfig';
import { Users, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';

function JoinContent() {
  const { code } = useParams<{ code: string }>();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'joining' | 'done' | 'error'>('joining');
  const [familyName, setFamilyName] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (!code) return;
    familyApi.join(code)
      .then(result => {
        setFamilyName(result.familyName);
        setStatus('done');
        setTimeout(() => navigate('/families'), 2000);
      })
      .catch(err => {
        setErrorMsg(err.response?.data?.error || 'Invalid or expired invite code.');
        setStatus('error');
      });
  }, [code, navigate]);

  if (status === 'joining') {
    return (
      <div className="text-center">
        <Loader2 size={40} className="animate-spin mx-auto mb-4" style={{ color: 'var(--accent)' }} />
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Joining family...</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Using invite code: {code}</p>
      </div>
    );
  }

  if (status === 'done') {
    return (
      <div className="text-center">
        <CheckCircle2 size={40} className="mx-auto mb-4" style={{ color: '#4ade80' }} />
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Joined "{familyName}"!</h2>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Redirecting to families...</p>
      </div>
    );
  }

  return (
    <div className="text-center">
      <AlertCircle size={40} className="mx-auto mb-4" style={{ color: '#f87171' }} />
      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Could not join</h2>
      <p className="text-sm mb-4" style={{ color: 'var(--text-muted)' }}>{errorMsg}</p>
      <button onClick={() => navigate('/families')} className="px-4 py-2 rounded-lg text-sm font-medium transition" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>
        Go to Families
      </button>
    </div>
  );
}

function LoginPrompt() {
  const { code } = useParams<{ code: string }>();
  const { instance } = useMsal();
  return (
    <div className="text-center">
      <Users size={40} className="mx-auto mb-4" style={{ color: 'var(--accent)' }} />
      <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Join Family</h2>
      <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>You've been invited with code:</p>
      <code className="px-3 py-1 rounded text-lg tracking-widest font-mono inline-block mb-4" style={{ background: 'var(--card-bg)', color: 'var(--accent)' }}>{code}</code>
      <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>Sign in to accept this invitation.</p>
      <button
        onClick={() => instance.loginRedirect(loginRequest)}
        className="px-6 py-3 rounded-full font-medium transition"
        style={{ background: 'var(--accent)', color: '#1a1a1a' }}
      >
        Sign in with Microsoft
      </button>
    </div>
  );
}

export function JoinPage() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--content-bg)' }}>
      <div className="rounded-2xl p-8 max-w-sm w-full" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}>
        <AuthenticatedTemplate><JoinContent /></AuthenticatedTemplate>
        <UnauthenticatedTemplate><LoginPrompt /></UnauthenticatedTemplate>
      </div>
    </div>
  );
}
