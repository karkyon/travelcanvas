import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * [Gate #36] Offline Travel Pack / [Gate K1] 鍵の方式(B-008)
 *
 * fake-indexeddb で jsdom に無い IndexedDB を補い、crypto.subtle は Node の Web Crypto をそのまま使う。
 * 鍵の配布 API(GET /offline-pack/key)は差し替え、利用者・版ごとに決まった鍵を返す。
 */
const m = vi.hoisted(() => ({
  versions: new Map<string, number>(),
  offline: false,
  status: 0,
  calls: 0,
  currentUser: 'user-A',
  // [Gate G6] OFF-01 端末ごとの鍵(空なら以前の利用者ごとの鍵)
  device: '',
  expiresAt: '',
}));

function keyFor(userId: string, version: number): string {
  // 32バイトを利用者と版から決める(試験用)
  const bytes = new Uint8Array(32);
  const seed = `${userId}|${version}`;
  for (let i = 0; i < 32; i += 1) bytes[i] = (seed.charCodeAt(i % seed.length) * (i + 7)) & 0xff;
  return Buffer.from(bytes).toString('base64url');
}

vi.mock('@/services/api', () => ({
  getOfflinePackKey: vi.fn(async () => {
    m.calls += 1;
    if (m.offline) throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
    if (m.status) throw Object.assign(new Error(String(m.status)), { response: { status: m.status } });
    const version = m.versions.get(m.currentUser) ?? 1;
    if (m.device) {
      return {
        user_id: m.currentUser, key_version: version, key: keyFor(`${m.currentUser}|${m.device}`, version),
        algorithm: 'AES-256-GCM', key_bits: 256, issued_at: '2026-10-17T00:00:00Z', device_id: m.device,
        expires_at: m.expiresAt || new Date(Date.now() + 30 * 86_400_000).toISOString(),
      };
    }
    return {
      user_id: m.currentUser, key_version: version, key: keyFor(m.currentUser, version),
      algorithm: 'AES-256-GCM', key_bits: 256, issued_at: '2026-10-17T00:00:00Z',
    };
  }),
}));

import {
  saveOfflinePack, loadOfflinePack, deleteOfflinePack, isOfflinePackAvailable, listOfflinePacks, clearAllOfflinePacks,
} from './offlinePack';
import {
  forgetOfflineKeys, loadSnapshot, obtainOfflineKey, offlineDeviceId, resetOfflineKeyMemoForTesting, saveSnapshot,
  idbGet, idbPut, PACKS_STORE, META_STORE,
} from './offlineVault';

const A = (tag = 'login-1') => ({ userId: 'user-A', sessionTag: tag });
const B = { userId: 'user-B', sessionTag: 'login-b' };
const planData = { id: 'plan-1', title: 'テスト旅行', days: [{ day: 1 }] };

beforeEach(async () => {
  m.versions.clear();
  m.offline = false;
  m.status = 0;
  m.calls = 0;
  m.currentUser = 'user-A';
  m.device = '';
  m.expiresAt = '';
  await clearAllOfflinePacks();
  await forgetOfflineKeys();
});

describe('offlinePack (Gate #36 / K1)', () => {
  it('保存したプランを読み出せる。暗号文には利用者と鍵の版が付き、平文は残らない', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A());
    expect(await loadOfflinePack('plan-1', A())).toEqual(planData);
    const raw = await idbGet<Record<string, unknown>>(PACKS_STORE, 'plan-1');
    expect(raw).toMatchObject({ format: 2, userId: 'user-A', keyVersion: 1, planTitle: 'テスト旅行' });
    expect(new TextDecoder().decode(raw!.ciphertext as ArrayBuffer)).not.toContain('テスト旅行');
  });

  it('ログインし直して(別のトークンでも)同じ利用者なら読める(以前はトークンが変わると読めなかった)', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A('login-1'));
    await forgetOfflineKeys(); // ログアウト
    expect(await loadOfflinePack('plan-1', A('login-2'))).toEqual(planData); // 再ログインで鍵を受け取り直す
  });

  it('ログアウト後に通信できないと開けない(端末の鍵を消すため)', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A());
    await forgetOfflineKeys();
    m.offline = true;
    expect(await loadOfflinePack('plan-1', A('login-2'))).toBeNull();
    expect(await isOfflinePackAvailable('plan-1')).toBe(true); // 消してはいない(次にログインすれば読める)
  });

  it('通信できなくても、端末に置いた鍵で開ける(ページを読み直した後も)', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A());
    resetOfflineKeyMemoForTesting();
    m.offline = true;
    expect(await loadOfflinePack('plan-1', A('login-1'))).toEqual(planData);
  });

  it('別の利用者のパックは開かず、消しもしない', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A());
    m.currentUser = 'user-B';
    expect(await loadOfflinePack('plan-1', B)).toBeNull();
    expect(await isOfflinePackAvailable('plan-1')).toBe(true);
    expect(await listOfflinePacks('user-B')).toEqual([]);
    expect((await listOfflinePacks('user-A')).map((p) => p.planId)).toEqual(['plan-1']);
  });

  it('鍵の配布 API が別の利用者の鍵を返したら使わない', async () => {
    m.currentUser = 'user-B';
    await expect(saveOfflinePack('plan-1', 't', planData, A())).rejects.toThrow(/鍵を取得できません/);
  });

  it('失効(版が上がる)すると、古い版のパックは読めず、端末から消える', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A());
    await saveOfflinePack('plan-2', '別の旅行', { id: 'plan-2' }, A());
    m.versions.set('user-A', 2);
    expect(await loadOfflinePack('plan-1', A('login-2'))).toBeNull();
    expect(await isOfflinePackAvailable('plan-1')).toBe(false);
    expect(await isOfflinePackAvailable('plan-2')).toBe(false); // 鍵を受け取った時点でまとめて消える
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A('login-2'));
    expect(await loadOfflinePack('plan-1', A('login-2'))).toEqual(planData);
  });

  it('無効化された利用者(404)は端末の鍵も消し、開けない', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A());
    resetOfflineKeyMemoForTesting();
    m.status = 404;
    expect(await loadOfflinePack('plan-1', A())).toBeNull();
    m.status = 0;
    m.offline = true;
    expect(await obtainOfflineKey(A())).toBeNull(); // 端末の鍵も消えている
  });

  it('同じログインの間は鍵の取得を使い回す', async () => {
    await saveOfflinePack('plan-1', 't', planData, A());
    await loadOfflinePack('plan-1', A());
    await loadOfflinePack('plan-1', A());
    expect(m.calls).toBe(1);
    await loadOfflinePack('plan-1', A('login-other'));
    expect(m.calls).toBe(2);
  });

  it('改ざんされた暗号文は読まない', async () => {
    await saveOfflinePack('plan-1', 'テスト旅行', planData, A());
    const raw = await idbGet<Record<string, unknown>>(PACKS_STORE, 'plan-1');
    const bytes = new Uint8Array(raw!.ciphertext as ArrayBuffer);
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    await idbPut(PACKS_STORE, { ...raw, ciphertext: bytes.buffer });
    expect(await loadOfflinePack('plan-1', A())).toBeNull();
  });

  it('期限切れのパックは読み出し時に削除される', async () => {
    await saveOfflinePack('plan-1', 't', planData, A(), -1000);
    expect(await loadOfflinePack('plan-1', A())).toBeNull();
    expect(await isOfflinePackAvailable('plan-1')).toBe(false);
  });

  it('一覧・削除・全削除', async () => {
    await saveOfflinePack('plan-1', '旅行1', { id: 1 }, A());
    await saveOfflinePack('plan-2', '旅行2', { id: 2 }, A());
    expect((await listOfflinePacks()).map((p) => p.planTitle).sort()).toEqual(['旅行1', '旅行2']);
    await deleteOfflinePack('plan-1');
    expect((await listOfflinePacks()).map((p) => p.planId)).toEqual(['plan-2']);
    await saveSnapshot(A(), 'today:plan-2', { x: 1 });
    await clearAllOfflinePacks();
    expect(await listOfflinePacks()).toEqual([]);
    expect(await loadSnapshot(A(), 'today:plan-2')).toBeNull();
  });

  it('以前の形式(トークンから作った鍵)は、今のトークンで読めれば新しい形式で保存し直し、読めなければ消す', async () => {
    const token = 'legacy-access-token';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    await idbPut(META_STORE, { key: 'device_salt', value: Array.from(salt) });
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), 'PBKDF2', false, ['deriveKey']);
    const legacyKey = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, legacyKey, new TextEncoder().encode(JSON.stringify(planData)));
    const legacy = { planId: 'old', planTitle: '旧形式', ciphertext, iv: iv.buffer, createdAt: Date.now(), expiresAt: Date.now() + 60_000 };
    await idbPut(PACKS_STORE, legacy);
    await idbPut(PACKS_STORE, { ...legacy, planId: 'old-unreadable' });

    expect(await loadOfflinePack('old', { ...A(), legacyToken: token })).toEqual(planData);
    expect(await idbGet(PACKS_STORE, 'old')).toMatchObject({ format: 2, userId: 'user-A' }); // 保存し直した
    expect(await loadOfflinePack('old-unreadable', { ...A(), legacyToken: 'other-token' })).toBeNull();
    expect(await isOfflinePackAvailable('old-unreadable')).toBe(false); // 読めない旧形式は消す
  });
});

