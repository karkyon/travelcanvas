import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P13] FR-038 任意の位置軌跡(SC-43)のbrowser E2E。ブラウザの位置情報はPlaywrightの擬似位置を使う。
 *
 * ゲストで旅行を作り、今日と明日(Asia/Tokyo)の日程をAPIで用意して次を確認する。
 *   1. 同意が無いと記録を始められず、画面から位置情報の利用に同意できる
 *   2. 「暗号化してサーバーへ」・高精度で始めると、記録中の表示が出て、位置の変化が未送信として溜まり、送信できる
 *   3. 記録を止め、軌跡を開くと点の件数・移動距離・略図が出る
 *   4. 軌跡を削除すると一覧から消える
 *   5. 画面にaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

/** ゲストを開始し、プランはAPIで作る(QuickDraftの作成上限を使わないため。optimization.spec.tsと同じ) */
// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title, { open: false });
}

/** Asia/Tokyo の今日から n 日後の日付(YYYY-MM-DD) */
function tokyoDate(offsetDays: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

test('位置の記録: 同意してから暗号化保存で記録し、送信・停止・軌跡の確認・削除ができる', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 34.9948, longitude: 135.785, accuracy: 10 });
  const { planId, apiBase, token } = await startGuestPlan(page, `P13軌跡E2E-${Date.now()}`);
  for (const offset of [0, 1]) {
    const res = await context.request.post(`${apiBase}/plans/${planId}/days`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p13-e2e-${Date.now()}-${offset}` },
      data: { local_date: tokyoDate(offset), timezone_id: 'Asia/Tokyo' },
    });
    if (!res.ok()) throw new Error(`days -> ${res.status()}: ${await res.text()}`);
  }

  await page.goto(`/planner/${planId}/track`);
  await expect(page.getByRole('heading', { name: '位置の記録', level: 1 })).toBeVisible();
  const start = page.getByRole('region', { name: '記録を始める' });

  // 1. 同意
  await expect(start.getByRole('button', { name: '記録を始める' })).toBeDisabled();
  await start.getByRole('button', { name: '位置情報の利用に同意する' }).click();
  await expect(page.getByRole('status')).toHaveText('位置情報の利用に同意しました');
  await expect(start.getByRole('button', { name: '記録を始める' })).toBeEnabled();
  await axeViolations(page, '位置の記録(開始前)');

  // 2. 記録
  await start.getByLabel(/暗号化してサーバーへ/).check();
  await start.getByLabel('精度').selectOption('high');
  await start.getByRole('button', { name: '記録を始める' }).click();
  const panel = page.getByRole('region', { name: '記録中の軌跡' });
  await expect(panel.getByText('● 位置を記録しています')).toBeVisible();
  await expect(panel).toContainText('未送信: 1件');
  await context.setGeolocation({ latitude: 34.9968, longitude: 135.785, accuracy: 10 });
  await expect(panel).toContainText('未送信: 2件');
  await axeViolations(page, '位置の記録(記録中)');
  const upload = page.waitForResponse((r) => /\/location-tracks\/[^/]+\/points$/.test(new URL(r.url()).pathname));
  await panel.getByRole('button', { name: '今すぐ送る' }).click();
  expect((await upload).status()).toBe(200);
  await expect(panel).toContainText('未送信: 0件');

  // 3. 停止して軌跡を見る
  await panel.getByRole('button', { name: '記録を止める' }).click();
  await expect(page.getByRole('status')).toHaveText('記録を止めました');
  const list = page.getByRole('region', { name: '記録した軌跡' });
  await expect(list).toContainText('停止・暗号化してサーバーへ・高精度・2件');
  await expect(list).toContainText('自分で停止');
  await list.getByRole('button', { name: '軌跡を見る' }).click();
  await expect(list).toContainText('点2件・移動距離 約222m');
  await expect(list.getByRole('img', { name: '軌跡の略図(点2件)' })).toBeVisible();

  // 4. 削除
  page.once('dialog', (d) => d.accept());
  await list.getByRole('button', { name: '軌跡を削除' }).click();
  await expect(page.getByRole('status')).toHaveText('軌跡を削除しました');
  await expect(list.getByText('まだ記録はありません。')).toBeVisible();
});
