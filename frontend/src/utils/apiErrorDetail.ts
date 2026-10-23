/**
 * [Gate B-013] APIエラー応答のdetailを画面表示用の文字列にする。
 *
 * backendのdetailは文字列のほか、構造化された409(`{code, message, ...}`)や
 * 入力検証の422(配列)の場合がある。オブジェクトをそのままReactの子要素に渡すと
 * 描画が例外で止まるため、文字列かmessageだけを取り出し、無ければ既定文言にする。
 */
export function errorDetailMessage(error: unknown, fallback: string): string {
  const response = (error as { response?: { status?: number; data?: { detail?: unknown; request_id?: unknown } } }
    | null | undefined)?.response;
  const detail = response?.data?.detail;
  let message = fallback;
  if (typeof detail === 'string' && detail.trim() !== '') message = detail;
  else if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string' && m.trim() !== '') message = m;
  }
  // [Gate G3] UX-04 サーバーの不具合(5xx)は問い合わせ番号を添える(サポートがサーバーのログを探せる)
  const supportId = errorSupportId(error);
  if (supportId && (response?.status ?? 0) >= 500) return `${message}(問い合わせ番号: ${supportId})`;
  return message;
}

/**
 * [Gate G3] UX-04 エラーの応答の問い合わせ番号(backend の request_id・X-Request-ID)。表示用に先頭8文字。無ければ null。
 */
export function errorSupportId(error: unknown): string | null {
  const response = (error as { response?: { data?: { request_id?: unknown }; headers?: Record<string, unknown> } }
    | null | undefined)?.response;
  const raw = response?.data?.request_id ?? response?.headers?.['x-request-id'];
  if (typeof raw !== 'string' || !/^[0-9a-f-]{8,64}$/i.test(raw)) return null;
  return raw.slice(0, 8);
}

/**
 * [Gate G3] UX-04 再試行の可否(backend の retry)。'later' = 時間をおいて、'after_reload' = 読み直してから、'no' = 直さない限り同じ。
 */
export function errorRetry(error: unknown): 'later' | 'after_reload' | 'no' | null {
  const raw = (error as { response?: { data?: { retry?: unknown } } } | null | undefined)?.response?.data?.retry;
  return raw === 'later' || raw === 'after_reload' || raw === 'no' ? raw : null;
}
