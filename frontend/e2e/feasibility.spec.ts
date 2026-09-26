import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * [Gate L3] FR-017 実行可能性検証(SC-15)のbrowser E2E。
 *
 * ゲストで旅行を作り、画面から作る予定と同じ形(local_start_timeのみ)を含む旅程をAPIで用意して、
 * 制約画面から次を確認する。
 *   1. 未検証の状態が「問題なし」と区別して表示される
 *   2. 「検証する」で時間の重なり・移動時間不足(エラー)、避けたい移動手段(警告)、
 *      開始時刻未定(検証できなかった項目)がそれぞれ別に表示され、制約に結果が付く
 *   3. 再読込後も最新の結果が表示される(保存されている)
 *   4. 制約を変更すると「結果が古い」表示になり、再検証で最新になる
 *   5. 画面にaxe(WCAG 2.1 AA)違反が無い
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

async function startGuestPlan(page: Page): Promise<{ planId: string; apiBase: string }> {
  await page.goto('/');
  const guestResponse = page.waitForResponse((r) => /\/auth\/guest$/.test(new URL(r.url()).pathname));
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  const apiBase = (await guestResponse).url().replace(/\/auth\/guest$/, '');
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const newPlanButton = page.getByRole('button', { name: /新しいプラン/ });
  await newPlanButton.waitFor({ state: 'visible', timeout: 15_000 });
  await newPlanButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('例: 東京旅行').fill(`L3検証E2E-${Date.now()}`);
  await dialog.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = page.url().match(/\/planner\/([0-9a-fA-F-]{36})/);
  if (!match) throw new Error(`planIdをURLから取得できませんでした: ${page.url()}`);
  return { planId: match[1], apiBase };
}

async function send(request: APIRequestContext, base: string, token: string, path: string, data: unknown,
  extra: Record<string, string> = {}) {
  const res = await request.post(`${base}${path}`, { headers: { Authorization: `Bearer ${token}`, ...extra }, data });
  const body = await res.text();
  if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${body}`);
  return JSON.parse(body);
}

test('実行可能性チェック: 違反・警告・検証不能を分けて表示し、結果を保存し、変更後は古い結果と示す', async ({ page, context }) => {
  const { planId, apiBase } = await startGuestPlan(page);
  const token = await page.evaluate(() => window.localStorage.getItem('auth_token'));
  if (!token) throw new Error('ゲストのアクセストークンがlocalStorage(auth_token)にありません');

  // 旅程: 美術館(10:00-12:00) → タクシー20分 → 昼食(11:30開始、終了未定)、時刻未定の散策
  const day = await send(context.request, apiBase, token, `/plans/${planId}/days`,
    { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  const museum = await send(context.request, apiBase, token, `/plans/${planId}/events`, {
    day_id: day.id, title: '美術館', start_at: '2026-11-02T10:00:00+09:00', end_at: '2026-11-02T12:00:00+09:00',
  });
  const lunch = await send(context.request, apiBase, token, `/plans/${planId}/events`,
    { day_id: day.id, title: '昼食', local_start_time: '11:30', event_type: 'dining' });
  await send(context.request, apiBase, token, `/plans/${planId}/events`, { day_id: day.id, title: '時刻未定の散策' });
  await send(context.request, apiBase, token, `/plans/${planId}/segments`,
    { from_event_id: museum.id, to_event_id: lunch.id, mode: 'taxi', duration_minutes: 20 },
    { 'Idempotency-Key': `l3-e2e-${Date.now()}` });

  // 1. 制約画面へ。未検証であることが「問題なし」と区別して出る
  await page.reload();
  await page.getByRole('button', { name: /制約/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/constraints$`), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: '実行可能性チェック' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('note')).toContainText('まだ検証していません');
  await expect(page.getByText(/問題は見つかりませんでした/)).toHaveCount(0);

  // 避けたい移動手段(ソフト)を画面から登録
  await page.getByRole('button', { name: /制約を追加/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('題名', { exact: true }).fill('タクシーは避けたい');
  await dialog.getByLabel('種類', { exact: true }).selectOption('avoid_transport');
  await dialog.getByLabel('内容', { exact: true }).fill('タクシー');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/plans/${planId}/constraints`),
  );
  await dialog.getByRole('button', { name: '保存' }).click();
  const constraint = await (await created).json();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId(`constraint-status-${constraint.id}`)).toHaveText('検証: 未検証');
  await axeViolations(page, '実行可能性チェック(未検証)');

  // 2. 検証する
  const ran = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/plans/${planId}/validation-runs`),
  );
  await page.getByRole('button', { name: '検証する' }).click();
  const runResponse = await ran;
  expect(runResponse.status()).toBe(201);
  const run = await runResponse.json();
  expect(run.counts).toEqual({ error: 2, warning: 1, info: 0, unverified: 1 });

  const result = page.getByTestId('feasibility-result');
  await expect(result.getByText('このままでは実行できない問題が2件あります。')).toBeVisible();
  const errors = page.getByRole('region', { name: /エラー\(このままでは実行できない\)/ });
  await expect(errors.getByRole('listitem')).toHaveCount(2);
  await expect(errors.getByText(/「昼食」が「美術館」\(10:00〜12:00\)の途中に始まります/)).toBeVisible();
  await expect(errors.getByText(/移動の20分を確保できません/)).toBeVisible();
  const warnings = page.getByRole('region', { name: /警告\(見直しを推奨\)/ });
  await expect(warnings.getByText(/区間の移動手段がタクシーです/)).toBeVisible();
  await expect(warnings.getByText('制約: タクシーは避けたい')).toBeVisible();
  const unverified = page.getByRole('region', { name: /検証できなかった項目/ });
  await expect(unverified.getByText(/「時刻未定の散策」は開始時刻が未定/)).toBeVisible();
  await expect(page.getByTestId(`constraint-status-${constraint.id}`)).toHaveText('検証: 満たしていない');
  await axeViolations(page, '実行可能性チェック(結果)');

  // 3. 再読込後も最新の結果が表示される
  await page.reload();
  await expect(page.getByTestId('feasibility-result').getByText('このままでは実行できない問題が2件あります。'))
    .toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/結果が古い可能性がある/)).toHaveCount(0);

  // 4. 制約を無効にすると結果は古いと表示され、再検証で警告が消える
  const toggled = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '無効にする' }).click();
  expect((await toggled).status()).toBe(200);
  await expect(page.getByText(/結果が古い可能性があるため、再検証してください/)).toBeVisible();
  const rerun = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/plans/${planId}/validation-runs`),
  );
  await page.getByRole('button', { name: '再検証する' }).click();
  expect((await (await rerun).json()).counts).toEqual({ error: 2, warning: 0, info: 0, unverified: 1 });
  await expect(page.getByText(/結果が古い可能性がある/)).toHaveCount(0);
  await expect(page.getByRole('region', { name: /警告\(見直しを推奨\)/ })).toHaveCount(0);
});
