import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';
import { e2eStubReady, e2eStubReset } from './support/admin';

/**
 * [Gate ConsultAI] 旅行相談で AI・Google を使う(本物の backend。外へは送らない: CI は PROVIDER_HTTP_STUB の模擬の提供元)。
 *
 *   1. Free・同意なし: 画面は押せず理由を示す。API も送らずに断る(同意 → クラス)
 *   2. 模擬の鍵を確認・Journey: 「AI で読み取る」→ AI の行は未確認 → AI の方面の案を足す → 比較 → 方面の詳細で
 *      Google の場所の検索・経路(押した時だけ・出典と時刻)→ 場所を出典に足して下書き → 相談の利用額が旅行の枠へ移る
 *   3. 失敗の経路: 時間切れ(見込みで数える)・同じ Idempotency-Key の再送(二度送らない)・回数の上限(送る前に断る)
 *   4. 模擬の鍵を無効にすると、送らずに理由を示す
 * 実の API の受入(実の鍵・請求の照合)は omega-dev2 で行う。ここでの成功は実の API の成功ではない。
 */
const AT = '2026-11-01T00:00:00+00:00';
const COORDS: Record<string, [number, number]> = {
  伊勢: [34.4875, 136.7091], 福井: [36.0641, 136.2196], 滋賀: [35.0045, 135.8686], 城崎温泉: [35.6253, 134.8072],
};
const geo = (c: [number, number] | undefined) => ({
  status: c ? 'ok' : 'not_found', latitude: c ? c[0] : null, longitude: c ? c[1] : null, label: null, provider: 'nominatim',
  source_url: c ? 'https://www.openstreetmap.org/relation/1' : null, retrieved_at: AT,
});

async function stubGeocode(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 204, body: '' }));
  await page.route('**/api/v1/trip-intents/areas', async (route) => {
    const body = route.request().postDataJSON() as { origin: string; areas: string[] };
    await route.fulfill({ json: {
      origin: { query: body.origin, ...geo([34.8146, 135.6507]) }, retrieved_at: AT,
      providers: { geocode: 'nominatim', route: null, lodging: null, crowd: null, destination_suggestions: null },
      areas: body.areas.map((name) => ({
        name, source: 'user_input', geocode: geo(COORDS[name]), straight_km: COORDS[name] ? 100 : null,
        drive: { status: 'not_connected', note: '未照会' }, limit_check: { status: 'unknown', note: '未照会' },
        lodging: { status: 'not_connected', note: '' }, quietness: { status: 'unverified', note: '' },
        hours: { status: 'date_pending', note: '' },
      })),
    } });
  });
  await page.route('**/api/v1/search/spots', (route) => route.fulfill({ json: {
    query: '', category: 'sightseeing', radius_km: 10, base: { latitude: 34.4875, longitude: 136.7091 }, total: 0, candidates: [] } }));
}

