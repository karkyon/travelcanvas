/** [Gate Receipt] レシートの読み取り。後から読む画面だけが使うので、ここを直接 import する。画像はサーバーに保存されない。 */
import { api } from './index';

export interface ReceiptField { value: string; confidence: number; evidence: string }
export interface ReceiptResult {
  fields: Partial<Record<'title' | 'local_date' | 'amount' | 'currency' | 'tax_amount' | 'category', ReceiptField>>;
  ai_status: 'off' | 'not_needed' | 'used' | 'denied';
  ai_message: string | null;
  warnings: string[];
}

export async function extractReceipt(planId: string, file: File, aiConsent: boolean): Promise<ReceiptResult> {
  const form = new FormData();
  form.append('file', file);
  form.append('ai_consent', String(aiConsent));
  return (await api.post(`/plans/${planId}/expenses/extract-receipt`, form, {
    skipGlobalErrorHandler: true, headers: { 'Content-Type': undefined },
  })).data as ReceiptResult;
}
