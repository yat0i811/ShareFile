'use client';

import { useState } from 'react';

import { register } from '../lib/api';

export function RegisterForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (password !== confirmPassword) {
      setError('パスワードが一致しません');
      return;
    }
    setLoading(true);
    try {
      const response = await register(email, password);
      setMessage(response.message);
      setEmail('');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error(err);
      setError((err as Error).message || '登録に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', maxWidth: '360px', width: '100%' }}>
      <h2 style={{ margin: 0, textAlign: 'center' }}>新規アカウント登録</h2>
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
          minLength={8}
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </label>
      <label>
        <div>Confirm Password</div>
        <input
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          required
          minLength={8}
          style={{ width: '100%', padding: '0.5rem' }}
        />
      </label>
      {message && <div style={{ color: 'var(--success-color)' }}>{message}</div>}
      {error && <div style={{ color: 'var(--error-color)' }}>{error}</div>}
      <button type="submit" disabled={loading} style={{ padding: '0.75rem', fontWeight: 600 }}>
        {loading ? '送信中…' : '登録申請'}
      </button>
      <small style={{ opacity: 0.8 }}>承認後にログインが可能になります。</small>
    </form>
  );
}
