'use client';

import { useEffect } from 'react';

export default function LegacyDownloadPage() {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const query = window.location.search;
      window.location.replace('/share-download' + query);
    }
  }, []);

  return null;
}