test('旅行相談の AI: 断る理由 → AI で読み取る → 方面の案 → Google の場所と経路 → 下書き(模擬の提供元)', async ({ page }) => {
  test.setTimeout(240_000);
  const me = await registerMember(page, 'consultai');
  const send = apiClient(page.context().request, me.apiBase, me.token);
  const raw = (path: string, data: unknown, key = `e2e-${Date.now()}-${Math.random()}`) =>
    page.context().request.post(`${me.apiBase}${path}`, { data, headers: { Authorization: `Bearer ${me.token}`, 'Idempotency-Key': key } });
  await stubGeocode(page);

  // 1. Free・同意なし: 押せず、API も送らずに断る
  await page.goto('/trip-consult');
  await expect(page.getByTestId('consult-ai-state')).toContainText('Free のクラスには含まれません', { timeout: 20_000 });
  await page.getByRole('button', { name: '例文を入れる' }).click();
  await expect(page.getByTestId('consult-ai-extract')).toBeDisabled();
  const s0 = (await send('post', '/trip-intents/ai/session', {})).session_id as string;
  let r = await raw('/trip-intents/ai/extract', { session_id: s0, text: '家族4人で1泊2日' });
  expect(r.status()).toBe(403);
  expect((await r.json()).detail.code).toBe('consent_required');
  await send('put', '/privacy/consents', { consents: { ai_processing: true } });
  r = await raw('/trip-intents/ai/extract', { session_id: s0, text: '家族4人で1泊2日' });
  expect(r.status()).toBe(403);
  expect((await r.json()).detail.code).toBe('tier_feature_not_included');

  try {
    // 2. 模擬の鍵の確認・Journey
    e2eStubReady(me.email, 'journey');
    await page.reload();
    await expect(page.getByTestId('consult-ai-state')).toContainText('使えます', { timeout: 20_000 });
    await expect(page.getByTestId('consult-stub').first()).toContainText('模擬');
    if (!(await page.getByLabel('希望・事情').inputValue())) await page.getByRole('button', { name: '例文を入れる' }).click();
    await page.getByLabel('出発地').fill('大阪府枚方市');
    await expectNoAxeViolations(page, '旅行相談: AI で読み取る');
    await page.getByTestId('consult-ai-extract').click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('読み取った内容を確認してください', { timeout: 20_000 });
    await expect(page.getByText(/AI\(OpenAI\)の読み取りです/)).toBeVisible();
    await expect(page.getByTestId('review-row-origin')).toContainText('あなたの入力');
    await expect(page.getByTestId('review-row-party_size')).toContainText('AI の読み取り · 未確認');
    await expect(page.getByTestId('review-row-party_size')).toContainText('文章の該当:');
    await page.getByRole('radiogroup', { name: '片道の時間の扱い' }).getByRole('radio', { name: /希望/ }).click();
    await page.getByRole('radiogroup', { name: '予算は誰の分か' }).getByRole('radio', { name: /全員の合計/ }).click();
    await page.getByTestId('review-confirm-party_size').check();
    await page.getByTestId('review-confirm-nights').check();
    // 追加で伝える: 確かめた人数は変えず「変更案」を出す。元に戻す → もう一度 → 採用。その他の希望を残す
    await page.getByTestId('consult-followup-text').fill('やっぱり3人で行きます。何もしない時間もほしい');
    await page.getByTestId('consult-followup-ai').click();
    await expect(page.getByTestId('review-proposal-party_size')).toContainText('4 → 3', { timeout: 20_000 });
    await expect(page.getByLabel('その他の希望 1')).toHaveValue('何もしない時間がほしい');
    await page.getByTestId('consult-undo').click();
    await expect(page.getByTestId('review-proposal-party_size')).toHaveCount(0);
    // [Gate AdminUAT U05] 食い違う希望(日帰りと泊まり)は AI が片方に決めず「確かめてほしいこと」に出す
    await page.getByTestId('consult-followup-text').fill('やっぱり3人で行きます。日帰りか1泊かは迷っています。何もしない時間もほしい');
    await page.getByTestId('consult-followup-ai').click();
    await expect(page.getByTestId('consult-ai-contradictions')).toContainText('食い違っています', { timeout: 20_000 });
    await page.getByTestId('review-proposal-accept-party_size').click();
    await expect(page.getByTestId('review-row-party_size').getByLabel('人数', { exact: true })).toHaveValue('3');
    const suggest = page.getByTestId('consult-suggest-城崎温泉');
    await expect(suggest).toHaveText('比較に足す');
    await suggest.click();
    await expect(suggest).toHaveText('比較から外す');
    await expectNoAxeViolations(page, '旅行相談: AI の読み取りの確認');
    await page.getByTestId('consult-compare').click();
    await expect(page.getByTestId('area-row-伊勢')).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: /他の候補も見る/ }).click(); // 4件目(足した AI の案)
    await expect(page.getByTestId('area-row-城崎温泉')).toBeVisible();
    await page.getByTestId('area-open-伊勢').click();

    // 方面の詳細: Google の場所・経路(押した時だけ)
    const lookup = page.getByTestId('consult-lookup');
    await expect(lookup).toBeVisible({ timeout: 20_000 });
    await lookup.getByTestId('consult-places-search').click();
    await expect(lookup.getByTestId('consult-places-result')).toContainText('模擬の場所 1');
    await expect(lookup.getByTestId('consult-places-result')).toContainText('提供: Google');
    await lookup.getByRole('button', { name: '参考の出典に足す' }).first().click();
    await lookup.getByTestId('consult-route').click();
    await expect(lookup.getByTestId('consult-route-result')).toContainText('車: 約 150 分 · 180 km');
    await expect(lookup.getByTestId('consult-route-result')).toContainText('提供: Google');
    await expectNoAxeViolations(page, '旅行相談: Google で調べる');
    await page.getByTestId('consult-create-draft').click();
    await expect(page).toHaveURL(/\/planner\/[^/]+\/draft$/, { timeout: 20_000 });
    const planId = page.url().split('/planner/')[1]!.split('/')[0]!;
    await expect(page.getByText('https://maps.google.com/?cid=1001')).toBeVisible();
    const usage = await send('get', `/plans/${planId}/planning-usage`);
    expect(Number(JSON.stringify(usage).match(/"plan_used(?:_jpy)?":"([0-9.]+)"/)?.[1] ?? '0')).toBeGreaterThan(0);

    // 3. 失敗の経路(API): 時間切れ・同じ鍵の再送・回数の上限
    const s1 = (await send('post', '/trip-intents/ai/session', {})).session_id as string;
    r = await raw('/trip-intents/ai/extract', { session_id: s1, text: 'E2E_TIMEOUT 家族旅行' });
    expect(r.status()).toBe(503);
    expect((await r.json()).detail.code).toBe('provider_timeout');
    r = await raw('/trip-intents/ai/extract', { session_id: s1, text: '家族4人で1泊2日' }, 'same-key-e2e');
    expect(r.status()).toBe(200);
    r = await raw('/trip-intents/ai/extract', { session_id: s1, text: '家族4人で1泊2日' }, 'same-key-e2e');
    expect(r.status()).toBe(409);
    expect((await r.json()).detail.code).toBe('idempotent_replay');
    r = await raw('/trip-intents/ai/extract', { session_id: s1, text: 'E2E_BROKEN 家族旅行' });
    expect(r.status()).toBe(502);
    r = await raw('/trip-intents/ai/extract', { session_id: s1, text: '家族4人で1泊2日' });
    expect(r.status()).toBe(429); // Journey は 1相談 AI 3回(時間切れ・成功・読めない応答)。4回目は送る前に断る
    expect((await r.json()).detail.code).toBe('feature_quota_exceeded');
    const st = await send('get', `/trip-intents/ai/status?session_id=${s1}`);
    expect(Number(st.usage.plan_used)).toBeLessThanOrEqual(50);
  } finally {
    e2eStubReset();
  }

  // 4. 鍵を無効にすると送らない
  await page.goto('/trip-consult');
  await expect(page.getByTestId('consult-ai-state')).toContainText(/鍵|準備/, { timeout: 20_000 });
  await expect(page.getByTestId('consult-ai-state')).not.toContainText('使えます');
  const s2 = (await send('post', '/trip-intents/ai/session', {})).session_id as string;
  r = await raw('/trip-intents/ai/extract', { session_id: s2, text: '家族4人で1泊2日' });
  expect(r.status()).toBe(503);
  expect((await r.json()).detail.code).toBe('provider_not_ready');
});
