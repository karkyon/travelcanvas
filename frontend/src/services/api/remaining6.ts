/**
 * [Gate Remaining-6] FR-052 テーマで絞った Atlas。最初に読む JS を小さく保つため、後から読む画面だけが import する。
 * [Gate Remaining-7] 第7弾の API もここに置く(塊を増やすと最初に読む JS の一覧が伸びるため)。
 * - FR-016 制約の変更の取り消し / FR-002 ゲストを既存のアカウントへまとめる / FR-054 予定の経路と軌跡の比べ
 * - FR-011 Gmail の連携 / FR-003 passkey
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeResponse } from './decode';
import type { AtlasPrecision, AtlasResponse } from './types/atlas';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export async function getAtlasThemed(precision: AtlasPrecision, year: number | null, theme: string | null): Promise<AtlasResponse> {
  const params: Record<string, string | number> = { precision };
  if (year) params.year = year;
  if (theme) params.theme = theme;
  const r = await api.get('/atlas', { ...SILENT, params });
  return decodeResponse(r.data, (await import('./decoders')).atlasResponse, 'GET /atlas');
}


// ---- FR-016
export async function undoConstraintChange(planId: string, undoId: string): Promise<{ message: string; deleted: boolean }> {
  return (await api.post(`/plans/${encodeURIComponent(planId)}/constraints/undo/${encodeURIComponent(undoId)}`, null, SILENT))
    .data as { message: string; deleted: boolean };
}

// ---- FR-002
export interface GuestMergeResult {
  access_token: string;
  user: Record<string, unknown>;
  merge: { moved_total: number; kept_total: number };
}
export async function mergeGuestIntoAccount(email: string, password: string, mfaCode: string | undefined,
  guestToken: string): Promise<GuestMergeResult> {
  return (await api.post('/auth/guest/merge', { email, password, mfa_code: mfaCode || null },
    { ...SILENT, headers: { Authorization: `Bearer ${guestToken}` } })).data as GuestMergeResult;
}

// ---- FR-054
export interface TrackComparison {
  track_id: string;
  days: string[];
  algorithm_version: string;
  events: Array<{ event_id: string; title: string; date: string; planned_time: string | null; radius_m: number;
    nearest_m: number | null; nearest_at: string | null; reached: boolean }>;
  summary: { planned_count: number; reached_count: number; skipped: string[]; planned_distance_km: number;
    actual_distance_km: number; points: number; off_route_ratio: number | null; max_deviation_m: number | null;
    off_route_threshold_m: number };
  unplanned_stops: Array<{ from: string; to: string; minutes: number; latitude: number; longitude: number }>;
  planned_route: Array<{ event_id: string; title: string; date: string; latitude: number; longitude: number }>;
}
export async function getTrackComparison(planId: string, trackId: string): Promise<TrackComparison> {
  return (await api.get(`/plans/${encodeURIComponent(planId)}/location-tracks/${encodeURIComponent(trackId)}/comparison`,
    SILENT)).data as TrackComparison;
}

// ---- FR-011
export interface GmailStatus {
  available: boolean; connected: boolean; google_email: string | null; last_sync_at: string | null;
  imported_count: number; last_error: string | null; scope: string; max_messages: number;
}
export const getGmailStatus = async (): Promise<GmailStatus> =>
  (await api.get('/integrations/gmail', SILENT)).data as GmailStatus;
export const connectGmail = async (planId?: string): Promise<{ authorize_url: string }> =>
  (await api.post('/integrations/gmail/connect', { plan_id: planId ?? null }, SILENT)).data as { authorize_url: string };
export const syncGmail = async (planId: string, days = 30): Promise<GmailStatus & { messages: number; jobs: number }> =>
  (await api.post('/integrations/gmail/sync', { plan_id: planId, days }, SILENT)).data as GmailStatus & { messages: number; jobs: number };
export const disconnectGmail = async (): Promise<GmailStatus> =>
  (await api.delete('/integrations/gmail', SILENT)).data as GmailStatus;

// ---- FR-003
export interface PasskeyItem { id: string; name: string; created_at: string | null; last_used_at: string | null; backed_up: boolean }
export const listPasskeys = async (): Promise<{ passkeys: PasskeyItem[]; rp_id: string }> =>
  (await api.get('/auth/passkeys', SILENT)).data as { passkeys: PasskeyItem[]; rp_id: string };
export const deletePasskey = async (id: string): Promise<void> => {
  await api.delete(`/auth/passkeys/${encodeURIComponent(id)}`, SILENT);
};

function b64ToBuf(text: string): ArrayBuffer {
  const s = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function bufToB64(buf: ArrayBuffer | null): string | null {
  if (!buf) return null;
  const bytes = new Uint8Array(buf);
  let bin = '';
  bytes.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function passkeySupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function'
    && typeof navigator !== 'undefined' && !!navigator.credentials;
}

type Json = Record<string, unknown>;

/** passkey を作る(端末の画面で本人の確認をする)。 */
export async function registerPasskey(name: string): Promise<PasskeyItem> {
  const { options, state } = (await api.post('/auth/passkeys/register/options', null, SILENT)).data as { options: Json; state: string };
  const user = options.user as Json;
  const publicKey = {
    ...options,
    challenge: b64ToBuf(String(options.challenge)),
    user: { ...user, id: b64ToBuf(String(user.id)) },
    excludeCredentials: ((options.excludeCredentials as Json[] | undefined) ?? []).map((c) => ({ ...c, id: b64ToBuf(String(c.id)) })),
  } as unknown as PublicKeyCredentialCreationOptions;
  const cred = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
  if (!cred) throw new Error('passkey を作れませんでした');
  const res = cred.response as AuthenticatorAttestationResponse;
  const credential = {
    id: cred.id, rawId: bufToB64(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufToB64(res.clientDataJSON), attestationObject: bufToB64(res.attestationObject),
      transports: typeof res.getTransports === 'function' ? res.getTransports() : undefined,
    },
  };
  return (await api.post('/auth/passkeys/register', { state, credential, name }, SILENT)).data as PasskeyItem;
}

/** passkey でログインする(端末に入っている passkey を選ぶ)。応答はログインと同じ形(access_token・user)。 */
export async function loginWithPasskey(): Promise<{ access_token: string; user: Record<string, unknown> }> {
  const { options, state } = (await api.post('/auth/passkeys/login/options', null, SILENT)).data as { options: Json; state: string };
  const publicKey = {
    ...options,
    challenge: b64ToBuf(String(options.challenge)),
    allowCredentials: ((options.allowCredentials as Json[] | undefined) ?? []).map((c) => ({ ...c, id: b64ToBuf(String(c.id)) })),
  } as unknown as PublicKeyCredentialRequestOptions;
  const cred = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
  if (!cred) throw new Error('passkey を選べませんでした');
  const res = cred.response as AuthenticatorAssertionResponse;
  const credential = {
    id: cred.id, rawId: bufToB64(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufToB64(res.clientDataJSON), authenticatorData: bufToB64(res.authenticatorData),
      signature: bufToB64(res.signature), userHandle: bufToB64(res.userHandle),
    },
  };
  return (await api.post('/auth/passkeys/login', { state, credential }, SILENT)).data as { access_token: string; user: Record<string, unknown> };
}
