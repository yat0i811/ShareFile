'use client';

import Link from 'next/link';
import { useState } from 'react';

import { login, type ApiUser } from '../lib/api';

interface AuthFormProps {
  onAuthenticated: (token: string, user: ApiUser, expiresAt: string, remember: boolean) => void;
}

export function AuthForm({ onAuthenticated }: AuthFormProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPassword = password.trim();
      if (!normalizedEmail || !normalizedPassword) {
        throw new Error('メールアドレスとパスワードを入力してください');
      }
      setEmail(normalizedEmail);
      const result = await login(normalizedEmail, normalizedPassword, remember);
      onAuthenticated(result.access_token, result.user, result.expires_at, remember);
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'ログインに失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '320px', width: '100%' }}>
      <h2 style={{ margin: 0, textAlign: 'center' }}>ログイン</h2>
      <label>
        <div>Email</div>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </label>
      <label>
        <div>Password</div>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
        <span>ログイン状態を保持する</span>
        <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
      </label>
      {error && <div style={{ color: 'var(--error-color)' }}>{error}</div>}
      <button type="submit" disabled={loading} style={{ padding: '0.75rem', fontWeight: 600 }}>
        {loading ? '処理中…' : 'ログイン'}
      </button>
      <div style={{ textAlign: 'center', fontSize: '0.9rem' }}>
        アカウントをお持ちでない方は{' '}
        <Link href="/register" style={{ color: 'var(--link-color)', textDecoration: 'underline' }}>
          新規登録はこちら
        </Link>
      </div>
    </form>
  );
}
