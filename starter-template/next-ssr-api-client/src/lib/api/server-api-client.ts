import { cookies } from 'next/headers';

interface ApiResponse<T> {
  code: number;
  message?: string;
  data: T;
}

function getApiBaseUrl() {
  return (
    process.env.INTERNAL_API_URL ||
    process.env.NEXT_PUBLIC_API_BASE_URL ||
    'http://localhost:3000/api'
  );
}

async function buildHeaders() {
  const cookieStore = await cookies();
  const token = cookieStore.get('auth_token')?.value;

  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export async function serverGet<T>(path: string, revalidate: number | false = 30): Promise<T> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method: 'GET',
    headers: await buildHeaders(),
    next: { revalidate: revalidate === false ? 0 : revalidate },
  });

  if (!res.ok) {
    throw new Error(`[server-api-client] ${path} -> HTTP ${res.status}`);
  }

  const json = (await res.json()) as ApiResponse<T>;
  if (json.code !== 10000 && json.code !== 200) {
    throw new Error(`[server-api-client] ${path} -> ${json.message || 'API error'}`);
  }

  return json.data;
}

