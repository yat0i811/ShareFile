'use client';

import { useState } from 'react';

import {
  ApiUser,
  adminCreateUser,
  adminDeleteUser,
  adminUpdateUser
} from '../lib/api';

interface AdminPanelProps {
  token: string;
  currentUser: ApiUser;
  users: ApiUser[];
  onRefresh: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

export function AdminPanel({ token, currentUser, users, onRefresh }: AdminPanelProps) {
  const [pendingId, setPendingId] = useState<string | null>(null);

  const handleApprove = async (user: ApiUser) => {
    setPendingId(user.id);
    try {
      await adminUpdateUser(token, user.id, { is_active: true });
      onRefresh();
    } catch (error) {
      console.error(error);
      alert('ユーザーの更新に失敗しました');
    } finally {
      setPendingId(null);
    }
  };

  const handleSetQuota = async (user: ApiUser) => {
    const value = prompt('上限バイト数を入力（空欄で無制限）', user.quota_bytes != null ? String(user.quota_bytes) : '');
    if (value === null) return;
    const quota = value.trim() === '' ? null : Number.parseInt(value, 10);
    if (quota !== null && (Number.isNaN(quota) || quota < 0)) {
      alert('正しい数値を入力してください');
      return;
    }
    setPendingId(user.id);
    try {
      await adminUpdateUser(token, user.id, { quota_bytes: quota });
      onRefresh();
    } catch (error) {
      console.error(error);
      alert('クオータの更新に失敗しました');
    } finally {
      setPendingId(null);
    }
  };

  const handleResetPassword = async (user: ApiUser) => {
    const value = prompt('新しいパスワードを入力（8文字以上）');
    if (!value) return;
    if (value.length < 8) {
      alert('8文字以上のパスワードを入力してください');
      return;
    }
    setPendingId(user.id);
    try {
      await adminUpdateUser(token, user.id, { password: value });
      onRefresh();
    } catch (error) {
      console.error(error);
      alert('パスワードの更新に失敗しました');
    } finally {
      setPendingId(null);
    }
  };

  const handleDeleteUser = async (user: ApiUser) => {
    if (user.id === currentUser.id) {
      alert('自分自身は削除できません');
      return;
    }
    if (!confirm(`${user.email} を削除しますか？`)) return;
    setPendingId(user.id);
    try {
      await adminDeleteUser(token, user.id);
      onRefresh();
    } catch (error) {
      console.error(error);
      alert('ユーザーの削除に失敗しました');
    } finally {
      setPendingId(null);
    }
  };

  const handleCreateUser = async () => {
    const email = prompt('新規ユーザーのメールアドレス');
    if (!email) return;
    const password = prompt('初期パスワード（8文字以上）');
    if (!password || password.length < 8) {
      alert('8文字以上のパスワードを入力してください');
      return;
    }
    const isAdmin = confirm('管理者権限を付与しますか？ OK=はい / キャンセル=いいえ');
    setPendingId('new');
    try {
      await adminCreateUser(token, { email, password, is_admin: isAdmin, is_active: true });
      onRefresh();
    } catch (error) {
      console.error(error);
      alert('ユーザーの作成に失敗しました');
    } finally {
      setPendingId(null);
    }
  };

  return (
    <section
      style={{
        border: '1px solid var(--surface-border)',
        backgroundColor: 'var(--card-bg)',
        padding: '1.5rem',
        borderRadius: '0.75rem',
        marginTop: '2rem',
        boxShadow: '0 6px 20px var(--shadow-color)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2>ユーザー管理</h2>
        <button onClick={handleCreateUser} disabled={pendingId === 'new'} style={{ padding: '0.5rem 0.75rem' }}>
          {pendingId === 'new' ? '作成中…' : 'ユーザー追加'}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {users.map((user) => (
          <div
            key={user.id}
            style={{
              border: '1px solid var(--surface-border)',
              backgroundColor: 'var(--card-bg)',
              padding: '1rem',
              borderRadius: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
              boxShadow: '0 4px 14px var(--shadow-color)'
            }}
          >
            <div style={{ fontWeight: 600 }}>{user.email}</div>
            <div style={{ fontSize: '0.9rem', color: 'var(--muted-text)' }}>
              役割: {user.is_admin ? '管理者' : '一般'} / 状態: {user.is_active ? '有効' : '承認待ち'} / 使用量: {formatBytes(user.used_bytes)} / 上限: {user.quota_bytes != null ? formatBytes(user.quota_bytes) : '無制限'}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {!user.is_active && (
                <button onClick={() => handleApprove(user)} disabled={pendingId === user.id} style={{ padding: '0.4rem 0.6rem' }}>
                  承認
                </button>
              )}
              <button onClick={() => handleSetQuota(user)} disabled={pendingId === user.id} style={{ padding: '0.4rem 0.6rem' }}>
                上限設定
              </button>
              <button onClick={() => handleResetPassword(user)} disabled={pendingId === user.id} style={{ padding: '0.4rem 0.6rem' }}>
                パスワード変更
              </button>
              <button
                onClick={() => handleDeleteUser(user)}
                disabled={pendingId === user.id}
                style={{ padding: '0.4rem 0.6rem', backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}
              >
                削除
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
