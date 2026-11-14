/** [Gate Remaining-6] FR-003 パスワードの再設定(忘れた時)・メールの確認。後から読む画面だけが import する */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export async function requestPasswordReset(email: string): Promise<{ email_available: boolean; message: string }> {
  return (await api.post('/auth/password/forgot', { email }, SILENT)).data as { email_available: boolean; message: string };
}

export async function resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
  return (await api.post('/auth/password/reset', { token, new_password: newPassword }, SILENT)).data as { message: string };
}

export async function requestEmailVerification(): Promise<{ accepted: boolean; verified: boolean; email_available: boolean; message: string }> {
  return (await api.post('/auth/email/verify/request', null, SILENT)).data as {
    accepted: boolean; verified: boolean; email_available: boolean; message: string;
  };
}

export async function verifyEmail(token: string): Promise<{ verified: boolean; message: string }> {
  return (await api.post('/auth/email/verify', { token }, SILENT)).data as { verified: boolean; message: string };
}
