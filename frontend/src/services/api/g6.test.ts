/** [Gate G6] 応答の decoder(実 backend の応答を受理し、形が違えば ApiDecodeError)と API の呼び方(URL・パラメータ)。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fx from './__fixtures__/g6Responses.json';
import { decodeResponse } from './decode';
import { offlinePackKey, syncConflictList } from './decoders';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('./index', () => ({ api }));

import { decodeG6 } from './decodersG6';
import {
  createPrivacyZone, getOfflineDevices, getPublicJournal, getPublicJournalPhoto, previewPublication, restoreMemory,
  revokeOfflineDevice, revokePublication,
} from './g6';

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe('decodersG6 (実 backend の応答)', () => {
  it('端末・守る範囲・旅行記の公開・削除した記録を受理する', () => {
    expect(decodeG6('offlineDevices', fx.offline_devices).devices[0]!.is_current).toBe(true);
    expect(decodeG6('offlineDevice', fx.offline_device_revoked).revoked_at).not.toBeNull();
    expect(decodeG6('privacyZone', fx.privacy_zone).readable).toBe(true);
    expect(decodeG6('privacyZones', fx.privacy_zones).zones).toHaveLength(1);
    const pre = decodeG6('publicationPreview', fx.publication_preview);
    expect(pre.required_acknowledgements.map((a) => a.code)).toContain('place_names');
    expect(JSON.stringify(pre)).not.toContain('34.9949');
    expect(decodeG6('publication', fx.publication_created).is_active).toBe(true);
    expect(decodeG6('publications', fx.publications)).toHaveLength(1);
    expect(decodeG6('publication', fx.publication_revoked).is_active).toBe(false);
    expect(decodeG6('trash', fx.memory_trash)[0]!.summary).toBe('消して戻すメモ');
    const pub = decodeG6('publicJournal', fx.public_journal);
    expect(pub.title).toBe('京都の旅行記');
    expect(JSON.stringify(pub)).not.toMatch(/"latitude":\s*\d/);
    // 端末の鍵の応答も、以前の decoder で読める(端末の項目を足しても壊さない)
    const key = decodeResponse(fx.offline_key_device, offlinePackKey, 'GET /offline-pack/key');
    expect(key.device_id).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('形が違えば受理しない', () => {
    expect(() => decodeG6('privacyZone', { ...fx.privacy_zone, radius_m: '300' })).toThrow();
    expect(() => decodeG6('publication', { ...fx.publication_created, location_level: 'exact' })).toThrow();
    expect(() => decodeG6('offlineDevices', { devices: [{ ...fx.offline_devices.devices[0], is_current: 'yes' }], max_devices: 10 }))
      .toThrow();
  });

  it('[OFF-02] 日程・並びの競合を受理する(並べ替えの操作・対象の種類。実 backend の応答)', () => {
    const list = decodeResponse(fx.sync_conflicts_day_order, syncConflictList, 'GET /plans/{plan_id}/sync/conflicts');
    expect(list.conflicts.map((c) => [c.entity_type, c.action])).toEqual([['day', 'update'], ['order', 'reorder']]);
  });
});

describe('g6 API', () => {
  it('URL・パラメータ・共通の toast を出さない指定', async () => {
    api.get.mockResolvedValueOnce({ data: fx.offline_devices });
    await getOfflineDevices('dev-1');
    expect(api.get).toHaveBeenCalledWith('/offline-pack/devices',
      expect.objectContaining({ params: { device_id: 'dev-1' }, skipGlobalErrorHandler: true }));
    api.post.mockResolvedValueOnce({ data: fx.offline_device_revoked });
    await revokeOfflineDevice('d1');
    expect(api.post).toHaveBeenCalledWith('/offline-pack/devices/d1/revoke', null, expect.objectContaining({ skipGlobalErrorHandler: true }));
    api.post.mockResolvedValueOnce({ data: fx.privacy_zone });
    await createPrivacyZone({ label: '自宅', latitude: 35, longitude: 135, radius_m: 300 });
    expect(api.post).toHaveBeenLastCalledWith('/privacy-zones', { label: '自宅', latitude: 35, longitude: 135, radius_m: 300 },
      expect.anything());
    api.post.mockResolvedValueOnce({ data: fx.publication_preview });
    await previewPublication('p1', { location_level: 'area', include_photos: true });
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/memories/publications/preview',
      { location_level: 'area', include_photos: true }, expect.anything());
    api.delete.mockResolvedValueOnce({ data: fx.publication_revoked });
    await revokePublication('p1', 'pub1');
    expect(api.delete).toHaveBeenCalledWith('/plans/p1/memories/publications/pub1', expect.anything());
    api.post.mockResolvedValueOnce({ data: { memory_id: 'm', restored: true } });
    await restoreMemory('p1', 'm1');
    expect(api.post).toHaveBeenLastCalledWith('/plans/p1/memories/m1/restore', null, expect.anything());
    api.get.mockResolvedValueOnce({ data: fx.public_journal });
    await getPublicJournal('tok');
    expect(api.get).toHaveBeenLastCalledWith('/public/journal/tok', expect.objectContaining({ skipGlobalErrorHandler: true }));
    api.get.mockResolvedValueOnce({ data: new Blob(['x']) });
    await getPublicJournalPhoto('tok', 'm1');
    expect(api.get).toHaveBeenLastCalledWith('/public/journal/tok/photos/m1', expect.objectContaining({ responseType: 'blob' }));
  });
});
