import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { settleForAxe } from './support/axe';
import { readFileSync } from 'fs';
import { startGuestPlanViaApi } from './support/guestPlan';

/**
 * [Gate P5] FR-036 カレンダー・地図・表計算への書き出し(SC-27)のbrowser E2E。
 *
 * ゲストで旅行を作り、日程・予定(位置付き)・宿泊予約(予約番号)・移動をAPIで用意して次を確認する。
 *   1. ICSをダウンロードでき、予定と移動が入り、予約番号は入らない。住所は選んだ時だけ入る
 *   2. GPXは既定で約1km単位に丸め、宿泊場所を除外し、除外した件数を画面に表示する
 *   3. CSVはBOM付きで、予定の一覧が入る
 *   4. 画面にaxe(WCAG 2.1 AA)違反が無い
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

// [Gate E1] プランは API で作る(QuickDraft の回数制限に当たらないため)。e2e/support/guestPlan.ts
async function startGuestPlan(page: Page, title: string): Promise<{ planId: string; apiBase: string; token: string }> {
  return startGuestPlanViaApi(page, title);
}

function apiClient(request: APIRequestContext, base: string, token: string) {
  return async (path: string, data: unknown) => {
    const res = await request.post(`${base}${path}`, {
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': `p5-e2e-${Date.now()}-${Math.random()}` },
      data,
    });
    const body = await res.text();
    if (!res.ok()) throw new Error(`POST ${path} -> ${res.status()}: ${body}`);
    return JSON.parse(body);
  };
}

async function download(page: Page, button: string): Promise<string> {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: button }).click();
  const file = await pending;
  const path = await file.path();
  if (!path) throw new Error('ダウンロードしたファイルの場所を取得できませんでした');
  return readFileSync(path, 'utf-8');
}

test('書き出し: ICS・GPX・CSVを保存でき、予約番号を含まず、宿泊場所を既定で除外する', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlan(page, `P5書き出しE2E-${Date.now()}`);
  const send = apiClient(context.request, apiBase, token);
  const day = await send(`/plans/${planId}/days`, { local_date: '2026-11-01', timezone_id: 'Asia/Tokyo' });
  const a = await send(`/plans/${planId}/events`, {
    day_id: day.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '10:00',
    address: '京都市東山区清水1-294', latitude: 34.994856, longitude: 135.785046,
  });
  const b = await send(`/plans/${planId}/events`, {
    day_id: day.id, title: '京の宿', event_type: 'accommodation', local_start_time: '16:00', latitude: 35.01, longitude: 135.77,
  });
  await send(`/plans/${planId}/reservations`, {
    type: 'accommodation', provider_name: '京の宿', confirmation_number: 'E2E99887766', event_id: b.id,
  });
  await send(`/plans/${planId}/segments`, {
    from_event_id: a.id, to_event_id: b.id, mode: 'bus', planned_departure_at: '2026-11-01T06:00:00Z',
  });

  await page.reload();
  await page.getByRole('button', { name: /書き出し/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/exports$`), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: '書き出し', level: 1 })).toBeVisible();
  await axeViolations(page, '書き出し');

  // 1. ICS
  const ics = await download(page, 'ICSを書き出す');
  expect(ics).toContain('BEGIN:VCALENDAR');
  expect(ics).toContain('SUMMARY:清水寺');
  expect(ics).toContain('DTSTART:20261101T010000Z');
  expect(ics).toContain('SUMMARY:バス: 清水寺 → 京の宿');
  expect(ics).not.toContain('E2E99887766');
  expect(ics).not.toContain('清水1-294');
  await expect(page.getByTestId('export-result')).toContainText('calendar.ics を書き出しました(3件)');
  await page.getByRole('checkbox', { name: /住所を含める\(カレンダー/ }).click();
  expect((await download(page, 'ICSを書き出す')).replace(/\r\n /g, '')).toContain('LOCATION:京都市東山区清水1-294');

  // 2. GPX(既定: 約1km・宿泊除外)
  const gpx = await download(page, 'GPXを書き出す');
  expect(gpx).toContain('<wpt lat="34.99" lon="135.79">');
  expect(gpx).not.toContain('京の宿');
  await expect(page.getByTestId('export-result')).toContainText('宿泊場所1件は選択により除外しました');

  // 3. CSV
  const csv = await download(page, 'CSVを書き出す');
  expect(csv.charCodeAt(0)).toBe(0xfeff);
  expect(csv).toContain('2026-11-01,10:00,,観光,清水寺');
  expect(csv).not.toContain('E2E99887766');
  await axeViolations(page, '書き出し(結果表示)');
});
