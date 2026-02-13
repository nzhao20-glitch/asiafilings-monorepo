'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios, { AxiosError } from 'axios';
import Cookies from 'js-cookie';

interface User {
  id: string;
  email: string;
  fullName: string;
  organization: string;
  role: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string, organization: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// Create axios instance
const api = axios.create({
  baseURL: API_URL,
  withCredentials: true,
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Function to refresh access token
  const refreshToken = useCallback(async () => {
    try {
      const response = await api.post('/api/auth/refresh');
      const newAccessToken = response.data.data.accessToken;
      setAccessToken(newAccessToken);
      Cookies.set('accessToken', newAccessToken, { expires: 1/3 }); // 8 hours
      return newAccessToken;
    } catch (error) {
      // Only log refresh errors if we expected to have a session
      if (axios.isAxiosError(error) && error.response?.status !== 401) {
        console.error('Failed to refresh token:', error);
      }
      setUser(null);
      setAccessToken(null);
      Cookies.remove('accessToken');
      throw error;
    }
  }, []);

  // Setup axios interceptors
  useEffect(() => {
    // Request interceptor to add auth header
    const requestInterceptor = api.interceptors.request.use(
      (config) => {
        const token = accessToken || Cookies.get('accessToken');
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor to handle token refresh
    const responseInterceptor = api.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const originalRequest = error.config as any;

        // Only attempt refresh if we have an access token and haven't retried yet
        if (error.response?.status === 401 && !originalRequest._retry && (accessToken || Cookies.get('accessToken'))) {
          originalRequest._retry = true;

          try {
            const newAccessToken = await refreshToken();
            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
            return api(originalRequest);
          } catch (refreshError) {
            // Only redirect if we're not already on an auth page
            if (!window.location.pathname.includes('/login') && !window.location.pathname.includes('/register')) {
              window.location.href = '/login';
            }
            return Promise.reject(refreshError);
          }
        }

        return Promise.reject(error);
      }
    );

    return () => {
      api.interceptors.request.eject(requestInterceptor);
      api.interceptors.response.eject(responseInterceptor);
    };
  }, [accessToken, refreshToken]);

  // Check if user is already logged in on mount
  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      const storedToken = Cookies.get('accessToken');

      if (storedToken) {
        setAccessToken(storedToken);

        try {
          const response = await api.get('/api/auth/me', {
            headers: { Authorization: `Bearer ${storedToken}` }
          });
          if (isMounted) {
            setUser(response.data.data);
          }
        } catch (error) {
          // Token might be expired, try to refresh
          try {
            await refreshToken();
            const response = await api.get('/api/auth/me');
            if (isMounted) {
              setUser(response.data.data);
            }
          } catch (refreshError) {
            // Unable to authenticate, clear everything (silently)
            if (isMounted) {
              setUser(null);
              setAccessToken(null);
              Cookies.remove('accessToken');
            }
          }
        }
      }

      if (isMounted) {
        setIsLoading(false);
      }
    };

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [refreshToken]);

  // Automatic token refresh - refresh every 7 hours (before 8 hour expiration)
  useEffect(() => {
    if (!user || !accessToken) {
      return; // Don't set up refresh interval if not logged in
    }

    // Refresh token every 7 hours (7 * 60 * 60 * 1000 milliseconds)
    const refreshInterval = setInterval(() => {
      console.log('Auto-refreshing token...');
      refreshToken().catch((error) => {
        console.error('Auto-refresh failed:', error);
      });
    }, 7 * 60 * 60 * 1000); // 7 hours

    return () => {
      clearInterval(refreshInterval);
    };
  }, [user, accessToken, refreshToken]);

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/api/auth/login', { email, password });
      const { user, accessToken } = response.data.data;

      setUser(user);
      setAccessToken(accessToken);
      Cookies.set('accessToken', accessToken, { expires: 1/3 }); // 8 hours
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(error.response?.data?.error?.message || 'Login failed');
      }
      throw error;
    }
  };

  const register = async (email: string, password: string, fullName: string, organization: string) => {
    try {
      const response = await api.post('/api/auth/register', {
        email,
        password,
        fullName,
        organization,
      });
      const { user, accessToken } = response.data.data;

      setUser(user);
      setAccessToken(accessToken);
      Cookies.set('accessToken', accessToken, { expires: 1/3 }); // 8 hours
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(error.response?.data?.error?.message || 'Registration failed');
      }
      throw error;
    }
  };

  const logout = async () => {
    try {
      await api.post('/api/auth/logout');
    } catch (error) {
      console.error('Logout error:', error);
    } finally {
      setUser(null);
      setAccessToken(null);
      Cookies.remove('accessToken');
      window.location.href = '/login';
    }
  };

  const value = {
    user,
    accessToken,
    isLoading,
    login,
    register,
    logout,
    refreshToken,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// Export the api instance for use in other parts of the app
export { api };