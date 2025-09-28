const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '/api';

export interface ApiUser {
  id: string;
  email: string;
  is_admin: boolean;
  is_active: boolean;
  quota_bytes: number | null;
  used_bytes: number;
  created_at: string;
  updated_at: string;
}

export interface ApiDownloadLink {
  id: string;
  url: string;
  expires_at: string | null;
  download_count: number;
  never_expires: boolean;
  require_download_page: boolean;
  has_password: boolean;
  short_url: string | null;
}

export interface ApiFile {
  id: string;
  filename: string;
  size: number;
  mime_type: string | null;
  sha256: string;
  status: string;
  created_at: string;
  owner_id: string | null;
  owner_email: string | null;
  links: ApiDownloadLink[];
}

async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (!(options.body instanceof FormData) && !headers.has('Content-Type') && options.method && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', 'Bearer ' + token);
  }
  const response = await fetch(API_BASE_URL + path, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed (' + response.status + ')');
  }

  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (contentType.includes('application/json')) {
    return (await response.json()) as T;
  }
  return (await response.text()) as T;
}

export async function login(username: string, password: string, rememberMe = false) {
  return apiFetch<{ access_token: string; expires_at: string; user: ApiUser }>(
    '/auth/token',
    {
      method: 'POST',
      body: JSON.stringify({ username, password, remember_me: rememberMe })
    }
  );
}

export async function register(email: string, password: string) {
  return apiFetch<{ message: string }>(
    '/auth/register',
    {
      method: 'POST',
      body: JSON.stringify({ email, password })
    }
  );
}

export async function getCurrentUser(token: string) {
  return apiFetch<ApiUser>(
    '/auth/me',
    {
      method: 'GET'
    },
    token
  );
}

export async function changePassword(token: string, payload: { current_password: string; new_password: string }) {
  return apiFetch<{ message: string }>(
    '/auth/password',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function createUploadSession(
  token: string,
  payload: {
    filename: string;
    size: number;
    mime_type?: string;
    chunk_size: number;
    total_chunks: number;
    file_sha256: string;
  }
) {
  return apiFetch<{ upload_session_id: string; accepted_chunk_size: number; expires_at: string }>(
    '/upload/sessions',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function getSessionStatus(token: string, sessionId: string) {
  return apiFetch<{ received: number[]; missing: number[]; status: string }>(
    '/upload/sessions/' + sessionId,
    {
      method: 'GET'
    },
    token
  );
}

export async function uploadChunk(
  token: string,
  sessionId: string,
  index: number,
  chunk: Blob,
  checksum: string,
  idempotencyKey: string
): Promise<void> {
  const headers = new Headers();
  headers.set('Content-Type', 'application/octet-stream');
  headers.set('X-Chunk-Size', String(chunk.size));
  headers.set('X-Chunk-Checksum', checksum);
  headers.set('Idempotency-Key', idempotencyKey);
  headers.set('Authorization', 'Bearer ' + token);

  const response = await fetch(API_BASE_URL + '/upload/sessions/' + sessionId + '/chunk/' + index, {
    method: 'PUT',
    headers,
    body: chunk
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Chunk upload failed (' + response.status + ')');
  }
}

export async function finalizeSession(token: string, sessionId: string, fileSha: string) {
  return apiFetch<{ upload_session_id: string; file_id?: string; status: string }>(
    '/upload/sessions/' + sessionId + '/finalize',
    {
      method: 'POST',
      body: JSON.stringify({ file_sha256: fileSha })
    },
    token
  );
}

export interface CreateDownloadLinkPayload {
  expires_in_minutes?: number | null;
  expires_at?: string | null;
  no_expiry?: boolean;
  password?: string;
  require_download_page?: boolean;
  create_short_link?: boolean;
}

export async function createDownloadLink(token: string, fileId: string, payload: CreateDownloadLinkPayload) {
  return apiFetch<{
    id: string;
    url: string;
    expires_at: string | null;
    download_count: number;
    never_expires: boolean;
    require_download_page: boolean;
    has_password: boolean;
    short_url: string | null;
  }>(
    '/files/' + fileId + '/links',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function listFiles(token: string, ownerId?: string) {
  const query = ownerId ? `?owner_id=${ownerId}` : '';
  return apiFetch<{ files: ApiFile[] }>(`/files/${query}`, { method: 'GET' }, token);
}

export async function deleteFile(token: string, fileId: string) {
  return apiFetch<void>(`/files/${fileId}`, { method: 'DELETE' }, token);
}

export async function deleteDownloadLink(token: string, fileId: string, linkId: string) {
  return apiFetch<void>(`/files/${fileId}/links/${linkId}`, { method: 'DELETE' }, token);
}

export async function listUsers(token: string) {
  return apiFetch<{ users: ApiUser[] }>(
    '/admin/users/',
    {
      method: 'GET'
    },
    token
  );
}

export async function adminCreateUser(token: string, payload: { email: string; password: string; quota_bytes?: number | null; is_admin?: boolean; is_active?: boolean }) {
  return apiFetch<ApiUser>(
    '/admin/users/',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function adminUpdateUser(
  token: string,
  userId: string,
  payload: { is_active?: boolean; quota_bytes?: number | null; password?: string }
) {
  return apiFetch<ApiUser>(
    `/admin/users/${userId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload)
    },
    token
  );
}

export async function adminDeleteUser(token: string, userId: string) {
  return apiFetch<void>(`/admin/users/${userId}`, { method: 'DELETE' }, token);
}
