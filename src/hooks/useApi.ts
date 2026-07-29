import { useState, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';

export type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

const MAX_RETRIES = 2;
const RETRY_DELAY = 1200;

export function useApi() {
  const { token } = useAuth();

  const authHeaders = useCallback((): HeadersInit => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }), [token]);

  const request = useCallback(async <T>(
    url: string,
    options: RequestInit = {},
    retries = MAX_RETRIES,
  ): Promise<T> => {
    const base = (window as any).__API_BASE__ || '';
    try {
      const res = await fetch(`${base}${url}`, {
        ...options,
        headers: { ...authHeaders(), ...(options.headers || {}) },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      return res.json() as Promise<T>;
    } catch (e: any) {
      const isNetwork = e instanceof TypeError || /network|fetch|ECONNRESET|timeout/i.test(e.message);
      if (isNetwork && retries > 0) {
        await new Promise(r => setTimeout(r, RETRY_DELAY));
        return request<T>(url, options, retries - 1);
      }
      throw e;
    }
  }, [authHeaders]);

  const get = useCallback(<T>(url: string) => request<T>(url), [request]);
  const post = useCallback(<T>(url: string, body: unknown) =>
    request<T>(url, { method: 'POST', body: JSON.stringify(body) }), [request]);
  const put = useCallback(<T>(url: string, body: unknown) =>
    request<T>(url, { method: 'PUT', body: JSON.stringify(body) }), [request]);
  const del = useCallback(<T>(url: string) =>
    request<T>(url, { method: 'DELETE' }), [request]);

  return { get, post, put, del };
}

export function useResource<T>(initial: T) {
  const [state, setState] = useState<ApiState<T>>({ data: initial, loading: false, error: null });
  const setLoading = () => setState(s => ({ ...s, loading: true, error: null }));
  const setData = (data: T) => setState({ data, loading: false, error: null });
  const setError = (error: string) => setState(s => ({ ...s, loading: false, error }));
  return { state, setLoading, setData, setError };
}
