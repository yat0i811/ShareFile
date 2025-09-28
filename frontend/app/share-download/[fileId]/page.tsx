'use client';

import { useEffect, useState } from 'react';

import { DownloadForm } from '../../../components/DownloadForm';

type QueryState = {
  fileId: string;
  token: string;
  fileNameParam: string;
};

function readQuery(fileId: string): QueryState {
  if (typeof window === 'undefined') {
    return { fileId, token: '', fileNameParam: '' };
  }
  const search = new URLSearchParams(window.location.search);
  return {
    fileId,
    token: search.get('token') ?? '',
    fileNameParam: search.get('name') ?? ''
  };
}

export default function ShareDownloadByIdPage({ params }: { params: { fileId: string } }) {
  const [state, setState] = useState<QueryState | null>(null);

  useEffect(() => {
    setState(readQuery(params.fileId));
  }, [params.fileId]);

  if (!state) {
    return null;
  }

  return <DownloadForm {...state} />;
}
