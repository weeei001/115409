import apiClient from './client';
import type { AuthTokenResponse, UserPublic } from '../types';

export interface RegisterBody {
  email: string;
  password: string;
  display_name?: string | null;
}

export async function authRegister(body: RegisterBody): Promise<AuthTokenResponse> {
  const { data } = await apiClient.post<AuthTokenResponse>('/auth/register', body);
  return data;
}

export async function authLogin(body: { email: string; password: string }): Promise<AuthTokenResponse> {
  const { data } = await apiClient.post<AuthTokenResponse>('/auth/login', body);
  return data;
}

export async function authGoogle(body: { id_token: string }): Promise<AuthTokenResponse> {
  const { data } = await apiClient.post<AuthTokenResponse>('/auth/google', body);
  return data;
}

export async function authMe(): Promise<UserPublic> {
  const { data } = await apiClient.get<UserPublic>('/auth/me');
  return data;
}
