import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useMsal } from '@azure/msal-react';
import { useQuery } from '@tanstack/react-query';
import { GlobalDropZone } from '../media/GlobalDropZone';
import { quotaApi } from '../../api/familyApi';
import { Image, Upload, FolderOpen, Users, Settings, ChevronRight, ChevronLeft, Menu, X, LogOut } from 'lucide-react';

const navIcons: Record<string, React.ReactNode> = {
  '/': <Image size={20} />,
  '/upload': <Upload size={20} />,
  '/albums': <FolderOpen size={20} />,
  '/families': <Users size={20} />,
  '/admin': <Settings size={20} />,
};

const navItems = [
  { path: '/', label: 'Gallery' },
  { path: '/upload', label: 'Upload' },
  { path: '/albums', label: 'Albums' },
  { path: '/families', label: 'Families' },
];

export function AppShell() {
  const location = useLocation();
  const { instance, accounts } = useMsal();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const { data: usage } = useQuery({ queryKey: ['quota'], queryFn: quotaApi.getMyUsage, staleTime: 60000 });

  const user = accounts[0];
  const userName = user?.name || user?.username || 'User';
  const userEmail = user?.username || '';
  const initials = userName.split(' ').map((n: string) => n[0]).join('').toUpperCase().slice(0, 2);
  const isOwner = user?.idTokenClaims?.roles?.includes('owner') ?? true;

  const handleLogout = () => {
    instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  };

  const allNavItems = isOwner ? [...navItems, { path: '/admin', label: 'Admin' }] : navItems;

  return (
    <GlobalDropZone>
      <div className="min-h-screen flex flex-col md:flex-row" style={{ background: 'var(--content-bg)', color: 'var(--text-primary)' }}>

        {/* ══ MOBILE TOP BAR ══ */}
        <header className="md:hidden flex items-center justify-between px-4 h-12 flex-shrink-0" style={{ background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border)' }}>
          <h1 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>CleanSweep</h1>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>{initials}</div>
            <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="p-1" style={{ color: 'var(--text-secondary)' }}>
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </header>

        {/* ══ MOBILE SLIDE-DOWN MENU ══ */}
        {mobileMenuOpen && (
          <div className="md:hidden" style={{ background: 'var(--sidebar-bg)', borderBottom: '1px solid var(--border)' }}>
            <div className="px-4 py-2 flex items-center gap-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>{initials}</div>
              <div className="min-w-0">
                <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{userName}</p>
                <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{userEmail}</p>
              </div>
            </div>
            {usage && (
              <div className="px-4 py-2" style={{ borderBottom: '1px solid var(--border)' }}>
                <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                  <span>{usage.usedFormatted}</span><span>{usage.quotaFormatted}</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.min(100, usage.usedPercent)}%`, background: usage.usedPercent > 90 ? '#f87171' : 'var(--accent)' }} />
                </div>
              </div>
            )}
            <button onClick={handleLogout} className="w-full px-4 py-3 text-left text-sm flex items-center gap-2 hover:bg-white/5" style={{ color: 'var(--text-secondary)' }}>
              <LogOut size={16} /> Sign out
            </button>
          </div>
        )}

        {/* ══ DESKTOP SIDEBAR ══ */}
        <aside className={`hidden md:flex flex-shrink-0 flex-col transition-all duration-200 ${collapsed ? 'w-16' : 'w-60'}`} style={{ background: 'var(--sidebar-bg)', borderRight: '1px solid var(--border)' }}>
          <div className="px-4 h-14 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            {!collapsed && <h1 className="text-lg font-medium" style={{ color: 'var(--text-primary)' }}>CleanSweep</h1>}
            <button onClick={() => setCollapsed(!collapsed)} className="p-1 rounded hover:bg-white/10 transition" style={{ color: 'var(--text-secondary)' }}>
              {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
          </div>

          <nav className="flex-1 py-2 px-2 space-y-0.5">
            {allNavItems.map(item => {
              const active = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
              return (
                <Link key={item.path} to={item.path}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-full text-sm transition ${active ? 'font-medium' : ''}`}
                  style={{ background: active ? 'rgba(138, 180, 248, 0.15)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)' }}
                  title={collapsed ? item.label : undefined}>
                  <span className="w-6 flex items-center justify-center">{navIcons[item.path]}</span>
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              );
            })}
          </nav>

          {!collapsed && usage && (
            <div className="px-4 py-2" style={{ borderTop: '1px solid var(--border)' }}>
              <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                <span>{usage.usedFormatted}</span><span>{usage.quotaFormatted}</span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, usage.usedPercent)}%`, background: usage.usedPercent > 90 ? '#f87171' : 'var(--accent)' }} />
              </div>
            </div>
          )}

          <div className="px-2 py-3 relative" style={{ borderTop: '1px solid var(--border)' }}>
            <button onClick={() => setShowUserMenu(!showUserMenu)} className="w-full flex items-center gap-3 px-3 py-2 rounded-full hover:bg-white/5 transition">
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#1a1a1a' }}>{initials}</div>
              {!collapsed && (
                <div className="text-left min-w-0">
                  <p className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{userName}</p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{userEmail}</p>
                </div>
              )}
            </button>
            {showUserMenu && (
              <div className="absolute bottom-full left-2 right-2 mb-2 rounded-lg shadow-xl overflow-hidden" style={{ background: 'var(--card-bg)', border: '1px solid var(--border)' }}>
                <div className="px-4 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{userName}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{userEmail}</p>
                </div>
                <button onClick={handleLogout} className="w-full px-4 py-2.5 text-left text-sm hover:bg-white/5 transition" style={{ color: 'var(--text-secondary)' }}>Sign out</button>
              </div>
            )}
          </div>
        </aside>

        {/* ══ MAIN CONTENT ══ */}
        <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
          <div className="p-3 md:p-6" onClick={() => { setMobileMenuOpen(false); setShowUserMenu(false); }}><Outlet /></div>
        </main>

        {/* ══ MOBILE BOTTOM NAV ══ */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 flex justify-around items-center h-14 z-30" style={{ background: 'var(--sidebar-bg)', borderTop: '1px solid var(--border)' }}>
          {allNavItems.map(item => {
            const active = item.path === '/' ? location.pathname === '/' : location.pathname.startsWith(item.path);
            return (
              <Link key={item.path} to={item.path} onClick={() => setMobileMenuOpen(false)}
                className="flex flex-col items-center justify-center gap-0.5 py-1 px-3 rounded-lg transition"
                style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}>
                {navIcons[item.path]}
                <span className="text-[10px]">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </GlobalDropZone>
  );
}
