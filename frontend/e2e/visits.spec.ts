import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';
import { apiClient } from './support/api';

/**
 * [Gate V2] FR-049 Visited Area Layer・FR-050 訪問判定・信頼度・FR-051 訪問訂正・Privacy除外の browser E2E。
 *
 * ゲストで旅行を作り、今日と明日(Asia/Tokyo)の日程と位置のある予定(清水寺・京都駅)を用意する。
 * 「暗号化してサーバーへ」の軌跡に、清水寺で12分の滞在と、京都駅を速く通り過ぎた点を入れて次を確かめる。
 *   1. 判定する前は「予定」。判定すると清水寺は「滞在」(要確認)、京都駅は「通過」。自動では確定しない
 *   2. 清水寺を「行った(確定)」にすると「確認済みの訪問」になる(If-Match の版で守る)
 *   3. 清水寺を地図から隠すと一覧の既定の表示から消え、Atlas にも清水寺での軌跡が出ない。隠すのをやめられる
 *   4. 京都駅を「行っていない」に直すと「予定」に戻る
 *   5. 画面に axe(WCAG 2.1 AA)違反が無い
 */
function tokyoDate(offsetDays: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

const KYOTO = { lat: 34.9948, lng: 135.785 };
const STATION = { lat: 34.9858, lng: 135.7588 };

test('訪問の地図: 軌跡から判定し、確定・地図から隠す(Atlas からも除く)・行っていない、に直せる', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `V2訪問E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: tokyoDate(0), timezone_id: 'Asia/Tokyo' }) as { id: string };
  await send('post', `/plans/${planId}/days`, { local_date: tokyoDate(1), timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${planId}/events`, {
    day_id: day.id, title: '清水寺', event_type: 'sightseeing', latitude: KYOTO.lat, longitude: KYOTO.lng, local_start_time: '10:00',
  });
  await send('post', `/plans/${planId}/events`, {
    day_id: day.id, title: '京都駅', event_type: 'transportation', latitude: STATION.lat, longitude: STATION.lng, local_start_time: '15:00',
  });
  await send('put', '/privacy/consents', { consents: { location: true } });
  const track = await send('post', `/plans/${planId}/location-tracks`, { mode: 'synced', precision: 'high' }) as { id: string };
  const t0 = Date.now() + 60_000;
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  const stay = [0, 2, 4, 6, 8, 10, 12].map((m) => ({ recorded_at: at(m), latitude: 34.9950, longitude: 135.785, accuracy_m: 10 }));
  const passing = [
    { recorded_at: at(30), latitude: 34.9858, longitude: 135.7561, accuracy_m: 12 },
    { recorded_at: at(30.5), latitude: 34.9858, longitude: 135.7615, accuracy_m: 12 },
  ];
  const up = await send('post', `/plans/${planId}/location-tracks/${track.id}/points`, {
    batch_id: crypto.randomUUID(), points: [...stay, ...passing],
  }) as { accepted: number };
  expect(up.accepted).toBe(9);

  // 1. 判定する前は「予定」。判定すると滞在・通過
  await page.goto(`/planner/${planId}/visits`);
  await expect(page.getByRole('heading', { name: '訪問の地図', level: 1 })).toBeVisible();
  const kiyomizu = page.getByRole('article', { name: '清水寺' });
  const station = page.getByRole('article', { name: '京都駅' });
  await expect(kiyomizu.getByTestId('layer-state')).toHaveText('○ 予定');
  await expect(page.getByRole('img', { name: /訪問の地図\(略図\)。表示中 2件/ })).toBeVisible();
  await expectNoAxeViolations(page, '訪問の地図(判定の前)');

  const assess = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/plans/${planId}/visits/assess`));
  await page.getByRole('region', { name: '訪問の判定' }).getByRole('button', { name: '判定する' }).click();
  expect((await assess).status()).toBe(200);
  await expect(page.getByRole('status')).toContainText('判定しました(新しい判定 2件・変わった判定 0件)');
  await expect(kiyomizu.getByTestId('layer-state')).toHaveText('◆ 滞在');
  await expect(kiyomizu.getByText('確認してください')).toBeVisible();
  await expect(kiyomizu).toContainText('訪問の可能性');
  await expect(kiyomizu).toContainText('滞在 12分');
  await expect(station.getByTestId('layer-state')).toHaveText('◌ 通過');
  await expect(station).toContainText('速く移動していたため通過と判定');
  await expectNoAxeViolations(page, '訪問の地図(判定の後)');

  // 2. 確定
  await kiyomizu.getByRole('button', { name: '清水寺: 行った(確定)' }).click();
  await expect(page.getByRole('status')).toHaveText('清水寺: 「行った」と確定しました');
  await expect(kiyomizu.getByTestId('layer-state')).toHaveText('✓ 確認済みの訪問');
  await expect(kiyomizu).toContainText('あなたが決めた');
  await expect(kiyomizu.getByText('確認してください')).toHaveCount(0);

  // 3. 地図から隠す → Atlas でも清水寺での軌跡を出さない
  const atlasTrackCount = async () => {
    const atlas = await send('get', '/atlas') as { cells: Array<{ key: string; evidence: Record<string, number> }> };
    return atlas.cells.find((c) => c.key === '0.1:34.9:135.7')?.evidence.track ?? 0;
  };
  expect(await atlasTrackCount()).toBe(9);
  await kiyomizu.getByRole('button', { name: '清水寺: 地図から隠す' }).click();
  await expect(page.getByRole('status')).toHaveText('清水寺: 地図と Atlas から隠しました');
  await expect(kiyomizu).toHaveCount(0);
  await expect(page.getByRole('img', { name: /訪問の地図\(略図\)。表示中 1件/ })).toBeVisible();
  expect(await atlasTrackCount()).toBe(2);
  await page.getByRole('checkbox', { name: /非表示\(1件\)/ }).check();
  await expect(kiyomizu).toContainText('地図と Atlas から隠しています');
  await kiyomizu.getByRole('button', { name: '清水寺: 隠すのをやめる' }).click();
  await expect(kiyomizu.getByTestId('layer-state')).toHaveText('✓ 確認済みの訪問');
  expect(await atlasTrackCount()).toBe(9);

  // 4. 行っていない
  await station.getByRole('button', { name: '京都駅: 行っていない' }).click();
  await expect(page.getByRole('status')).toHaveText('京都駅: 「行っていない」に直しました');
  await expect(station.getByTestId('layer-state')).toHaveText('○ 予定');
  await expect(station).toContainText('行っていない');
  await expectNoAxeViolations(page, '訪問の地図(訂正の後)');
});
