/**
 * [Gate G4] 検索のコマンド・場所の例外の日・合意の採用・通知の設定・ゲストの閲覧・濫用の対応の API。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、CompleteTravelAPI には足さず、
 * 使う画面(どれも後から読む塊)がここを直接 import する。通信は共通のクライアント(api.get 等。認証・再試行・
 * 共通のエラー処理を通る)を使う。画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeResponse } from './decode';
import { placeInfo } from './decoders';
import { decodeG4 } from './decodersG4';
import type { PlaceEntrance, PlaceInfo, SpecialHoursItem, DayHours } from './types/candidates';
import type { CommandList, CommandPreview, CommandResult, CommandUndoResult } from './types/planSearch';
import type {
  AbuseReason, AbuseReportList, AdoptInput, AdoptionPreview, AdoptResult, NotificationDigest, NotificationLevel,
  NotificationPrefs, ShareCloneResult, ShareInfo, GuestShareView,
} from './types/g4';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const ifMatch = (revision: number, extra: Record<string, string> = {}): AxiosRequestConfig =>
  ({ ...SILENT, headers: { 'If-Match': String(revision), ...extra } });

// ===== MAP-02 場所の例外の日・入口・その日の営業時間
export async function putSpecialHours(placeId: string, items: SpecialHoursItem[], revision: number): Promise<PlaceInfo> {
  const r = await api.put(`/places/${placeId}/special-hours`, { items }, ifMatch(revision));
  return decodeResponse(r.data, placeInfo, 'PUT /places/{place_id}/special-hours');
}

export async function putEntrances(placeId: string, entrances: PlaceEntrance[], revision: number): Promise<PlaceInfo> {
  const body = entrances.map(({ label, latitude, longitude, note, accessible }) => ({ label, latitude, longitude, note, accessible }));
  const r = await api.put(`/places/${placeId}/entrances`, { entrances: body }, ifMatch(revision));
  return decodeResponse(r.data, placeInfo, 'PUT /places/{place_id}/entrances');
}

export async function getDayHours(placeId: string, date: string): Promise<DayHours> {
  const r = await api.get(`/places/${placeId}/hours?date=${encodeURIComponent(date)}`, SILENT);
  return decodeG4('dayHours', r.data);
}

// ===== MAP-03 検索のコマンド
export async function getCommands(planId: string): Promise<CommandList> {
  return decodeG4('commandList', (await api.get(`/plans/${planId}/commands`, SILENT)).data);
}

export async function previewCommand(planId: string, text: string): Promise<CommandPreview> {
  return decodeG4('commandPreview', (await api.post(`/plans/${planId}/commands/preview`, { text }, SILENT)).data);
}

export async function executeCommand(planId: string, text: string, revision: number, idempotencyKey: string): Promise<CommandResult> {
  const r = await api.post(`/plans/${planId}/commands/execute`, { text }, ifMatch(revision, { 'Idempotency-Key': idempotencyKey }));
  return decodeG4('commandResult', r.data);
}

export async function undoCommand(planId: string, runId: string, revision: number): Promise<CommandUndoResult> {
  return decodeG4('commandUndo', (await api.post(`/plans/${planId}/commands/${runId}/undo`, null, ifMatch(revision))).data);
}

// ===== COL-02 投票の決定の採用
export async function adoptionPreview(planId: string, pollId: string, input: AdoptInput): Promise<AdoptionPreview> {
  return decodeG4('adoptionPreview', (await api.post(`/plans/${planId}/polls/${pollId}/adoption-preview`, input, SILENT)).data);
}

export async function adoptPoll(planId: string, pollId: string, input: AdoptInput, revision: number): Promise<AdoptResult> {
  return decodeG4('adoptResult', (await api.post(`/plans/${planId}/polls/${pollId}/adopt`, input, ifMatch(revision))).data);
}

export async function undoAdoptPoll(planId: string, pollId: string, revision: number): Promise<AdoptResult> {
  return decodeG4('adoptResult', (await api.post(`/plans/${planId}/polls/${pollId}/adopt/undo`, null, ifMatch(revision))).data);
}

// ===== COL-03 通知の設定・まとめ
export async function getNotificationSettings(): Promise<NotificationPrefs> {
  return decodeG4('notificationSettings', (await api.get('/notifications/settings', SILENT)).data);
}

export async function putNotificationSettings(input: { level?: NotificationLevel; email_digest?: 'off' | 'daily' }): Promise<NotificationPrefs> {
  return decodeG4('notificationSettings', (await api.put('/notifications/settings', input, SILENT)).data);
}

export async function putPlanNotificationLevel(planId: string, level: NotificationLevel): Promise<NotificationPrefs> {
  return decodeG4('notificationSettings', (await api.put(`/notifications/settings/plans/${planId}`, { level }, SILENT)).data);
}

export async function deletePlanNotificationLevel(planId: string): Promise<NotificationPrefs> {
  return decodeG4('notificationSettings', (await api.delete(`/notifications/settings/plans/${planId}`, SILENT)).data);
}

export async function getNotificationDigest(): Promise<NotificationDigest> {
  return decodeG4('notificationDigest', (await api.get('/notifications/digest', SILENT)).data);
}

// ===== COL-05 ゲストの閲覧(使用回数を使わない確認・見直し・複製)/ FC-097 通報
const enc = encodeURIComponent;

export async function getShareInfo(token: string): Promise<ShareInfo> {
  return decodeG4('shareInfo', (await api.get(`/public/share/${enc(token)}/info`, SILENT)).data);
}

export async function getShareView(token: string, viewToken: string): Promise<GuestShareView> {
  const r = await api.get(`/public/share/${enc(token)}/view`, { ...SILENT, headers: { 'X-Share-View': viewToken } });
  return decodeG4('publicShareView', r.data);
}

export async function cloneShare(token: string, viewToken: string, title?: string): Promise<ShareCloneResult> {
  const r = await api.post(`/public/share/${enc(token)}/clone`, title ? { title } : {},
    { ...SILENT, headers: { 'X-Share-View': viewToken } });
  return decodeG4('shareClone', r.data);
}

export async function reportShare(token: string, reason: AbuseReason, note?: string): Promise<void> {
  await api.post(`/public/share/${enc(token)}/report`, note ? { reason, note } : { reason }, SILENT);
}

export async function getAbuseReports(status: 'open' | 'dismissed' | 'actioned' | 'all' = 'open'): Promise<AbuseReportList> {
  return decodeG4('abuseReports', (await api.get(`/admin/abuse?status=${status}`, SILENT)).data);
}

export async function actOnAbuseReport(reportId: string, action: 'dismiss' | 'revoke_share' | 'restore_share',
  note?: string): Promise<void> {
  await api.post(`/admin/abuse/${reportId}/action`, note ? { action, note } : { action }, SILENT);
}
