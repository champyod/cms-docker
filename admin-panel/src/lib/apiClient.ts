export interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  data?: T;
  [key: string]: any;
}

class ApiClient {
  private async request<T = any>(
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

      const data = await resp.json();

      if (!resp.ok) {
        return {
          success: false,
          error: data.error || `HTTP error! status: ${resp.status}`,
        };
      }

      return data;
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Network error occurred',
      };
    }
  }

  async get<T = any>(path: string, options?: RequestInit) {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  async post<T = any>(path: string, body: any, options?: RequestInit) {
    return this.request<T>(path, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async put<T = any>(path: string, body: any, options?: RequestInit) {
    return this.request<T>(path, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async delete<T = any>(path: string, options?: RequestInit) {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
