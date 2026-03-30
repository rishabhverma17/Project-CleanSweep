import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MsalProvider, AuthenticatedTemplate, UnauthenticatedTemplate, useMsal } from '@azure/msal-react';
import { AppShell } from './components/layout/AppShell';
import { GalleryPage } from './pages/GalleryPage';
import { UploadPage } from './pages/UploadPage';
import { AlbumsPage } from './pages/AlbumsPage';
import { AlbumDetailPage } from './pages/AlbumDetailPage';
import { FamiliesPage } from './pages/FamiliesPage';
import { FamilyMediaPage } from './pages/FamilyMediaPage';
import { AdminPage } from './pages/AdminPage';
import { SharedPage } from './pages/SharedPage';
import { JoinPage } from './pages/JoinPage';
import { useSignalR } from './hooks/useSignalR';
import { TaskPanel } from './components/layout/TaskPanel';
import { ToastBar } from './components/layout/ToastBar';
import { msalInstance, loginRequest } from './auth/msalConfig';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2,
      retry: 2,
    },
  },
});

function LoginPage() {
  const { instance } = useMsal();
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--content-bg)' }}>
      <div className="rounded-2xl p-8 max-w-sm w-full text-center" style={{ background: 'var(--sidebar-bg)', border: '1px solid var(--border)' }}>
        <h1 className="text-2xl font-medium mb-2" style={{ color: 'var(--text-primary)' }}>CleanSweep</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--text-muted)' }}>Personal media storage</p>
        <button
          onClick={() => instance.loginRedirect(loginRequest)}
          className="w-full px-6 py-3 rounded-full font-medium transition"
          style={{ background: 'var(--accent)', color: '#1a1a1a' }}
          onMouseEnter={e => (e.target as HTMLElement).style.background = 'var(--accent-hover)'}
          onMouseLeave={e => (e.target as HTMLElement).style.background = 'var(--accent)'}
        >
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}

function AppInner() {
  useSignalR();
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<GalleryPage />} />
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/albums" element={<AlbumsPage />} />
        <Route path="/albums/:albumId" element={<AlbumDetailPage />} />
        <Route path="/families" element={<FamiliesPage />} />
        <Route path="/families/:familyId" element={<FamilyMediaPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <MsalProvider instance={msalInstance}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastBar />
          <Routes>
            <Route path="/shared/:token" element={<SharedPage />} />
            <Route path="/join/:code" element={<JoinPage />} />
            <Route path="*" element={
              <>
                <AuthenticatedTemplate>
                  <AppInner />
                  <TaskPanel />
                </AuthenticatedTemplate>
                <UnauthenticatedTemplate>
                  <LoginPage />
                </UnauthenticatedTemplate>
              </>
            } />
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>
    </MsalProvider>
  );
}
