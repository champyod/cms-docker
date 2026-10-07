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

function getLocaleForRedirect(): string {
  if (typeof window !== 'undefined') {
    const segments = window.location.pathname.split('/');
    const candidate = segments[1];
    if (candidate && /^[a-z]{2}(-[A-Z]{2})?$/i.test(candidate)) {
      return candidate;
    }
  }
  return 'en';
}

function handleUnauthorizedRedirect(): void {
  if (hasRedirectedToLogin) return;
  hasRedirectedToLogin = true;
  try {
    document.cookie = 'session=; Max-Age=0; path=/; SameSite=Lax';
  } catch {
    // Cookie deletion may fail if blocked; redirect still proceeds
  }
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent('cms-authentication-expired'));
    } catch {
      // Event dispatch may fail in constrained environments; redirect still proceeds
    }
    const locale = getLocaleForRedirect();
    window.location.href = `/${locale}/auth/login`;
  }
}

class ApiClient {
  private async request<T = unknown>(
    path: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    try {
      const resp = await fetch(path, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
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

  async get<T = unknown>(path: string, options?: RequestInit) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  async post<T = unknown>(path: string, body: unknown, options?: RequestInit) {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async put<T = unknown>(path: string, body: unknown, options?: RequestInit) {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async delete<T = unknown>(path: string, options?: RequestInit) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
