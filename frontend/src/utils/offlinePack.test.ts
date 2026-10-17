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
  forgetOfflineKeys, loadSnapshot, obtainOfflineKey, resetOfflineKeyMemoForTesting, saveSnapshot,
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
