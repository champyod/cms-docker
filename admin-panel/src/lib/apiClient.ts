import { withBasePath } from '@/lib/base-path';

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
  [key: string]: unknown;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
}

let hasRedirectedToLogin = false;

function handleUnauthorizedRedirect(): void {
  if (hasRedirectedToLogin) return;
  hasRedirectedToLogin = true;
  try {
    document.cookie = 'session=; Max-Age=0; path=/; SameSite=Lax';
  } catch {
    // Cookie deletion may fail if blocked
  }
  if (typeof window !== 'undefined') {
    // Why: the authenticated header owns navigation, so expiry routes through its router, not a hard reload.
    window.dispatchEvent(new CustomEvent('cms-authentication-expired'));
  }
}

class ApiClient {
  private async request<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const defaultHeaders: Record<string, string> = {};
      if (!(options.body instanceof FormData)) {
        defaultHeaders['Content-Type'] = 'application/json';
      }

      const resp = await fetch(withBasePath(path), {
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.headers,
        },
      });

      const data: unknown = await resp.json().catch(() => ({}));

      if (!resp.ok) {
        // Why: 401 means session expired or permission revoked — clear polling and redirect once to login
        if (resp.status === 401) {
          handleUnauthorizedRedirect();
        }
        const payload =
          typeof data === 'object' && data !== null
            ? (data as Record<string, unknown>)
            : {};
        const serverMessage =
          typeof payload.error === 'string' ? payload.error : undefined;
        return {
          success: false,
          error: serverMessage || `HTTP error! status: ${resp.status}`,
          errors: payload.errors,
        };
      }

      return data as ApiResponse<T>;
    } catch (err: unknown) {
      return {
        success: false,
        error: getErrorMessage(err) || 'Network error occurred',
      };
    }
  }

  async get<T = unknown>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  async post<T = unknown>(path: string, body: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async postFormData<T = unknown>(path: string, formData: FormData, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: formData,
    });
  }

  async put<T = unknown>(path: string, body: unknown, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async delete<T = unknown>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
