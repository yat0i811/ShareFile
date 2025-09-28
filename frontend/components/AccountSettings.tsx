'use client';

import { useState } from 'react';

import { changePassword } from '../lib/api';

interface AccountSettingsProps {
  token: string;
}

export function AccountSettings({ token }: AccountSettingsProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('新しいパスワードが一致していません');
      return;
    }
    if (newPassword.length < 8) {
      setError('新しいパスワードは8文字以上で入力してください');
      return;
    }
    setLoading(true);
    try {
      const response = await changePassword(token, {
        current_password: currentPassword,
        new_password: newPassword
      });
      setMessage(response.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error(err);
      setError((err as Error).message || 'パスワードの変更に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  return (
    <section
      style={{
        border: '1px solid var(--surface-border)',
        backgroundColor: 'var(--card-bg)',
        padding: '1.5rem',
        borderRadius: '0.75rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        boxShadow: '0 10px 30px var(--shadow-color)'
      }}
    >
      <h2>アカウント設定</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '360px' }}>
        <label>
          <span>現在のパスワード</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label>
          <span>新しいパスワード</span>
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
            minLength={8}
          />
        </label>
        <label>
          <span>新しいパスワード（確認）</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
            minLength={8}
          />
        </label>
        {message && <div style={{ color: 'var(--success-color)' }}>{message}</div>}
        {error && <div style={{ color: 'var(--error-color)' }}>{error}</div>}
        <button type="submit" disabled={loading}>
          {loading ? '更新中…' : 'パスワードを更新'}
        </button>
      </form>
    </section>
  );
}
