'use client';

import { useCallback, useEffect, useState } from 'react';

import { AccountSettings } from '../components/AccountSettings';
import { AdminPanel } from '../components/AdminPanel';
import { AuthForm } from '../components/AuthForm';
import { FileManager } from '../components/FileManager';
import { ThemeToggle } from '../components/ThemeToggle';
import { UploadManager } from '../components/UploadManager';
import {
  ApiFile,
  ApiUser,
  getCurrentUser,
  listFiles,
  listUsers
} from '../lib/api';

const LOCAL_STORAGE_KEY = 'share-storage-auth';
const SESSION_STORAGE_KEY = 'share-storage-auth-session';

interface StoredAuth {
  token: string;
  expiresAt: string;
}

function parseStoredAuth(raw: string | null): StoredAuth | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredAuth>;
    if (typeof parsed?.token === 'string' && typeof parsed?.expiresAt === 'string') {
      return { token: parsed.token, expiresAt: parsed.expiresAt };
    }
  } catch {
    return null;
  }
  return null;
}

export default function HomePage() {
  const [token, setToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<ApiUser | null>(null);
  const [files, setFiles] = useState<ApiFile[]>([]);
  const [adminUsers, setAdminUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeView, setActiveView] = useState<'upload' | 'files' | 'account' | 'users'>('upload');

  const storeAuth = useCallback((auth: StoredAuth, remember: boolean) => {
    if (typeof window === 'undefined') return;
    try {
      const serialized = JSON.stringify(auth);
      if (remember) {
        window.localStorage.setItem(LOCAL_STORAGE_KEY, serialized);
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, serialized);
        window.localStorage.removeItem(LOCAL_STORAGE_KEY);
      }
    } catch (error) {
      console.error('Failed to persist auth state', error);
    }
  }, []);

  const clearStoredAuth = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(LOCAL_STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }, []);

  const refreshFiles = useCallback(async () => {
    if (!token || !currentUser) return;
    try {
      const response = await listFiles(token, currentUser.is_admin ? undefined : currentUser.id);
      setFiles(response.files);
    } catch (error) {
      console.error(error);
    }
  }, [token, currentUser]);

  const refreshUsers = useCallback(async () => {
    if (!token || !currentUser?.is_admin) return;
    try {
      const response = await listUsers(token);
      setAdminUsers(response.users);
    } catch (error) {
      console.error(error);
    }
  }, [token, currentUser]);

  const loadAllData = useCallback(async (accessToken: string) => {
    setLoading(true);
    try {
      const me = await getCurrentUser(accessToken);
      setCurrentUser(me);
      const fileResponse = await listFiles(accessToken, me.is_admin ? undefined : me.id);
      setFiles(fileResponse.files);
      if (me.is_admin) {
        const userResponse = await listUsers(accessToken);
        setAdminUsers(userResponse.users);
      } else {
        setAdminUsers([]);
      }
      return true;
    } catch (error) {
      console.error(error);
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleAuthenticated = useCallback(
    async (accessToken: string, _user: ApiUser, expiresAt: string, remember: boolean) => {
      setToken(accessToken);
      storeAuth({ token: accessToken, expiresAt }, remember);
      setActiveView('upload');
      const success = await loadAllData(accessToken);
      if (!success) {
        clearStoredAuth();
        setToken(null);
      }
    },
    [clearStoredAuth, loadAllData, storeAuth]
  );

  const handleLogout = useCallback(() => {
    setToken(null);
    setCurrentUser(null);
    setFiles([]);
    setAdminUsers([]);
    clearStoredAuth();
    setActiveView('upload');
    setMenuOpen(false);
  }, [clearStoredAuth]);

  useEffect(() => {
    const restoreAuth = async () => {
      if (typeof window === 'undefined' || token) return;
      const sessionAuth = parseStoredAuth(window.sessionStorage.getItem(SESSION_STORAGE_KEY));
      const persistedAuth = sessionAuth ?? parseStoredAuth(window.localStorage.getItem(LOCAL_STORAGE_KEY));
      if (!persistedAuth) {
        return;
      }
      if (new Date(persistedAuth.expiresAt) <= new Date()) {
        clearStoredAuth();
        return;
      }
      setToken(persistedAuth.token);
      const success = await loadAllData(persistedAuth.token);
      if (!success) {
        clearStoredAuth();
        setToken(null);
      }
    };

    restoreAuth();
  }, [clearStoredAuth, loadAllData, token]);

  useEffect(() => {
    if (!currentUser?.is_admin && activeView === 'users') {
      setActiveView('upload');
    }
  }, [activeView, currentUser]);

  useEffect(() => {
    if (!token) {
      setMenuOpen(false);
    }
  }, [token]);

  const isAdmin = currentUser?.is_admin ?? false;

  const handleSelectView = useCallback(
    (view: 'upload' | 'files' | 'account' | 'users') => {
      setActiveView(view);
      setMenuOpen(false);
      if (view === 'files') {
        void refreshFiles();
      }
      if (view === 'users') {
        void refreshUsers();
      }
    },
    [refreshFiles, refreshUsers]
  );

  const navigationItems: Array<{ key: 'upload' | 'files' | 'account' | 'users'; label: string; visible: boolean }>
    = [
      { key: 'upload', label: 'ファイルアップロード', visible: true },
      { key: 'files', label: 'ファイル管理', visible: true },
      { key: 'account', label: 'アカウント設定', visible: true },
      { key: 'users', label: 'ユーザー管理', visible: isAdmin }
    ];

  return (
    <main
      style={{
        maxWidth: '1080px',
        margin: '0 auto',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem',
        position: 'relative',
        minHeight: '100vh'
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem'
        }}
      >
        <h1>ShareFile</h1>
        {token && currentUser ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.95rem', color: 'var(--muted-text)' }}>
              {currentUser.email}（{currentUser.is_admin ? '管理者' : '一般'}）
            </span>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-label="メニューを開く"
              aria-expanded={menuOpen}
              style={{ padding: '0.5rem 0.75rem' }}
            >
              ☰
            </button>
          </div>
        ) : (
          <ThemeToggle style={{ width: 'auto' }} />
        )}
      </header>

      {token && currentUser && menuOpen && (
        <>
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(15, 23, 42, 0.35)',
              zIndex: 40
            }}
            onClick={() => setMenuOpen(false)}
          />
          <nav
            style={{
              position: 'fixed',
              top: '5rem',
              right: '2rem',
              backgroundColor: 'var(--card-bg)',
              border: '1px solid var(--surface-border)',
              borderRadius: '0.75rem',
              padding: '1rem',
              minWidth: '240px',
              zIndex: 50,
              boxShadow: '0 18px 36px var(--shadow-color)'
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {navigationItems
                .filter((item) => item.visible)
                .map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => handleSelectView(item.key)}
                    style={{
                      padding: '0.5rem 0.75rem',
                      backgroundColor: activeView === item.key ? 'var(--surface-border-muted)' : 'var(--card-bg)',
                      color: activeView === item.key ? 'var(--text-color)' : 'var(--text-color)',
                      border: '1px solid var(--surface-border)',
                      fontWeight: activeView === item.key ? 700 : 500,
                      textAlign: 'left'
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              <ThemeToggle />
              <button
                type="button"
                onClick={handleLogout}
                style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}
              >
                ログアウト
              </button>
            </div>
          </nav>
        </>
      )}

      {!token && (
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ width: '100%', maxWidth: '360px' }}>
            <AuthForm onAuthenticated={handleAuthenticated} />
          </div>
        </div>
      )}

      {token && currentUser && (
        <>
          {loading && <div>読み込み中...</div>}

          {activeView === 'upload' && (
            <section
              style={{
                border: '1px solid var(--surface-border)',
                backgroundColor: 'var(--card-bg)',
                padding: '1.5rem',
                borderRadius: '0.75rem',
                boxShadow: '0 6px 20px var(--shadow-color)'
              }}
            >
              <h2>ファイルアップロード</h2>
              <UploadManager
                token={token}
                onUploadComplete={() => {
                  refreshFiles();
                }}
              />
            </section>
          )}

          {activeView === 'files' && (
            <section
              style={{
                border: '1px solid var(--surface-border)',
                backgroundColor: 'var(--card-bg)',
                padding: '1.5rem',
                borderRadius: '0.75rem',
                boxShadow: '0 6px 20px var(--shadow-color)'
              }}
            >
              <h2>ファイル管理</h2>
              <FileManager token={token} files={files} onRefresh={refreshFiles} isAdmin={currentUser.is_admin} />
            </section>
          )}

          {activeView === 'account' && <AccountSettings token={token} />}

          {activeView === 'users' && currentUser.is_admin && (
            <AdminPanel token={token} currentUser={currentUser} users={adminUsers} onRefresh={refreshUsers} />
          )}
        </>
      )}
    </main>
  );
}
