import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';
import { apiClient } from './support/api';

/**
 * [Gate L5] FR-055 Local-first Location(CA-013)・FR-056 適応型GPS(CA-014)の browser E2E。
 *
 * ゲストで旅行を作り、今日と明日(Asia/Tokyo)の日程を用意して次を確かめる。
 *   1. 位置の扱いを選ぶまでは記録を始められない。「訪問地域だけ同期」を選んで始める
 *   2. 電池が少ない(擬似)と省電力の段階になる。「今の場所を記録」で手動の点を残せる
 *   3. 「今すぐ送る」で区画だけが送られ、座標は送られない(要求の本文を検査)
 *   4. ほかの画面では、記録中の軌跡があることを上部に示す
 *   5. 記録を止めると記録の状態(欠測率・手動の記録)が軌跡に残り、軌跡を開くとサーバーにあるのは区画だけと示す
 *   6. 旅の地図(Atlas)に区画が載る
 *   7. 「記録しない」にすると始められない。各画面に axe(WCAG 2.1 AA)違反が無い
 */
function tokyoDate(offsetDays: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function lowBattery(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'getBattery', {
      configurable: true,
      value: async () => ({ level: 0.15, charging: false, addEventListener: () => undefined }),
    });
  });
}

test('位置の扱い: 訪問地域だけ同期で記録し、座標を送らず区画だけを送り、省電力・手動の記録・常時表示が働く', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.9948, longitude: 135.785, accuracy: 10 });
  await lowBattery(page);
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `L5位置E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  for (const offset of [0, 1]) {
    await send('post', `/plans/${planId}/days`, { local_date: tokyoDate(offset), timezone_id: 'Asia/Tokyo' });
  }
  await send('put', '/privacy/consents', { consents: { location: true } });

  // 1. 位置の扱いを選ぶ
  await page.goto(`/planner/${planId}/track`);
  const settings = page.getByRole('region', { name: 'この旅行での位置の扱い' });
  const start = page.getByRole('region', { name: '記録を始める' });
  await expect(settings).toContainText('まだ選んでいません');
  await expect(start.getByRole('button', { name: '記録を始める' })).toBeDisabled();
  await settings.getByLabel(/訪問地域だけ同期/).check();
  await settings.getByRole('button', { name: '位置の扱いを保存' }).click();
  await expect(page.getByRole('status')).toHaveText('位置の扱いを保存しました');
  await expectNoAxeViolations(page, '位置の扱い');
  await start.getByRole('button', { name: '記録を始める' }).click();

  // 2. 省電力の段階・手動の記録
  const panel = page.getByRole('region', { name: '記録中の軌跡' });
  await expect(panel.getByText('● 位置を記録しています')).toBeVisible();
  await expect(panel.getByTestId('sampling-tier')).toHaveText('取得の間隔: 電池が少ないため省電力');
  await expect(panel).toContainText('電池: 15%');
  await expect(panel).toContainText('この画面で記録した点: 1件');
  await context.setGeolocation({ latitude: 34.9968, longitude: 135.787, accuracy: 10 });
  await panel.getByRole('button', { name: '今の場所を記録' }).click();
  await expect(panel).toContainText('この画面で記録した点: 2件');
  await expectNoAxeViolations(page, '記録中(訪問地域だけ同期)');

  // 3. 区画だけを送る
  const upload = page.waitForRequest((r) => /\/area-cells$/.test(new URL(r.url()).pathname));
  await panel.getByRole('button', { name: '今すぐ送る' }).click();
  const body = (await upload).postDataJSON() as { cells: Array<Record<string, unknown>> };
  expect(body.cells).toHaveLength(1);
  expect(body.cells[0]).toMatchObject({ key: '0.1:34.9:135.7', samples: 2 });
  expect(JSON.stringify(body)).not.toMatch(/34\.99|135\.78|latitude|longitude/);
  await expect(panel).toContainText('送った区画: 1件');

  // 4. ほかの画面でも記録中であることを示す
  await page.goto(`/planner/${planId}`);
  const indicator = page.getByTestId('recording-indicator');
  await expect(indicator).toContainText('位置の記録中の軌跡があります');
  await expectNoAxeViolations(page, 'ほかの画面の記録中の表示');
  await indicator.getByRole('link', { name: '記録の画面へ' }).click();
  await expect(page).toHaveURL(new RegExp(`/planner/${planId}/track$`));
  await expect(page.getByTestId('recording-indicator')).toHaveCount(0);

  // 5. 止めて、記録の状態と区画を確かめる
  const panel2 = page.getByRole('region', { name: '記録中の軌跡' });
  await panel2.getByRole('button', { name: '記録を止める' }).click();
  await expect(page.getByRole('status')).toHaveText('記録を止めました');
  const list = page.getByRole('region', { name: '記録した軌跡' });
  await expect(list).toContainText('停止・訪問地域だけ同期');
  await expect(list).toContainText('手動の記録 1件');
  await list.getByRole('button', { name: '軌跡を見る' }).click();
  await expect(list).toContainText('サーバーにあるのは訪問地域(区画)1件だけです(座標はこの端末だけ)');
  const tracks = await send('get', `/plans/${planId}/location-tracks`);
  expect(tracks.tracks[0]).toMatchObject({ mode: 'areas_only', point_count: 0 });
  expect(tracks.tracks[0].sampling.manual_points).toBe(1);

  // 6. 旅の地図に区画が載る
  const atlas = await send('get', '/atlas?precision=region');
  const cell = atlas.cells.find((c: { key: string }) => c.key === '0.1:34.9:135.7');
  expect(cell).toBeTruthy();
  expect(cell.evidence).toMatchObject({ area: 1 });

  // 7. 「記録しない」にすると始められない
  await page.getByRole('region', { name: 'この旅行での位置の扱い' }).getByLabel('記録しない').check();
  await page.getByRole('region', { name: 'この旅行での位置の扱い' }).getByRole('button', { name: '位置の扱いを保存' }).click();
  await expect(page.getByRole('status')).toHaveText('この旅行では位置を記録しない設定にしました');
  await expect(page.getByRole('region', { name: '記録を始める' }).getByRole('button', { name: '記録を始める' })).toBeDisabled();
  await expect(page.getByRole('region', { name: '記録を始める' })).toContainText('この旅行は「記録しない」設定です。');
});
