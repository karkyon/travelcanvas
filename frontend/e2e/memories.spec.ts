import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P12] FR-037 写真・メモ・旅行記(SC-28)のbrowser E2E。
 *
 * ゲストで旅行を作り、日2つ・予定2件をAPIで用意して次を確認する。
 *   1. 「旅の記録」でメモ(予定に紐付け・予約番号のような文字列入り)を記録すると、日ごとの一覧に「自分だけ」で出る
 *   2. 写真をアップロードすると、サーバーから読み込んだ画像が代替テキスト付きで表示される
 *   3. 公開範囲を「メンバー」に切り替えられる(再読込後も保持)
 *   4. 旅行記の下書きを作ると、記録の無い予定は「記録はありません」として残り、公開前の確認
 *      (予約番号のような文字列・写真)が出る。位置は既定で含めない
 *   5. 写真を削除すると一覧から消える
 *   6. 画面にaxe(WCAG 2.1 AA)違反が無い
 */

// 1x1 の透明PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64',
);

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

test('旅の記録: メモと写真を予定に記録し、公開範囲を変え、旅行記の下書きで公開前の確認が出る', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `P12記録E2E-${Date.now()}`);
  const post = async (path: string, data: unknown) => {
    const res = await context.request.post(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p12-e2e-${Date.now()}-${Math.random()}` }, data,
    });
    if (!res.ok()) throw new Error(`${path} -> ${res.status()}: ${await res.text()}`);
    return res.json();
  };
  const d1 = await post(`/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  const d2 = await post(`/plans/${planId}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  await post(`/plans/${planId}/events`, { day_id: d1.id, title: '清水寺', local_start_time: '09:00' });
  await post(`/plans/${planId}/events`, { day_id: d2.id, title: '美術館', local_start_time: '10:00' });

  await page.goto(`/planner/${planId}/memories`);
  await expect(page.getByRole('heading', { name: '旅の記録', level: 1 })).toBeVisible();
  await expect(page.getByText('まだ記録はありません。')).toBeVisible();

  // 1. メモ
  const form = page.getByRole('form', { name: '記録を追加' });
  await form.getByLabel('メモの内容', { exact: true }).fill('朝の参拝。確認番号 QX9Z81');
  await form.getByLabel('予定').selectOption({ label: '2026-11-01 09:00 清水寺' });
  await form.getByRole('button', { name: '記録する' }).click();
  await expect(page.getByRole('status')).toHaveText('メモを記録しました');
  const day1 = page.getByRole('region', { name: '2026-11-01' });
  await expect(day1.getByText('朝の参拝。確認番号 QX9Z81')).toBeVisible();
  await expect(day1.getByText('自分だけ')).toBeVisible();

  // 2. 写真
  await form.getByLabel('写真', { exact: true }).check();
  await form.getByLabel('写真のファイル').setInputFiles({ name: 'kiyomizu.png', mimeType: 'image/png', buffer: PNG });
  await form.getByLabel('メモの内容(任意)').fill('本堂');
  await form.getByLabel('予定').selectOption({ label: '2026-11-01 09:00 清水寺' });
  await form.getByRole('button', { name: '記録する' }).click();
  await expect(page.getByRole('status')).toHaveText('写真を記録しました');
  const img = day1.getByRole('img', { name: '写真: 本堂' });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);

  // 3. 公開範囲(再読込後も保持)
  const memo = day1.getByRole('listitem').filter({ hasText: '朝の参拝' });
  await memo.getByRole('button', { name: 'メンバーに公開する' }).click();
  await expect(page.getByRole('status')).toHaveText('メンバーに公開しました');
  await page.reload();
  await expect(page.getByRole('region', { name: '2026-11-01' }).getByRole('listitem').filter({ hasText: '朝の参拝' })
    .getByRole('button', { name: '自分だけにする' })).toBeVisible();

  await axeViolations(page, '旅の記録の一覧');

  // 4. 旅行記の下書き
  const journal = page.getByRole('region', { name: '旅行記の下書き' });
  await journal.getByRole('button', { name: '下書きを作る' }).click();
  await expect(journal.getByText('予定2件のうち1件に記録があります(記録2件・写真1枚)。')).toBeVisible();
  const checks = journal.getByRole('list', { name: '公開前の確認' });
  await expect(checks).toContainText('予約番号のような文字列が含まれています');
  await expect(checks).toContainText('写真に人の顔が写っていないか確認してください');
  const markdown = await journal.getByLabel('下書き(Markdown)').inputValue();
  expect(markdown).toContain('### 09:00 清水寺');
  expect(markdown).toContain('### 10:00 美術館\n(予定していた場所。記録はありません)');
  expect(markdown).not.toContain('緯度');
  await axeViolations(page, '旅行記の下書き');

  // 5. 写真の削除
  page.once('dialog', (d) => d.accept());
  await day1.getByRole('listitem').filter({ hasText: '本堂' }).getByRole('button', { name: '削除' }).click();
  await expect(page.getByRole('status')).toHaveText('記録を削除しました');
  await expect(day1.getByRole('img')).toHaveCount(0);
});
