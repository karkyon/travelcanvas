import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P4] FR-034 しおり生成 / FR-035 安全な印刷 / FR-046 PDF出力(SC-25・SC-26)のbrowser E2E。
 *
 * ゲストで旅行を作り、日程・予約(予約番号・電話・QRチケット)をAPIで用意して次を確認する。
 *   1. しおり画面の既定プレビューは予約番号を伏せ、QRを含めない注意を出す
 *   2. テーマ(白黒)・章を変えてプレビューを更新できる
 *   3. 予約番号を含めると警告と有効期限が出て、版を作ると作成者名の透かし・版番号・有効期限が印字される
 *   4. 印刷時は操作ボタンが印刷されず、同じ画面からPDFを生成できる。「印刷 / PDFで保存」でブラウザの印刷を開く
 *   5. 旅程を更新すると版に注意が出る。版を失効させると表示できなくなる
 *   6. 各画面にaxe(WCAG 2.1 AA)違反が無い
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

// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title);
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (path: string, data: unknown) => {
    const res = await request.post(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p4-e2e-${Date.now()}-${Math.random()}` },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

test('しおり: 既定は予約番号を伏せ、機密を含む版は透かし・有効期限付きで印刷・PDF化でき、失効できる', async ({ page, context }) => {
  const title = `P4しおりE2E-${Date.now()}`;
  const { planId, apiBase, token } = await startGuestPlan(page, title);
  const send = apiClient(context.request, apiBase, token);
  const day = await send(`/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  await send(`/plans/${planId}/events`, { day_id: day.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '10:00' });
  const reservation = await send(`/plans/${planId}/reservations`, {
    type: 'accommodation', provider_name: '京の宿', confirmation_number: 'ABC1234567', contact_phone: '075-123-4567',
  });
  await send(`/plans/${planId}/reservations/${reservation.id}/tickets`,
    { ticket_type: 'admission', payload: 'QR-E2E-SECRET', barcode_format: 'QR_CODE' });

  // 1. 既定のプレビュー
  await page.reload();
  await page.getByRole('button', { name: /しおり・印刷/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/booklet$`), { timeout: 15_000 });
  const preview = page.getByTestId('booklet');
  await expect(preview).toContainText(title, { timeout: 15_000 });
  await expect(preview).toContainText('******4567');
  await expect(preview).not.toContainText('ABC1234567');
  await expect(preview).not.toContainText('075-123-4567');
  await expect(preview).toContainText('チケット・QRコードは含めていません');
  await axeViolations(page, 'しおり(設定・プレビュー)');

  // 2. テーマと章
  await page.getByRole('radio', { name: /白黒/ }).click();
  await page.getByRole('checkbox', { name: '費用' }).click();
  const previewed = page.waitForResponse((r) => /\/booklet\/preview$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: 'プレビューを更新' }).click();
  expect((await previewed).status()).toBe(200);
  await expect(preview).toHaveAttribute('data-theme', 'mono');
  await expect(preview.getByRole('region', { name: '費用' })).toHaveCount(0);
  await expect(preview.getByRole('region', { name: '日程' })).toContainText('観光');

  // 3. 機密を含む版の作成
  await page.getByRole('checkbox', { name: /予約番号/ }).click();
  await expect(page.getByTestId('sensitive-warning')).toContainText('透かしと有効期限');
  await expect(page.getByLabel('有効期限(90日以内)')).not.toHaveValue('');
  const created = page.waitForResponse((r) => r.request().method() === 'POST' && /\/booklet-exports$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: 'この内容で版を作成' }).click();
  expect((await created).status()).toBe(201);
  await page.waitForURL(new RegExp(`/planner/${planId}/booklet/[0-9a-fA-F-]{36}$`), { timeout: 15_000 });
  const printUrl = page.url();
  const stamp = page.getByTestId('booklet-stamp');
  await expect(stamp).toContainText('第1版');
  await expect(stamp).toContainText('有効期限');
  await expect(stamp).toContainText('専用・持出注意');
  await expect(page.getByTestId('booklet-watermark')).toHaveAttribute('data-text', /専用・持出注意$/);
  await expect(page.getByTestId('booklet')).toContainText('ABC1234567');
  await expect(page.getByTestId('booklet')).not.toContainText('QR-E2E-SECRET');
  await axeViolations(page, 'しおり(印刷画面)');

  // 4. 印刷: 操作ボタンは印刷されない。同じ画面からPDFを生成できる
  await page.evaluate(() => {
    (window as unknown as { __printed: number }).__printed = 0;
    window.print = () => { (window as unknown as { __printed: number }).__printed += 1; };
  });
  await page.getByRole('button', { name: '印刷 / PDFで保存' }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: number }).__printed)).toBe(1);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: '印刷 / PDFで保存' })).toBeHidden();
  await expect(page.getByTestId('booklet')).toBeVisible();
  const pdf = await page.pdf({ format: 'A4' });
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(5_000);
  await page.emulateMedia({ media: 'screen' });

  // 5. 旅程を更新すると注意。失効すると表示できない
  await send(`/plans/${planId}/events`, { day_id: day.id, title: '八坂神社', local_start_time: '13:00' });
  await page.reload();
  await expect(page.getByTestId('booklet-stale')).toContainText('新しい版を作成', { timeout: 15_000 });
  await expect(page.getByTestId('booklet')).not.toContainText('八坂神社');

  await page.getByRole('button', { name: '← しおりの設定へ戻る' }).click();
  const item = page.getByTestId('booklet-export-1');
  await expect(item).toContainText('含む機密項目: 予約番号', { timeout: 15_000 });
  await expect(item).toContainText('旅程が更新済み');
  page.once('dialog', (d) => d.accept());
  const revoked = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/booklet-exports\//.test(new URL(r.url()).pathname));
  await item.getByRole('button', { name: '失効' }).click();
  expect((await revoked).status()).toBe(200);
  await expect(item).toContainText('失効');
  await expect(item.getByRole('button', { name: '表示・印刷' })).toHaveCount(0);
  await page.goto(printUrl);
  await expect(page.getByRole('alert')).toContainText('この版は失効しています', { timeout: 15_000 });
  await expect(page.getByTestId('booklet')).toHaveCount(0);
});
