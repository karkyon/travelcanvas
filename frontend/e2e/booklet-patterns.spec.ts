import { test, expect, type APIRequestContext } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';

/** [Gate BookletPatterns] 12 パターンのどれでも、必須の内容が Web と印刷に載る。地図の画像は外部なので、ここでは無地の画像を返す */
const THEMES: [string, RegExp][] = [
  ['simple', /簡潔/], ['functional', /機能的/], ['business', /仕事/], ['family', /家族/], ['friends', /友人/], ['wild', /ワイルド/],
  ['lovers', /恋人/], ['elegant', /エレガント/], ['calm', /落ち着いた/], ['solo', /一人旅/], ['school', /学校/], ['space', /宇宙旅行/],
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function client(request: APIRequestContext, base: string, token: string) {
  return async (path: string, data: unknown) => {
    const res = await request.post(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `bp-${Date.now()}-${Math.random()}` }, data });
    if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${await res.text()}`);
    return res.json();
  };
}

test('しおり: 12 パターンすべてで、必須の内容を Web と印刷で出せる', async ({ page, context }) => {
  test.setTimeout(240_000);
  await context.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ contentType: 'image/png', body: PNG }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  const title = `パターン確認-${Date.now()}`;
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, title);
  const send = client(context.request, apiBase, token);
  const d1 = await send(`/plans/${planId}/days`, { local_date: '2027-04-10', timezone_id: 'Asia/Tokyo', title: '東山' });
  const d2 = await send(`/plans/${planId}/days`, { local_date: '2027-04-11', timezone_id: 'Asia/Tokyo' });
  await send(`/plans/${planId}/events`, { day_id: d1.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '09:30', latitude: 34.9949, longitude: 135.785 });
  await send(`/plans/${planId}/events`, { day_id: d1.id, title: '八坂神社', event_type: 'sightseeing', local_start_time: '12:00', latitude: 35.0037, longitude: 135.7785 });
  await send(`/plans/${planId}/events`, { day_id: d2.id, title: '金閣寺', event_type: 'sightseeing', local_start_time: '10:00', latitude: 35.0394, longitude: 135.7292 });

  await page.goto(`/planner/${planId}/booklet`);
  const view = page.getByTestId('booklet');
  await expect(view).toContainText(title, { timeout: 20_000 });
  const problems: string[] = [];
  for (const [theme, label] of THEMES) {
    await page.getByRole('radio', { name: label }).click();
    await expect(view).toHaveAttribute('data-theme', theme);
    for (const text of [title, '清水寺', '金閣寺', '2027年4月10日', 'OpenStreetMap']) await expect(view).toContainText(text);
    await expect(view.getByRole('img', { name: /旅行全体の地図/ })).toBeVisible();
    await expect(view.locator('.bk-ov tbody tr')).toHaveCount(2);
    await expect(view.locator('.bk-day')).toHaveCount(2);
    await settleForAxe(page);
    const axe = await new AxeBuilder({ page }).include('[data-testid="booklet"]').withTags(['wcag2a', 'wcag2aa']).analyze();
    problems.push(...axe.violations.flatMap((v) => v.nodes.map((n) => `${theme}: ${v.id} ${n.target} ${n.any[0]?.message ?? ''}`)));
    // 印刷: 操作の画面は出ず、しおりだけが A4 の PDF になる
    await page.emulateMedia({ media: 'print' });
    await expect(page.getByRole('heading', { name: 'しおり・印刷' })).toBeHidden();
    const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await page.emulateMedia({ media: 'screen' });
    // スマホの幅でも横にはみ出さない
    await page.setViewportSize({ width: 390, height: 800 });
    await expect.poll(() => view.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });
  }
  expect(problems).toEqual([]);
  // 必須の章は外せない
  await expect(page.getByRole('checkbox', { name: /地図/ })).toBeDisabled();
});

test('支出: レシートの写真を読み取り、確かめてから登録する', async ({ page }) => {
  const { planId } = await startGuestPlanViaApi(page, `レシート確認-${Date.now()}`);
  await page.goto(`/planner/${planId}/expenses`);
  await page.getByRole('tab', { name: '支出' }).click();
  await page.getByRole('button', { name: 'レシートを読み取る' }).click();
  await page.getByLabel(/レシートの写真/).setInputFiles('../backend/tests/fixtures/receipt_jp_photo.jpg');
  await page.getByRole('button', { name: '読み取る', exact: true }).click();
  await expect(page.getByTestId('receipt-notes')).toContainText('確かめてから', { timeout: 60_000 });
  await expect(page.getByLabel(/金額/).first()).toHaveValue('1260');
  await expect(page.getByLabel('内容')).toHaveValue(/ファミリーマート/);
  await page.getByRole('button', { name: /^(保存|登録|追加)/ }).click();
  await expect(page.getByText(/ファミリーマート/).first()).toBeVisible({ timeout: 15_000 });
});
