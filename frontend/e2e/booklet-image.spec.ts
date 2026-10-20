import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { guestTokenFrom } from './support/guestPlan';

/**
 * [Gate P16] FR-046 画像出力(CA-004)のbrowser E2E。画像は実ブラウザのcanvasで作る。
 *
 * ゲストで旅行を作り、日程・予定と確認番号付きの予約をAPIで用意して次を確認する。
 *   1. しおり画面の「画像として保存」で、含める・含めない情報が示される
 *   2. 旅行全体をスマートフォン縦長で作ると、1080×1920のPNGが表示され、保存できる
 *   3. しおりで予約番号を含める設定にしていても、画像の元の投影は機密項目を含めない
 *   4. 1日・正方形でも作れる。画面にaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  await settleForAxe(page);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

test('画像出力: しおりから機密を含めない画像(縦長・正方形)を端末で作り、保存できる', async ({ page, context }) => {
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const guest = await guestResponse;
  const apiBase = guest.url().replace(/\/auth\/guest$/, '');
  const token = await guestTokenFrom(guest); // [Gate S11] 画面の遷移と競合しないよう応答から取る
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const send = async (path: string, data: unknown) => {
    const res = await context.request.post(`${apiBase}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p16-e2e-${Date.now()}-${Math.random()}` }, data,
    });
    if (!res.ok()) throw new Error(`${path} -> ${res.status()}: ${await res.text()}`);
    return res.json();
  };
  const plan = await send('/travel-plans/', { title: `P16-image-E2E-${Date.now()}` });
  const d1 = await send(`/plans/${plan.id}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo', title: '東山' });
  await send(`/plans/${plan.id}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  await send(`/plans/${plan.id}/events`, { day_id: d1.id, title: '清水寺', local_start_time: '10:00' });
  await send(`/plans/${plan.id}/reservations`, {
    type: 'accommodation', provider_name: '京の宿', confirmation_number: 'SECRET98765',
  });

  await page.goto(`/planner/${plan.id}/booklet`);
  const panel = page.getByRole('region', { name: '画像として保存' });
  await expect(panel).toContainText('含めない: 予約番号・住所・電話・参加者名・QR・チケット');

  // しおりの設定で予約番号を含めても、画像の元の投影は機密項目を含めない
  const box = page.getByLabel(/予約番号/).first();
  if (await box.isVisible()) await box.check();
  const previewReq = page.waitForRequest((r) => /\/booklet\/preview$/.test(new URL(r.url()).pathname)
    && (r.postDataJSON() as { sections?: string[] }).sections?.join(',') === 'cover,schedule');
  await panel.getByRole('button', { name: '画像を作る' }).click();
  const body = (await previewReq).postDataJSON() as { includes: Record<string, boolean> };
  expect(Object.values(body.includes).every((v) => v === false)).toBe(true);

  const img = panel.getByRole('img', { name: /の画像\(1\/1\)/ });
  await expect(img).toBeVisible();
  expect(await img.evaluate((el) => [(el as HTMLImageElement).naturalWidth, (el as HTMLImageElement).naturalHeight])).toEqual([1080, 1920]);
  const download = page.waitForEvent('download');
  await panel.getByRole('button', { name: '画像を保存(1/1)' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^P16-image-E2E-\d+_trip\.png$/);
  await axeViolations(page, 'しおりの画像出力');

  await panel.getByLabel('範囲').selectOption('2026-11-01');
  await panel.getByLabel('形式').selectOption('square');
  await panel.getByRole('button', { name: '画像を作る' }).click();
  const square = panel.getByRole('img', { name: /の画像\(1\/1\)/ });
  await expect.poll(() => square.evaluate((el) => (el as HTMLImageElement).naturalHeight)).toBe(1080);
  const download2 = page.waitForEvent('download');
  await panel.getByRole('button', { name: '画像を保存(1/1)' }).click();
  expect((await download2).suggestedFilename()).toMatch(/^P16-image-E2E-\d+_2026-11-01\.png$/);
});
