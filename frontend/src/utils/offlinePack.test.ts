import 'fake-indexeddb/auto';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  saveOfflinePack,
  loadOfflinePack,
  deleteOfflinePack,
  isOfflinePackAvailable,
  listOfflinePacks,
  clearAllOfflinePacks,
} from './offlinePack';

// [Gate #36] fake-indexeddbによりjsdom上に無いIndexedDBを補う。
// crypto.subtle(AES-GCM/PBKDF2)はNode.jsのWeb Crypto実装をそのまま使う。

const TOKEN_A = 'test-access-token-A';
const TOKEN_B = 'test-access-token-B';

describe('offlinePack', () => {
  beforeEach(async () => {
    await clearAllOfflinePacks();
  });

  it('保存したプランを同じトークンで復号して読み出せる', async () => {
    const planData = { id: 'plan-1', title: 'テスト旅行', days: [{ day: 1 }] };
    await saveOfflinePack('plan-1', 'テスト旅行', planData, TOKEN_A);

    const loaded = await loadOfflinePack('plan-1', TOKEN_A);
    expect(loaded).toEqual(planData);
  });

  it('異なるトークンでは復号できずnullを返す', async () => {
    const planData = { id: 'plan-2', title: '別の旅行' };
    await saveOfflinePack('plan-2', '別の旅行', planData, TOKEN_A);

    const loaded = await loadOfflinePack('plan-2', TOKEN_B);
    expect(loaded).toBeNull();
  });

  it('保存していないプランはnullを返す', async () => {
    const loaded = await loadOfflinePack('nonexistent-plan', TOKEN_A);
    expect(loaded).toBeNull();
  });

  it('期限切れのパックは読み込み時にnullを返し、以後available判定もfalseになる', async () => {
    const planData = { id: 'plan-3', title: '期限切れテスト' };
    // ttlMsに負の値を渡し、即座に期限切れの状態を作る。
    await saveOfflinePack('plan-3', '期限切れテスト', planData, TOKEN_A, -1000);

    const loaded = await loadOfflinePack('plan-3', TOKEN_A);
    expect(loaded).toBeNull();

    const available = await isOfflinePackAvailable('plan-3');
    expect(available).toBe(false);
  });

  it('isOfflinePackAvailableは保存済みのプランに対してtrueを返す', async () => {
    await saveOfflinePack('plan-4', '確認テスト', { id: 'plan-4' }, TOKEN_A);
    const available = await isOfflinePackAvailable('plan-4');
    expect(available).toBe(true);
  });

  it('deleteOfflinePackで削除するとavailableがfalseになる', async () => {
    await saveOfflinePack('plan-5', '削除テスト', { id: 'plan-5' }, TOKEN_A);
    await deleteOfflinePack('plan-5');
    const available = await isOfflinePackAvailable('plan-5');
    expect(available).toBe(false);
  });

  it('listOfflinePacksは保存済みの全パックのサマリを返す(本文は含まない)', async () => {
    await saveOfflinePack('plan-6', '一覧テストA', { id: 'plan-6', big: 'x'.repeat(100) }, TOKEN_A);
    await saveOfflinePack('plan-7', '一覧テストB', { id: 'plan-7' }, TOKEN_A);

    const list = await listOfflinePacks();
    const ids = list.map((p) => p.planId).sort();
    expect(ids).toEqual(['plan-6', 'plan-7']);
    expect(list.every((p) => typeof p.approxSizeBytes === 'number' && p.approxSizeBytes > 0)).toBe(true);
  });

  it('clearAllOfflinePacksで全件削除できる', async () => {
    await saveOfflinePack('plan-8', 'クリアテスト', { id: 'plan-8' }, TOKEN_A);
    await clearAllOfflinePacks();
    const list = await listOfflinePacks();
    expect(list).toEqual([]);
  });

  it('同一planIdで再保存すると上書きされる', async () => {
    await saveOfflinePack('plan-9', '旧タイトル', { version: 1 }, TOKEN_A);
    await saveOfflinePack('plan-9', '新タイトル', { version: 2 }, TOKEN_A);

    const loaded = await loadOfflinePack<{ version: number }>('plan-9', TOKEN_A);
    expect(loaded?.version).toBe(2);

    const list = await listOfflinePacks();
    expect(list.filter((p) => p.planId === 'plan-9')).toHaveLength(1);
    expect(list.find((p) => p.planId === 'plan-9')?.planTitle).toBe('新タイトル');
  });
});
