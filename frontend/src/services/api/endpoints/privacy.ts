/**
 * アカウントの削除・同意の撤回(FR-039)
 *
 * [Gate P9] backend/app/api/v1/privacy.py。/privacy/account-deletion・/privacy/consents。
 * 削除は取り消せないため、確認の文字と(登録ユーザーは)パスワードを送る。
 * 失敗は各画面が理由を表示するため、共通エラー処理(toast・401時の/login遷移)を通さない(auth.tsと同じ)。
 * [Gate G2] FR-040 サポートへの閲覧の許可(/privacy/support-grants。本人だけが作る・取り消す。パスワードで本人確認)。
 */
import type { AxiosRequestConfig } from 'axios';
import { CalendarImportApi } from './calendarImport';
import type {
  AccountDeletionPreview, AccountDeletionResult, ConsentPurpose, ConsentState, SupportGrant, SupportGrantInput,
  SupportGrantList,
} from '../types';
import { decodeResponse } from '../decode';
import type { G2Types } from '../decodersG2';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class PrivacyApi extends CalendarImportApi {
  async getConsents(): Promise<ConsentState> {
    const response = await this.client.get('/privacy/consents', SILENT);
    return decodeResponse(response.data, (await DL()).consentState, 'GET /privacy/consents');
  }

  async updateConsents(consents: Partial<Record<ConsentPurpose, boolean>>): Promise<ConsentState> {
    const response = await this.client.put('/privacy/consents', { consents }, SILENT);
    return decodeResponse(response.data, (await DL()).consentState, 'PUT /privacy/consents');
  }

  async getAccountDeletionPreview(): Promise<AccountDeletionPreview> {
    const response = await this.client.get('/privacy/account-deletion', SILENT);
    return decodeResponse(response.data, (await DL()).accountDeletionPreview, 'GET /privacy/account-deletion');
  }

  async deleteAccount(confirmation: string, password?: string): Promise<AccountDeletionResult> {
    const body = password ? { confirmation, password } : { confirmation };
    const response = await this.client.post('/privacy/account-deletion', body, SILENT);
    return decodeResponse(response.data, (await DL()).accountDeletionResult, 'POST /privacy/account-deletion');
  }

  /** [Gate G2] 応答の検証(decoder は使う時に読み込む。最初に読む JS を小さく保つため) */
  protected async g2<K extends keyof G2Types>(req: Promise<{ data: unknown }>, key: K): Promise<G2Types[K]> {
    const [response, { decodeG2 }] = await Promise.all([req, import('../decodersG2')]);
    return decodeG2(key, response.data);
  }

  getSupportGrants(): Promise<SupportGrantList> {
    return this.g2(this.client.get('/privacy/support-grants', SILENT), 'supportGrantList');
  }

  createSupportGrant(input: SupportGrantInput): Promise<SupportGrant> {
    return this.g2(this.client.post('/privacy/support-grants', input, SILENT), 'supportGrant');
  }

  revokeSupportGrant(grantId: string): Promise<SupportGrant> {
    return this.g2(this.client.post(`/privacy/support-grants/${grantId}/revoke`, {}, SILENT), 'supportGrant');
  }
}
