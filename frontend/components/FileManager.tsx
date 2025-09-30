'use client';

import { useMemo, useState } from 'react';

import {
  type ApiDownloadLink,
  type ApiFile,
  type CreateDownloadLinkPayload,
  createDownloadLink,
  deleteDownloadLink,
  deleteFile
} from '../lib/api';

interface FileManagerProps {
  token: string;
  files: ApiFile[];
  onRefresh: () => void;
  isAdmin: boolean;
}

type LinkFormState = {
  expiresAt: string;
  noExpiry: boolean;
  requireDownloadPage: boolean;
  createShortLink: boolean;
  password: string;
};

type InputChangeEvent = { target: HTMLInputElement };

const createDefaultFormState = (): LinkFormState => ({
  expiresAt: '',
  noExpiry: false,
  requireDownloadPage: false,
  createShortLink: false,
  password: ''
});

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
}

function formatExpiration(link: ApiDownloadLink): string {
  if (link.never_expires) return '無期限';
  if (!link.expires_at) return '未設定';
  return new Date(link.expires_at).toLocaleString();
}

export function FileManager({ token, files, onRefresh, isAdmin }: FileManagerProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [linkForms, setLinkForms] = useState<Record<string, LinkFormState>>({});
  const [formErrors, setFormErrors] = useState<Record<string, string | null>>({});
  const [copiedFeedback, setCopiedFeedback] = useState<{ id: string; message: string } | null>(null);

  const baseDownloadUrl = useMemo(() => {
    const env = process.env.NEXT_PUBLIC_PUBLIC_BASE_URL?.replace(/\/$/, '');
    if (env) {
      return env;
    }
    if (typeof window !== 'undefined') {
      return window.location.origin;
    }
    return '';
  }, []);

  const minDatetimeLocal = useMemo(() => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
  }, []);

  const toggleExpanded = (fileId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) {
        next.delete(fileId);
      } else {
        next.add(fileId);
      }
      return next;
    });
  };

  const updateFormState = (fileId: string, updates: Partial<LinkFormState>) => {
    setLinkForms((prev) => {
      const existing = prev[fileId] ?? createDefaultFormState();
      return {
        ...prev,
        [fileId]: { ...existing, ...updates }
      };
    });
  };

  const resetFormState = (fileId: string) => {
    setLinkForms((prev) => ({
      ...prev,
      [fileId]: createDefaultFormState()
    }));
    setFormErrors((prev) => ({
      ...prev,
      [fileId]: null
    }));
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm('このファイルを削除しますか？')) return;
    setPending(fileId);
    try {
      await deleteFile(token, fileId);
      onRefresh();
    } catch (error) {
      console.error(error);
      alert('ファイルの削除に失敗しました');
    } finally {
      setPending(null);
    }
  };

  const handleDeleteLink = async (fileId: string, linkId: string) => {
    if (!confirm('このダウンロードリンクを削除しますか？')) return;
    setPending(linkId);
    try {
      await deleteDownloadLink(token, fileId, linkId);
      onRefresh();
    } catch (error) {
      console.error(error);
      alert('リンクの削除に失敗しました');
    } finally {
      setPending(null);
    }
  };

  const handleCreateLink = async (fileId: string) => {
    const form = linkForms[fileId] ?? createDefaultFormState();
    if (!form.noExpiry && !form.expiresAt) {
      setFormErrors((prev) => ({
        ...prev,
        [fileId]: '有効期限を指定するか「無期限」を選択してください'
      }));
      return;
    }

    const payload: CreateDownloadLinkPayload = {};

    if (form.noExpiry) {
      payload.no_expiry = true;
    } else if (form.expiresAt) {
      payload.expires_at = new Date(form.expiresAt).toISOString();
    }

    if (form.password.trim()) {
      payload.password = form.password.trim();
    }

    payload.require_download_page = form.requireDownloadPage;
    payload.create_short_link = form.createShortLink;

    setPending(fileId);
    setFormErrors((prev) => ({
      ...prev,
      [fileId]: null
    }));
    try {
      await createDownloadLink(token, fileId, payload);
      resetFormState(fileId);
      onRefresh();
    } catch (error) {
      console.error(error);
      setFormErrors((prev) => ({
        ...prev,
        [fileId]: (error as Error).message || 'リンクの作成に失敗しました'
      }));
    } finally {
      setPending(null);
    }
  };

  const handleCopyLink = async (linkId: string, url: string, message: string) => {
    const absoluteUrl = baseDownloadUrl ? `${baseDownloadUrl}${url}` : url;
    try {
      await navigator.clipboard.writeText(absoluteUrl);
      setCopiedFeedback({ id: linkId, message });
      window.setTimeout(() => {
        setCopiedFeedback((prev) => (prev?.id === linkId ? null : prev));
      }, 2000);
    } catch (error) {
      console.error(error);
      alert('URLのコピーに失敗しました');
    }
  };

  if (files.length === 0) {
    return <p>アップロード済みのファイルはありません。</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {files.map((file) => {
        const isExpanded = expanded.has(file.id);
        const form = linkForms[file.id] ?? createDefaultFormState();
        const errorMessage = formErrors[file.id];
        return (
          <div
            key={file.id}
            style={{
              border: '1px solid var(--surface-border)',
              backgroundColor: 'var(--card-bg)',
              padding: '1rem',
              borderRadius: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem',
              boxShadow: '0 6px 20px var(--shadow-color)'
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '1rem',
                flexWrap: 'wrap'
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{file.filename}</div>
                <div style={{ fontSize: '0.9rem', color: 'var(--muted-text)' }}>
                  {formatBytes(file.size)} / {file.status} / {new Date(file.created_at).toLocaleString()}
                </div>
                {isAdmin && file.owner_email && (
                  <div style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>所有者: {file.owner_email}</div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="button" onClick={() => toggleExpanded(file.id)}>
                  {isExpanded ? 'リンクを閉じる' : 'リンクを表示'}
                </button>
                <button
                  type="button"
                  onClick={() => handleDeleteFile(file.id)}
                  disabled={pending === file.id}
                  style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}
                >
                  {pending === file.id ? '削除中…' : '削除'}
                </button>
              </div>
            </div>
            {isExpanded && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div
                  style={{
                    border: '1px solid var(--surface-border-muted)',
                    backgroundColor: 'var(--card-bg)',
                    borderRadius: '0.75rem',
                    padding: '0.75rem',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.75rem'
                  }}
                >
                  <div style={{ fontWeight: 600 }}>ダウンロードリンクを作成</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '420px' }}>
                    <label>
                      <span>有効期限</span>
                      <input
                        type="datetime-local"
                        value={form.expiresAt}
                        onChange={(event: InputChangeEvent) =>
                          updateFormState(file.id, { expiresAt: event.target.value })
                        }
                        min={minDatetimeLocal}
                        disabled={form.noExpiry}
                        style={{ cursor: form.noExpiry ? 'not-allowed' : 'text' }}
                      />
                    </label>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={form.noExpiry}
                          onChange={(event: InputChangeEvent) =>
                            updateFormState(file.id, {
                              noExpiry: event.target.checked,
                              expiresAt: event.target.checked ? '' : form.expiresAt
                            })
                          }
                        />
                        <span>無期限にする</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={form.createShortLink}
                          onChange={(event: InputChangeEvent) =>
                            updateFormState(file.id, { createShortLink: event.target.checked })
                          }
                        />
                        <span>短縮リンクを作成する</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                        <input
                          type="checkbox"
                          checked={form.requireDownloadPage}
                          onChange={(event: InputChangeEvent) =>
                            updateFormState(file.id, { requireDownloadPage: event.target.checked })
                          }
                        />
                        <span>ダウンロードページを用意する</span>
                      </div>
                    </div>
                    <label>
                      <span>ダウンロード用パスワード（任意）</span>
                      <input
                        type="password"
                        value={form.password}
                        onChange={(event: InputChangeEvent) =>
                          updateFormState(file.id, { password: event.target.value })
                        }
                        placeholder="未設定の場合は空欄"
                        minLength={4}
                      />
                      <small style={{ color: 'var(--muted-text)', fontSize: '0.85rem' }}>※ 設定する場合は4文字以上で入力してください</small>
                    </label>
                    {errorMessage && <div style={{ color: 'var(--error-color)' }}>{errorMessage}</div>}
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <button type="button" onClick={() => handleCreateLink(file.id)} disabled={pending === file.id}>
                        {pending === file.id ? '作成中…' : 'リンクを作成'}
                      </button>
                      <button type="button" onClick={() => resetFormState(file.id)} disabled={pending === file.id}>
                        入力をリセット
                      </button>
                    </div>
                  </div>
                </div>

                {file.links.length === 0 && <div>リンクはまだ作成されていません。</div>}
                {file.links.map((link) => {
                  const query = link.url.split('?')[1] ?? '';
                  const token = new URLSearchParams(query).get('token') ?? '';
                  const needsDownloadPage = link.require_download_page || link.has_password;
                  const downloadPagePath = needsDownloadPage
                    ? `/share-download/${file.id}?token=${encodeURIComponent(token)}&name=${encodeURIComponent(file.filename)}`
                    : link.url;
                  const shortUrl = link.short_url;
                  const primaryPath = shortUrl ?? downloadPagePath;
                  const absolutePrimary = baseDownloadUrl ? `${baseDownloadUrl}${primaryPath}` : primaryPath;
                  const fallbackPath = link.short_url ? downloadPagePath : null;
                  const absoluteFallback = fallbackPath ? (baseDownloadUrl ? `${baseDownloadUrl}${fallbackPath}` : fallbackPath) : null;
                  const infoParts = [
                    `有効期限: ${formatExpiration(link)}`,
                    `ダウンロード数: ${link.download_count}`
                  ];
                  if (needsDownloadPage) {
                    infoParts.push('専用ページあり');
                  }
                  if (link.has_password) {
                    infoParts.push('パスワード保護');
                  }
                  const shortCopyKey = shortUrl ? `${link.id}-short` : null;
                  const longCopyKey = shortUrl ? `${link.id}-long` : `${link.id}-download`;
                  return (
                    <div
                      key={link.id}
                      style={{
                        border: '1px solid var(--surface-border-muted)',
                        backgroundColor: 'var(--card-bg)',
                        padding: '0.75rem',
                        borderRadius: '0.75rem',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.5rem'
                      }}
                    >
                      <div
                        style={{
                          wordBreak: 'break-all',
                          overflowWrap: 'anywhere',
                          padding: '0.5rem',
                          borderRadius: '0.5rem',
                          border: '1px solid var(--surface-border-muted)',
                          backgroundColor: 'var(--card-bg)'
                        }}
                      >
                        <strong style={{ display: 'block', marginBottom: '0.25rem' }}>{link.short_url ? '短縮URL' : 'ダウンロードURL'}</strong>
                        <a href={absolutePrimary} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--link-color)' }}>
                          {absolutePrimary}
                        </a>
                      </div>
                      <div style={{ fontSize: '0.9rem', color: 'var(--muted-text)' }}>
                        {infoParts.join(' / ')}
                      </div>
                      {absoluteFallback && (
                        <div
                          style={{
                            wordBreak: 'break-all',
                            overflowWrap: 'anywhere',
                            padding: '0.5rem',
                            borderRadius: '0.5rem',
                            border: '1px solid var(--surface-border-muted)',
                            backgroundColor: 'var(--card-bg)',
                            fontSize: '0.85rem',
                            color: 'var(--muted-text)'
                          }}
                        >
                          <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>ダウンロードURL</strong>
                          <a href={absoluteFallback} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--link-color)' }}>{absoluteFallback}</a>
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                        {shortUrl && shortCopyKey && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <button type="button" onClick={() => handleCopyLink(shortCopyKey, shortUrl, '短縮URLをコピーしました')}>
                              短縮URLをコピー
                            </button>
                            {copiedFeedback?.id === shortCopyKey && (
                              <span style={{ color: 'var(--success-color)', fontSize: '0.85rem' }}>{copiedFeedback.message}</span>
                            )}
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <button type="button" onClick={() => handleCopyLink(longCopyKey, downloadPagePath, 'ダウンロードURLをコピーしました')}>
                            ダウンロードURLをコピー
                          </button>
                          {copiedFeedback?.id === longCopyKey && (
                            <span style={{ color: 'var(--success-color)', fontSize: '0.85rem' }}>{copiedFeedback.message}</span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteLink(file.id, link.id)}
                          disabled={pending === link.id}
                          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
