/**
 * [Gate R2-4] POST /quick-drafts (作成) 専用のAPIクライアント。
 *
 * services/api.ts の `CompleteTravelAPI.client` は、既存のguest/member
 * セッションが存在する場合、request interceptorが無条件で
 * `Authorization: Bearer <session token>` を上書き付与する
 * (setupInterceptors参照)。QuickDraft作成はanonymous device token
 * (Authorization: Bearer <device-token>、無ければ未指定でbootstrap)を
 * 使う設計のため、そのinterceptorを経由しない独立したaxios instanceを
 * 使う(ADR-quick-draft.md参照)。
 *
 * promote(所有権をuser/guestへ移す処理)は逆にuser/guestのAuthorizationが
 * 必須のため、こちらは services/api.ts 側の `api.promoteQuickDraft()`
 * (既存のthis.clientをそのまま使う)を用いる。
 */
import axios from 'axios';

export interface QuickDraftEventInput {
  title: string;
  local_date?: string;
  start_time?: string;
  description?: string;
}

export interface QuickDraftCreatePayload {
  title?: string;
  start_date: string;
  end_date: string;
  events: QuickDraftEventInput[];
}

export interface QuickDraftCreateResponse {
  id: string;
  revision: number;
  status: string;
  expires_at: string;
  title?: string;
  start_date: string;
  end_date: string;
  events: QuickDraftEventInput[];
  device_token?: string;
}

const DEVICE_TOKEN_STORAGE_KEY = 'travelcanvas_quickdraft_device_token';

export function getStoredDeviceToken(): string | null {
  try {
    return localStorage.getItem(DEVICE_TOKEN_STORAGE_KEY);
  } catch {
    // localStorage無効環境(プライベートブラウジング等)ではnullを返し、
    // 毎回anonymous bootstrapさせる(機能自体は継続動作する)。
    return null;
  }
}

function storeDeviceToken(token: string): void {
  try {
    localStorage.setItem(DEVICE_TOKEN_STORAGE_KEY, token);
  } catch {
    // 保存できなくても致命的ではない(次回また新規device発行される)。
  }
}

function resolveApiBaseUrl(): string {
  // [Gate R2-6] services/api.ts (resolveBaseURL付近)はVITE_API_BASE_URLと
  // VITE_API_URLの両方をfallback順に見るが、本ファイルは従来
  // VITE_API_BASE_URLしか見ておらず、docker-compose.ymlがbuild引数として
  // 実際に注入するのはVITE_API_URLの方だった(frontend.build.args参照)。
  // そのため本番相当のDockerビルドでは常にハードコード既定値
  // 'http://localhost:8001'へフォールバックしてしまう不整合があった
  // (omega-dev2では既定値と実際のbackendアドレスが偶然一致するため、
  // これまで症状が表面化していなかった)。api.ts と同じ優先順位に揃える。
  const raw =
    import.meta.env.VITE_API_BASE_URL ||
    import.meta.env.VITE_API_URL ||
    'http://localhost:8001';
  const trimmed = raw.replace(/\/+$/, '');
  return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

const anonymousClient = axios.create({
  baseURL: resolveApiBaseUrl(),
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

export async function createQuickDraft(
  payload: QuickDraftCreatePayload,
  idempotencyKey: string,
): Promise<QuickDraftCreateResponse> {
  const deviceToken = getStoredDeviceToken();
  const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey };
  if (deviceToken) {
    headers['Authorization'] = `Bearer ${deviceToken}`;
  }
  const response = await anonymousClient.post<QuickDraftCreateResponse>(
    '/quick-drafts',
    payload,
    { headers },
  );
  if (response.data.device_token) {
    storeDeviceToken(response.data.device_token);
  }
  return response.data;
}
