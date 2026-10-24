/**
 * [Gate G6] OFF-01 端末ごとのオフラインの鍵・LOC-02 守る範囲・MEM-01 旅行記の公開と記録の削除の取り消し の API。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、CompleteTravelAPI には足さず、使う画面
 * (どれも後から読む塊)がここを直接 import する(g4.ts・g5.ts と同じ形)。画面の中で失敗を案内するため、共通のエラーの
 * toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeG6 } from './decodersG6';
import type {
  MemoryPublication, MemoryTrashItem, OfflineDevice, OfflineDeviceList, PrivacyZone, PrivacyZoneInput,
  PrivacyZoneList, PublicJournal, PublicationPreview, PublishOptions,
} from './types/g6';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

// ===== OFF-01
export async function getOfflineDevices(currentDeviceId?: string): Promise<OfflineDeviceList> {
  const r = await api.get('/offline-pack/devices', { ...SILENT, params: currentDeviceId ? { device_id: currentDeviceId } : undefined });
  return decodeG6('offlineDevices', r.data);
}

export async function revokeOfflineDevice(deviceRef: string): Promise<OfflineDevice> {
  return decodeG6('offlineDevice', (await api.post(`/offline-pack/devices/${deviceRef}/revoke`, null, SILENT)).data);
}

// ===== LOC-02
export async function getPrivacyZones(): Promise<PrivacyZoneList> {
  return decodeG6('privacyZones', (await api.get('/privacy-zones', SILENT)).data);
}

export async function createPrivacyZone(input: PrivacyZoneInput): Promise<PrivacyZone> {
  return decodeG6('privacyZone', (await api.post('/privacy-zones', input, SILENT)).data);
}

export async function deletePrivacyZone(zoneId: string): Promise<void> {
  await api.delete(`/privacy-zones/${zoneId}`, SILENT);
}

// ===== MEM-01
export async function previewPublication(planId: string, options: PublishOptions): Promise<PublicationPreview> {
  const r = await api.post(`/plans/${planId}/memories/publications/preview`, options, SILENT);
  return decodeG6('publicationPreview', r.data);
}

export async function createPublication(planId: string, options: PublishOptions): Promise<MemoryPublication> {
  return decodeG6('publication', (await api.post(`/plans/${planId}/memories/publications`, options, SILENT)).data);
}

export async function getPublications(planId: string): Promise<MemoryPublication[]> {
  return decodeG6('publications', (await api.get(`/plans/${planId}/memories/publications`, SILENT)).data);
}

export async function revokePublication(planId: string, publicationId: string): Promise<MemoryPublication> {
  const r = await api.delete(`/plans/${planId}/memories/publications/${publicationId}`, SILENT);
  return decodeG6('publication', r.data);
}

export async function getMemoryTrash(planId: string): Promise<MemoryTrashItem[]> {
  return decodeG6('trash', (await api.get(`/plans/${planId}/memories/trash`, SILENT)).data);
}

export async function restoreMemory(planId: string, memoryId: string): Promise<void> {
  await api.post(`/plans/${planId}/memories/${memoryId}/restore`, null, SILENT);
}

// ===== 公開の旅行記(資格情報なしで見られる)
export async function getPublicJournal(token: string): Promise<PublicJournal> {
  return decodeG6('publicJournal', (await api.get(`/public/journal/${token}`, SILENT)).data);
}

export async function getPublicJournalPhoto(token: string, memoryId: string): Promise<Blob> {
  const r = await api.get(`/public/journal/${token}/photos/${memoryId}`, { ...SILENT, responseType: 'blob' });
  return r.data as Blob;
}
