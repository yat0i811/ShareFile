'use client';

import { useMemo, useState } from 'react';

import {
  createDownloadLink,
  createUploadSession,
  finalizeSession,
  getSessionStatus,
  uploadChunk
} from '../lib/api';
import { sha256HexFromBlob, sha256HexFromFile } from '../lib/crypto';

interface UploadManagerProps {
  token: string;
  onUploadComplete: () => void;
}

interface UploadProgress {
  uploadedChunks: number;
  totalChunks: number;
  speedBps: number;
  etaSeconds: number;
}

const DEFAULT_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_CONCURRENCY = 4;

export function UploadManager({ token, onUploadComplete }: UploadManagerProps) {
  const [file, setFile] = useState<File | null>(null);
  const [chunkSize, setChunkSize] = useState<number>(DEFAULT_CHUNK_SIZE);
  const [status, setStatus] = useState<string>('待機中');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [downloadLink, setDownloadLink] = useState<string | null>(null);
  const [downloadFallbackLink, setDownloadFallbackLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);
  const [finalizing, setFinalizing] = useState(false);
  const [linkExpiresAt, setLinkExpiresAt] = useState('');
  const [linkNoExpiry, setLinkNoExpiry] = useState(false);
  const [linkRequirePage, setLinkRequirePage] = useState(false);
  const [linkCreateShort, setLinkCreateShort] = useState(false);
  const [linkPassword, setLinkPassword] = useState('');
  const [linkFormError, setLinkFormError] = useState<string | null>(null);

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

  const buildAbsoluteUrl = (pathOrUrl: string | null): string | null => {
    if (!pathOrUrl) {
      return null;
    }
    if (/^https?:\/\//i.test(pathOrUrl)) {
      return pathOrUrl;
    }
    return baseDownloadUrl ? `${baseDownloadUrl}${pathOrUrl}` : pathOrUrl;
  };

  const totalChunks = useMemo(() => {
    if (!file) {
      return 0;
    }
    return Math.ceil(file.size / chunkSize);
  }, [file, chunkSize]);

  const minDatetimeLocal = useMemo(() => {
    const now = new Date();
    const offsetMs = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offsetMs).toISOString().slice(0, 16);
  }, []);

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      setFile(files[0]);
      setSessionId(null);
      setFileId(null);
      setDownloadLink(null);
      setDownloadFallbackLink(null);
      setProgress(null);
       setProgressPercent(0);
      setError(null);
      setStatus('ファイル準備完了');
      setLinkExpiresAt('');
      setLinkNoExpiry(false);
      setLinkRequirePage(false);
      setLinkCreateShort(false);
      setLinkPassword('');
      setLinkFormError(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      return;
    }
    try {
      setError(null);
      setStatus('ハッシュ計算中…');
      const fileHash = await sha256HexFromFile(file);
      const total = Math.ceil(file.size / chunkSize);

      setStatus('アップロードセッション作成中…');
      const session = await createUploadSession(token, {
        filename: file.name,
        size: file.size,
        mime_type: file.type,
        chunk_size: chunkSize,
        total_chunks: total,
        file_sha256: fileHash
      });

      const currentSessionId = session.upload_session_id;
      setSessionId(currentSessionId);

      setStatus('既存チャンク確認中…');
      const probe = await getSessionStatus(token, currentSessionId);
      const receivedSet = new Set(probe.received);
      const missing = probe.missing.length > 0 ? probe.missing : Array.from({ length: total }, (_, idx) => idx);

      let uploaded = receivedSet.size;
      const startedAt = performance.now();

      setProgress({ uploadedChunks: uploaded, totalChunks: total, speedBps: 0, etaSeconds: 0 });
      setProgressPercent(total > 0 ? Math.round((uploaded / total) * 80) : 0);
      setStatus('チャンク送信中…');

      const uploadQueue = [...missing];

      const uploadWorker = async () => {
        while (uploadQueue.length > 0) {
          const nextIndex = uploadQueue.shift();
          if (nextIndex === undefined) {
            return;
          }
          const start = nextIndex * chunkSize;
          const end = Math.min(start + chunkSize, file.size);
          const blob = file.slice(start, end);
          const checksum = await sha256HexFromBlob(blob);
          const idempotencyKey = currentSessionId + '-' + nextIndex + '-' + crypto.randomUUID();
          await uploadChunk(token, currentSessionId, nextIndex, blob, checksum, idempotencyKey);
          uploaded += 1;
          const elapsedMs = performance.now() - startedAt;
          const uploadedBytes = uploaded * chunkSize;
          const speed = elapsedMs > 0 ? uploadedBytes / (elapsedMs / 1000) : 0;
          const remainingChunks = total - uploaded;
          const eta = speed > 0 ? (remainingChunks * chunkSize) / speed : 0;
          setProgress({
            uploadedChunks: uploaded,
            totalChunks: total,
            speedBps: speed,
            etaSeconds: eta
          });
          setProgressPercent(Math.min(80, Math.round((uploaded / total) * 80)));
        }
      };

      const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, uploadQueue.length) }, () => uploadWorker());
      await Promise.all(workers);

      setStatus('Finalize 実行中…');
      setProgressPercent(90);
      setFinalizing(true);
      const finalizeResult = await finalizeSession(token, currentSessionId, fileHash);
      setFinalizing(false);
      setFileId(finalizeResult.file_id ?? null);
      setStatus('ワーカーで結合処理中…');

      if (finalizeResult.status !== 'completed') {
        for (let attempt = 0; attempt < 60; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const state = await getSessionStatus(token, currentSessionId);
          if (state.status === 'completed') {
            setStatus('アップロード完了');
            setProgressPercent(100);
            onUploadComplete();
            return;
          }
        }
      }
      setStatus('アップロード完了');
      setProgressPercent(100);
      onUploadComplete();
    } catch (err) {
      console.error(err);
      setError((err as Error).message);
      setStatus('エラーが発生しました');
      setProgressPercent(0);
    }
  };

  const handleCreateDownloadLink = async () => {
    if (!fileId) {
      return;
    }
    try {
      const payload: {
        expires_at?: string;
        no_expiry?: boolean;
        password?: string;
        require_download_page?: boolean;
        create_short_link?: boolean;
      } = {};

      if (linkNoExpiry) {
        payload.no_expiry = true;
      } else if (linkExpiresAt) {
        payload.expires_at = new Date(linkExpiresAt).toISOString();
      } else {
        setLinkFormError('有効期限を指定するか「無期限にする」にチェックを入れてください');
        return;
      }

      if (linkPassword.trim()) {
        payload.password = linkPassword.trim();
      }

      payload.require_download_page = linkRequirePage;
      payload.create_short_link = linkCreateShort;

      setLinkFormError(null);
      setCopyMessage(null);

      const result = await createDownloadLink(token, fileId, payload);
      const tokenParam = new URLSearchParams(result.url.split('?')[1] ?? '').get('token') ?? '';
      const needsDownloadPage = result.require_download_page || result.has_password;
      const downloadPath = needsDownloadPage
        ? `/share-download/${fileId}?token=${encodeURIComponent(tokenParam)}${file ? `&name=${encodeURIComponent(file.name)}` : ''}`
        : result.url;
      const primaryPath = result.short_url ?? downloadPath;
      const absolutePrimary = buildAbsoluteUrl(primaryPath);
      const absoluteFallback = result.short_url ? buildAbsoluteUrl(downloadPath) : null;
      setDownloadLink(absolutePrimary);
      setDownloadFallbackLink(absoluteFallback);
      setCopyMessage(null);
      setLinkPassword('');
      onUploadComplete();
    } catch (err) {
      console.error(err);
      setError('ダウンロードリンクの作成に失敗しました');
    }
  };

  const copyDownloadLink = async (value: string, message: string) => {
    if (!value) {
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopyMessage(message);
      window.setTimeout(() => setCopyMessage(null), 2000);
    } catch (err) {
      console.error(err);
      setCopyMessage('コピーに失敗しました');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '2rem' }}>
      <div>
        <input type="file" onChange={onFileChange} />
      </div>
      <div>
        <label>
          チャンクサイズ (バイト)
          <input
            type="number"
            value={chunkSize}
            min={1024 * 1024}
            step={1024 * 1024}
            onChange={(event) => setChunkSize(Number(event.target.value))}
            style={{ marginLeft: '0.5rem', width: '160px' }}
          />
        </label>
      </div>
      <button onClick={handleUpload} disabled={!file || finalizing} style={{ padding: '0.75rem', fontWeight: 600 }}>
        {finalizing ? 'Finalize 中…' : 'アップロード開始'}
      </button>
      <div>状態: {status}</div>
      <div>
        <progress value={progressPercent} max={100} style={{ width: '100%' }} />
        <div>{progressPercent}%</div>
      </div>
      {progress && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div>
            {progress.uploadedChunks} / {progress.totalChunks} チャンク
          </div>
          <div>
            推定速度: {(progress.speedBps / (1024 * 1024)).toFixed(2)} MiB/s / 残り {Math.ceil(progress.etaSeconds)} 秒
          </div>
        </div>
      )}
      {error && <div style={{ color: 'var(--error-color)' }}>{error}</div>}
      {fileId && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div>ファイルID: {fileId}</div>
          <div
            style={{
              border: '1px solid var(--surface-border)',
              backgroundColor: 'var(--card-bg)',
              borderRadius: '0.75rem',
              padding: '0.75rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.75rem'
            }}
          >
            <div style={{ fontWeight: 600 }}>ダウンロードリンク設定</div>
            <label>
              <span>有効期限</span>
              <input
                type="datetime-local"
                value={linkExpiresAt}
                onChange={(event) => setLinkExpiresAt(event.target.value)}
                min={minDatetimeLocal}
                disabled={linkNoExpiry}
                style={{ cursor: linkNoExpiry ? 'not-allowed' : 'text' }}
              />
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={linkNoExpiry}
                  onChange={(event) => {
                    setLinkNoExpiry(event.target.checked);
                    if (event.target.checked) {
                      setLinkExpiresAt('');
                    }
                  }}
                />
                <span>無期限にする</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={linkCreateShort}
                  onChange={(event) => setLinkCreateShort(event.target.checked)}
                />
                <span>短縮リンクを作成する</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={linkRequirePage}
                  onChange={(event) => setLinkRequirePage(event.target.checked)}
                />
                <span>ダウンロードページを用意する</span>
              </div>
            </div>
            <label>
              <span>ダウンロード用パスワード（任意）</span>
              <input
                type="password"
                value={linkPassword}
                onChange={(event) => setLinkPassword(event.target.value)}
                placeholder="未設定の場合は空欄"
                minLength={4}
              />
              <small style={{ color: 'var(--muted-text)', fontSize: '0.85rem' }}>※ 設定する場合は4文字以上で入力してください</small>
            </label>
            {linkFormError && <div style={{ color: 'var(--error-color)' }}>{linkFormError}</div>}
            <button onClick={handleCreateDownloadLink} disabled={status !== 'アップロード完了'} style={{ padding: '0.75rem', fontWeight: 600 }}>
              ダウンロードリンク作成
            </button>
          </div>
        </div>
      )}
      {downloadLink && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div
            style={{
              wordBreak: 'break-all',
              overflowWrap: 'anywhere',
              padding: '0.5rem',
              border: '1px solid var(--surface-border)',
              borderRadius: '0.5rem',
              backgroundColor: 'var(--card-bg)'
            }}
          >
            <strong style={{ display: 'block', marginBottom: '0.25rem' }}>{downloadFallbackLink ? '短縮URL' : 'ダウンロードURL'}</strong>
            <a href={downloadLink} style={{ color: 'var(--link-color)' }}>{downloadLink}</a>
          </div>
          {downloadFallbackLink && (
            <div
              style={{
                fontSize: '0.85rem',
                color: 'var(--muted-text)',
                wordBreak: 'break-all',
                overflowWrap: 'anywhere',
                padding: '0.5rem',
                border: '1px solid var(--surface-border)',
                borderRadius: '0.5rem',
                backgroundColor: 'var(--card-bg)'
              }}
            >
              <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--muted-text)' }}>ダウンロードURL</strong>
              <a href={downloadFallbackLink} style={{ color: 'var(--link-color)' }}>{downloadFallbackLink}</a>
            </div>
          )}
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            {downloadFallbackLink && (
              <button type="button" onClick={() => copyDownloadLink(downloadLink, '短縮URLをコピーしました')}>
                短縮URLをコピー
              </button>
            )}
            <button
              type="button"
              onClick={() => copyDownloadLink(downloadFallbackLink ?? downloadLink, 'ダウンロードURLをコピーしました')}
            >
              ダウンロードURLをコピー
            </button>
            {copyMessage && (
              <span
                style={{
                  color: copyMessage.includes('失敗') ? 'var(--error-color)' : 'var(--success-color)',
                  fontSize: '0.85rem'
                }}
              >
                {copyMessage}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
