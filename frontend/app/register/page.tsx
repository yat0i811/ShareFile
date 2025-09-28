'use client';

import Link from 'next/link';

import { RegisterForm } from '../../components/RegisterForm';

export default function RegisterPage() {
  return (
    <main
      style={{
        maxWidth: '1080px',
        margin: '0 auto',
        padding: '2rem',
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        gap: '2rem'
      }}
    >
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <h1 style={{ margin: 0 }}>ShareFile</h1>
        <Link href="/" style={{ color: 'var(--link-color)' }}>
          ログインへ戻る
        </Link>
      </header>
      <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ width: '100%', maxWidth: '400px' }}>
          <RegisterForm />
          <div style={{ marginTop: '1rem', textAlign: 'center', fontSize: '0.9rem' }}>
            すでにアカウントをお持ちの方は{' '}
            <Link href="/" style={{ color: 'var(--link-color)', textDecoration: 'underline' }}>
              ログイン画面へ
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
