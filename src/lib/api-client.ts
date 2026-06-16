/**
 * API Client for calling backend endpoints.
 *
 * Usage:
 *   import { api, createAuthenticatedApiClient } from '@/lib/api-client';
 *
 *   // Public requests
 *   const data = await api.get('/api/items');
 *
 *   // Authenticated requests (requires wallet connection)
 *   const authApi = createAuthenticatedApiClient(token, walletAddress);
 *   const data = await authApi.post('/api/items', { name: 'New Item' });
 */

import { PARTYSERVER_URL, getPoofAPIHeaders } from './config';

function getApiBaseUrl(path?: string): string {
  const protocol = PARTYSERVER_URL.includes('localhost') ? 'http' : 'https';
  const base = `${protocol}://${PARTYSERVER_URL}`;
  return path ? `${base}${path}` : base;
}

interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string; details?: any };
  timestamp: number;
  requestId?: string;
}

class ApiClient {
  private defaultHeaders: Record<string, string>;

  constructor(private token?: string, private walletAddress?: string) {
    this.defaultHeaders = {
      'Content-Type': 'application/json',
      ...getPoofAPIHeaders(),
    };
  }

  private async request<T = any>(method: string, path: string, body?: any): Promise<T> {
    const headers: Record<string, string> = { ...this.defaultHeaders };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    if (this.walletAddress) {
      headers['X-Wallet-Address'] = this.walletAddress;
    }

    const response = await fetch(getApiBaseUrl(path), {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const json: ApiResponse<T> = await response.json();

    if (!json.success) {
      throw new Error(json.error?.message || `API error: ${response.status}`);
    }

    return json.data as T;
  }

  async get<T = any>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  async post<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  async put<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T = any>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  async patch<T = any>(path: string, body?: any): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
}

/** Public API client (no auth) */
export const api = new ApiClient();

/**
 * Create an authenticated API client.
 * @param token - JWT token from wallet auth
 * @param walletAddress - User's wallet address
 */
export function createAuthenticatedApiClient(token: string, walletAddress: string): ApiClient {
  return new ApiClient(token, walletAddress);
}

export default api;
