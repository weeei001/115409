import apiClient from './client';
import type { MessageResponse, TokenResponse, UserPublic } from '../types/api';

/** openapi: POST /auth/register（display_name 選填） */
export async function authRegister(body: { email: string; password: string; display_name: string | null }) {
  const { data } = await apiClient.post<TokenResponse>('/auth/register', body);
  return data;
}

/** openapi: POST /auth/login */
export async function authLogin(body: { email: string; password: string }) {
  const { data } = await apiClient.post<TokenResponse>('/auth/login', body);
  return data;
}

/** openapi: POST /auth/google（Google Identity Services 回傳的 credential） */
export async function authGoogle(body: { id_token: string }) {
  const { data } = await apiClient.post<TokenResponse>('/auth/google', body);
  return data;
}

/** openapi: GET /auth/me（Bearer，由 client 自動帶） */
export async function authMe() {
  const { data } = await apiClient.get<UserPublic>('/auth/me');
  return data;
}

/** openapi: POST /auth/change-password（Bearer） */
export async function authChangePassword(body: { current_password: string; new_password: string }) {
  const { data } = await apiClient.post<MessageResponse>('/auth/change-password', body);
  return data;
}

/** openapi: POST /auth/forgot-password */
export async function authForgotPassword(body: { email: string }) {
  const { data } = await apiClient.post<MessageResponse>('/auth/forgot-password', body);
  return data;
}

/** openapi: POST /auth/reset-password */
export async function authResetPassword(body: { token: string; new_password: string }) {
  const { data } = await apiClient.post<MessageResponse>('/auth/reset-password', body);
  return data;
}
