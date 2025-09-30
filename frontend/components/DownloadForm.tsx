'use client';

import { useMemo, useState, type FormEvent } from 'react';

interface DownloadFormProps {
  fileId: string;
  token: string;
  fileNameParam: string;
}

export function DownloadForm({ fileId, token, fileNameParam }: DownloadFormProps) {
  const decodedFileName = useMemo(() => {
    try {
      return fileNameParam ? decodeURIComponent(fileNameParam) : '';
    } catch {
      return fileNameParam;
    }
  }, [fileNameParam]);

  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!fileId || !token) {
    return (
      <main style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
        <section
          style={{
            maxWidth: '480px',
            width: '100%',
            backgroundColor: 'var(--card-bg)',
            border: '1px solid var(--surface-border)',
            borderRadius: '0.75rem',
            padding: '1.5rem',
            boxShadow: '0 6px 20px var(--shadow-color)'
          }}
        >
          <h1 style={{ marginTop: 0 }}>リンクが不正です</h1>
          <p>必要な情報が見つかりませんでした。リンクを再確認してください。</p>
        </section>
      </main>
    );
  }

  const downloadEndpoint = '/d/' + fileId;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const search = new URLSearchParams({ token });
    if (password.trim()) {
      search.set('password', password.trim());
    }
    const url = downloadEndpoint + '?' + search.toString();
    setSubmitting(true);
    window.location.href = url;
    window.setTimeout(() => {
      setSubmitting(false);
    }, 800);
  };

  const hintText = password ? '入力したパスワードでファイルをダウンロードします。' : 'パスワード不要の場合はそのままダウンロードできます。';

  return (
    <main style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
      <section
        style={{
          maxWidth: '480px',
          width: '100%',
          backgroundColor: 'var(--card-bg)',
          border: '1px solid var(--surface-border)',
          borderRadius: '0.75rem',
          padding: '2rem',
          boxShadow: '0 10px 30px var(--shadow-color)',
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem'
        }}
      >
        <h1 style={{ margin: 0 }}>ファイルダウンロード</h1>
        {decodedFileName && <p style={{ margin: 0, color: 'var(--muted-text)' }}>ファイル名: {decodedFileName}</p>}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span>ダウンロード用パスワード</span>
              <input
                type='password'
                name='password'
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder='設定されていない場合は空欄のまま'
                autoComplete='off'
                minLength={4}
              />
              <small style={{ color: 'var(--muted-text)', fontSize: '0.85rem' }}>※ パスワードが設定されている場合は4文字以上で入力されています</small>
            </label>
            <small>{hintText}</small>
          </div>
          <button type='submit' disabled={submitting}>
            {submitting ? '準備中…' : 'ダウンロード開始'}
          </button>
        </form>
        <div style={{ fontSize: '0.85rem', color: 'var(--muted-text)' }}>
          <p style={{ margin: 0 }}>パスワードが正しくない場合、ダウンロードは開始されません。</p>
        </div>
      </section>
    </main>
  );
}
