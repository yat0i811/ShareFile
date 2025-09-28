import './globals.css';
import type { Metadata } from 'next';

import { ThemeProvider } from '../components/ThemeProvider';

export const metadata: Metadata = {
  title: 'ShareFile',
  description: 'Chunked upload manager'
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
