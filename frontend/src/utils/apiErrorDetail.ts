/**
 * [Gate B-013] APIエラー応答のdetailを画面表示用の文字列にする。
 *
 * backendのdetailは文字列のほか、構造化された409(`{code, message, ...}`)や
 * 入力検証の422(配列)の場合がある。オブジェクトをそのままReactの子要素に渡すと
 * 描画が例外で止まるため、文字列かmessageだけを取り出し、無ければ既定文言にする。
 */
export function errorDetailMessage(error: unknown, fallback: string): string {
  const detail = (error as { response?: { data?: { detail?: unknown } } } | null | undefined)?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim() !== '') return detail;
  if (typeof detail === 'object' && detail !== null && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim() !== '') return message;
  }
  return fallback;
}
