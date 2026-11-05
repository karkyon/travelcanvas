import { readFileSync } from 'node:fs';
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
    // 2 地点以上ある日だけ、その日の経路の QR が出る(スポットごとの QR は出さない)
    await expect(view.getByTestId('booklet-map-qr')).toHaveCount(1);
    await expect(view.getByTestId('booklet-map-qr')).toHaveAttribute('href', /google\.com\/maps\/dir\/\?api=1/);
    await expect(view.getByRole('img', { name: /の経路を Google マップで開く/ })).toBeVisible();
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
  // 枠へドロップしても、ファイルを選んでも、入れるとすぐ読み取って小さな画像と項目を並べる
  await expect(page.getByTestId('image-dropzone')).toContainText('ドラッグ&ドロップ');
  const bytes = readFileSync('../backend/tests/fixtures/receipt_jp_photo.jpg').toString('base64');
  const transfer = await page.evaluateHandle((b64) => {
    const data = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([data], 'receipt.jpg', { type: 'image/jpeg' }));
    return dt;
  }, bytes);
  await page.getByTestId('image-dropzone').dispatchEvent('drop', { dataTransfer: transfer });
  await expect(page.getByTestId('image-dropzone-thumb')).toBeVisible();
  await expect(page.getByTestId('receipt-amount')).toContainText('1260', { timeout: 60_000 });
  await page.getByRole('button', { name: 'この内容で支出に入れる' }).click();
  await expect(page.getByTestId('receipt-notes')).toContainText('確かめてから');
  await expect(page.getByLabel(/金額/).first()).toHaveValue('1260');
  await expect(page.getByLabel('内容')).toHaveValue(/ファミリーマート/);
  await page.getByRole('button', { name: /^(保存|登録|追加)/ }).click();
  await expect(page.getByText(/ファミリーマート/).first()).toBeVisible({ timeout: 15_000 });
});

test('行きたい場所: 追加・編集・削除ができ、旅程の予定へ位置ごと入り、旅程からしおりを開ける', async ({ page, context }) => {
  test.setTimeout(120_000);
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `行きたい場所確認-${Date.now()}`);
  const send = client(context.request, apiBase, token);
  await send(`/plans/${planId}/days`, { local_date: '2027-04-10', timezone_id: 'Asia/Tokyo' });
  await page.route('**/api/v1/search/spots', (r) => r.fulfill({ json: {
    query: '伊勢', total: 1, candidates: [{ id: 's1', provider: 'overpass', name: '伊勢神宮', category: 'sightseeing',
      location: { latitude: 34.455, longitude: 136.725, address: '三重県伊勢市' }, retrieved_at: '2026-10-28T09:00:00+00:00' }],
  } }));

  // サイドバーの名前と画面の題名が同じ
  await page.goto('/spots');
  await expect(page.getByRole('heading', { level: 1, name: '行きたい場所' })).toBeVisible();
  await page.getByRole('button', { name: '最初の場所を追加' }).click();
  await page.getByLabel('場所の名前').first().fill('伊勢');
  await page.getByRole('button', { name: '探す' }).click();
  await page.getByRole('button', { name: '「伊勢神宮」を入れる' }).click();
  await expect(page.getByLabel('住所')).toHaveValue('三重県伊勢市');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '伊勢神宮' })).toBeVisible();
  // 手で追加・編集・削除
  await page.getByRole('button', { name: '場所を追加' }).click();
  await page.getByRole('tab', { name: '手で入力' }).click();
  await page.getByLabel(/場所の名前/).fill('消す場所');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: '「消す場所」を編集' }).click();
  await page.getByLabel(/場所の名前/).fill('直した場所');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: '「直した場所」を削除' }).click();
  await expect(page.getByRole('heading', { name: '直した場所' })).toBeHidden();

  // 旅程: しおりの入口と、予定の追加の入れ方
  await page.goto(`/planner/${planId}`);
  await expect(page.getByTestId('plan-booklet')).toBeVisible({ timeout: 20_000 });
  // この旅行のメニューは上の帯にある
  await expect(page.getByRole('navigation', { name: 'この旅行のメニュー' }).getByRole('link', { name: '旅程' })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: /予定を追加/ }).first().click();
  const dialog = page.getByRole('dialog');
  for (const name of ['手で入力', '名前で検索', '写真・スクショ', '声', 'SNS・URL', '行きたい場所']) await expect(dialog.getByRole('tab', { name })).toBeVisible();
  await dialog.getByRole('tab', { name: '行きたい場所' }).click();
  await dialog.getByRole('button', { name: '「伊勢神宮」を入れる' }).click();
  await expect(dialog.getByPlaceholder('東京タワー見学')).toHaveValue('伊勢神宮');
  await dialog.getByRole('button', { name: '追加', exact: true }).click();
  await expect(page.getByText('伊勢神宮').first()).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('plan-booklet').click();
  await expect(page).toHaveURL(new RegExp(`/planner/${planId}/booklet`));
  await expect(page.getByTestId('booklet')).toContainText('伊勢神宮', { timeout: 20_000 });
  // 位置ごと入ったので、しおりの地図にピンが出る
  await expect(page.getByRole('img', { name: /旅行全体の地図.*伊勢神宮/ })).toBeVisible();
});