describe('端末ごとの鍵 (Gate G6 OFF-01)', () => {
  it('端末の鍵で保存し、同じログインの間の使い回しでも、鍵を受け取り直しても読める', async () => {
    m.device = 'dev-1';
    await saveOfflinePack('plan-1', 't', planData, A());
    expect(await loadOfflinePack('plan-1', A())).toEqual(planData); // 使い回した鍵(端末の情報を落とさない)
    expect(await idbGet(PACKS_STORE, 'plan-1')).toMatchObject({ deviceId: 'dev-1' });
    resetOfflineKeyMemoForTesting();
    expect(await loadOfflinePack('plan-1', A('login-2'))).toEqual(planData);
    await saveSnapshot(A('login-2'), 'today:plan-1', { x: 1 });
    expect(await loadSnapshot(A('login-2'), 'today:plan-1')).toMatchObject({ data: { x: 1 } });
  });

  it('以前の利用者ごとの鍵のパックは、端末の鍵を受け取った時に消す。別の端末の鍵では開かない', async () => {
    await saveOfflinePack('plan-1', 't', planData, A());
    m.device = 'dev-1';
    expect(await loadOfflinePack('plan-1', A('login-2'))).toBeNull();
    expect(await isOfflinePackAvailable('plan-1')).toBe(false);
    await saveOfflinePack('plan-2', 't', planData, A('login-2'));
    m.device = 'dev-2';
    expect(await loadOfflinePack('plan-2', A('login-3'))).toBeNull();
    expect(await isOfflinePackAvailable('plan-2')).toBe(false);
  });

  it('失効した端末(410)は保存データと鍵を消し、通信できなくても開けない', async () => {
    m.device = 'dev-1';
    await saveOfflinePack('plan-1', 't', planData, A());
    await saveSnapshot(A(), 'today:plan-1', { x: 1 });
    resetOfflineKeyMemoForTesting();
    m.status = 410;
    expect(await loadOfflinePack('plan-1', A())).toBeNull();
    expect(await isOfflinePackAvailable('plan-1')).toBe(false);
    m.status = 0;
    m.offline = true;
    expect(await obtainOfflineKey(A())).toBeNull();
    expect(await loadSnapshot(A(), 'today:plan-1')).toBeNull();
  });

  it('端末の ID は localStorage を消しても IndexedDB から戻し、失効(410)の後は作り直す', async () => {
    const first = await offlineDeviceId();
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    localStorage.clear();
    expect(await offlineDeviceId()).toBe(first);
    expect(localStorage.getItem('tc_device_id')).toBe(first);
    m.status = 410;
    resetOfflineKeyMemoForTesting();
    expect(await obtainOfflineKey(A())).toBeNull();
    expect(await offlineDeviceId()).not.toBe(first);
    m.status = 0;
  });

  it('期限の切れた端末の鍵は、通信できない時に使わない', async () => {
    m.device = 'dev-1';
    m.expiresAt = new Date(Date.now() - 1000).toISOString();
    await saveOfflinePack('plan-1', 't', planData, A());
    resetOfflineKeyMemoForTesting();
    m.offline = true;
    expect(await obtainOfflineKey(A())).toBeNull();
    m.offline = false;
    m.expiresAt = '';
    expect(await loadOfflinePack('plan-1', A())).toEqual(planData); // 通信できれば受け取り直して読める
  });
});

describe('snapshots (Gate K1: 当日画面の保存)', () => {
  it('利用者ごとに暗号化して保存し、別の利用者からは読めない', async () => {
    expect(await saveSnapshot(A(), 'today:p1', { payload: 'x' })).toBe(true);
    expect(await loadSnapshot(A(), 'today:p1')).toMatchObject({ data: { payload: 'x' } });
    m.currentUser = 'user-B';
    expect(await loadSnapshot(B, 'today:p1')).toBeNull();
  });

  it('鍵が得られないと保存しない(平文で残さない)', async () => {
    m.offline = true;
    expect(await saveSnapshot(A(), 'today:p1', { payload: 'x' })).toBe(false);
    expect(await saveSnapshot(null, 'today:p1', { payload: 'x' })).toBe(false);
  });
});
