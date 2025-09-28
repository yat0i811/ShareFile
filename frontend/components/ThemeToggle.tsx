'use client';

import type { CSSProperties } from 'react';

import { useTheme } from './ThemeProvider';

interface ThemeToggleProps {
  style?: CSSProperties;
}

export function ThemeToggle({ style }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      type="button"
      onClick={toggleTheme}
      style={{ padding: '0.4rem 0.75rem', width: '100%', ...style }}
    >
      {theme === 'dark' ? 'ライトモードに切替' : 'ダークモードに切替'}
    </button>
  );
}
