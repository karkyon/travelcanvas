import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P6] FR-039 データポータビリティ(SC-29)のbrowser E2E。
 *
 * ゲストで旅行を作り、日程・予約(予約番号)・個人の持ち物をAPIで用意して次を確認する。
 *   1. 旅行の書き出し画面から旅行データ(JSON)をダウンロードでき、正本の表が入り、予約番号は入らない。
 *      画面に表示されるハッシュ値がファイルの SHA-256 と一致する
 *   2. 設定のデータ画面で保持期間の説明を確認でき、アカウントのデータを書き出すと所有する旅行が入る
 *   3. 画面にaxe(WCAG 2.1 AA)違反が無い
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
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p6-e2e-${Date.now()}-${Math.random()}` },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

async function download(page: Page, button: string): Promise<Buffer> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await pending;
  const path = await file.path();
  if (!path) throw new Error('ダウンロードしたファイルの場所を取得できませんでした');
  return readFileSync(path);
}

test('データの書き出し: 旅行データとアカウントのデータをJSONで保存でき、予約番号を含まず、保持期間を確認できる', async ({ page, context }) => {
  const title = `P6エクスポートE2E-${Date.now()}`;
  const { planId, apiBase, token } = await startGuestPlan(page, title);
  const send = apiClient(context.request, apiBase, token);
  const day = await send(`/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  await send(`/plans/${planId}/events`, { day_id: day.id, title: '清水寺', local_start_time: '10:00' });
  await send(`/plans/${planId}/reservations`, { type: 'flight', provider_name: '航空', confirmation_number: 'E2EPNR55443322' });
  await send(`/plans/${planId}/packing-items`, { name: '自分の常備薬', category: 'health', scope: 'personal' });

  // 1. 旅行データ(JSON)
  await page.goto(`/planner/${planId}/exports`);
  await expect(page.getByRole('heading', { name: '書き出し', level: 1 })).toBeVisible({ timeout: 15_000 });
  const planFile = await download(page, '旅行データを書き出す');
  const planJson = JSON.parse(planFile.toString('utf-8'));
  expect(planJson.format).toBe('travelcanvas-export');
  expect(planJson.scope).toBe('plan');
  const exported = planJson.plans[0];
  expect(exported.plan.title).toBe(title);
  expect(exported.tables.travel_events.map((e: { title: string }) => e.title)).toEqual(['清水寺']);
  expect(exported.tables.packing_items[0].personal.name).toBe('自分の常備薬');
  expect(planFile.toString('utf-8')).not.toContain('E2EPNR55443322');
  const sha = createHash('sha256').update(planFile).digest('hex');
  await expect(page.getByTestId('export-result')).toContainText(sha);

  // 2. 設定のデータ画面
  await page.goto('/settings/data');
  await expect(page.getByTestId('retention-list')).toContainText('削除した旅行', { timeout: 15_000 });
  await expect(page.getByTestId('retention-list')).toContainText('バックアップ');
  await axeViolations(page, 'データの書き出しと保持期間');
  const accountFile = await download(page, 'アカウントのデータを書き出す');
  const accountJson = JSON.parse(accountFile.toString('utf-8'));
  expect(accountJson.scope).toBe('account');
  expect(accountJson.plans.map((p: { plan: { id: string } }) => p.plan.id)).toContain(planId);
  expect(accountJson.profile).not.toHaveProperty('hashed_password');
  expect(accountFile.toString('utf-8')).not.toContain('E2EPNR55443322');
  await expect(page.getByTestId('data-export-result')).toContainText('を保存しました');
  await axeViolations(page, 'データの書き出し(結果表示)');
});
