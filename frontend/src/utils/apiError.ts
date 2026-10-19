/**
 * [Gate A2] API の失敗の理由(画面に出す文)。backend の detail は 文字列・検証の一覧・{code, message} のいずれか。
 */
import { extractApiErrorDetailMessage } from '@/services/api';

export function apiErrorMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null | undefined)?.response?.data?.detail;
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return extractApiErrorDetailMessage(detail) ?? fallback;
}
