'use client';

import { useEffect } from 'react';

export default function LegacyDownloadFilePage({ params }: { params: { fileId: string } }) {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const query = window.location.search;
      window.location.replace('/share-download/' + params.fileId + query);
    }
  }, [params.fileId]);

  return null;
}
