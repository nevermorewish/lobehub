export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const api = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Request': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new APIError(response.status, 'unavailable', 'Service unavailable');
  }
  const result: { success: boolean; data: T; code?: string; message?: string } =
    await response.json();
  if (!response.ok || !result.success) {
    if (response.status === 401 && !path.startsWith('/api/auth/'))
      window.dispatchEvent(new Event('admin:unauthorized'));
    throw new APIError(
      response.status,
      result.code ?? 'operation_failed',
      result.message ?? 'Request failed',
    );
  }
  return result.data;
};
