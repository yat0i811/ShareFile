'use client';

import { useEffect, useState } from 'react';

import { DownloadForm } from '../../components/DownloadForm';

type QueryState = {
  fileId: string;
  token: string;
  fileNameParam: string;
};

function readQuery(): QueryState {
  if (typeof window === 'undefined') {
    return { fileId: '', token: '', fileNameParam: '' };
  }
  const search = new URLSearchParams(window.location.search);
  return {
    fileId: search.get('file') ?? '',
    token: search.get('token') ?? '',
    fileNameParam: search.get('name') ?? ''
  };
}

export default function ShareDownloadPage() {
  const [state, setState] = useState<QueryState | null>(null);

  useEffect(() => {
    setState(readQuery());
  }, []);

  if (!state) {
    return null;
  }

  return <DownloadForm {...state} />;
}
