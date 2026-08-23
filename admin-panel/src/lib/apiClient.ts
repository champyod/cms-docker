export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  data?: T;
  [key: string]: unknown;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '';
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

      const data: unknown = await resp.json();

      if (!resp.ok) {
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
