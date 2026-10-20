import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';
import { apiClient } from './support/api';

/**
 * [Gate C3] FR-009 情報内検索・コマンドパレットの browser E2E。
 *
 * ゲストで旅行・今日の日程・予定・予約(予約番号つき)を用意して次を確かめる。
 *   1. プランの画面で Ctrl+K を押すとコマンドパレットが開き、入力すると予定が分類ごとに出る。↓・Enter で開ける
 *   2. 「今日」で今日の予定が出る
 *   3. 予約番号の末尾(4文字)は、何も絞らないと当たらず、「予約」に絞ると伏せた番号で当たる(平文を出さない)
 *   4. Esc で閉じる。画面に axe(WCAG 2.1 AA)違反が無い
 */
function tokyoDate(offsetDays: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

test('情報内検索: Ctrl+K で開き、予定・今日・予約番号の末尾(伏せた番号)で探し、開ける', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `C3検索E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  const day = await send('post', `/plans/${planId}/days`, { local_date: tokyoDate(0), timezone_id: 'Asia/Tokyo' }) as { id: string };
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', address: '京都市東山区', local_start_time: '10:00' });
  await send('post', `/plans/${planId}/events`, { day_id: day.id, title: '祇園で夕食', local_start_time: '19:00' });
  await send('post', `/plans/${planId}/reservations`, {
    type: 'accommodation', provider_name: '祇園の宿 本館', confirmation_number: 'QZ-7781-5678',
  });
  await send('post', `/plans/${planId}/candidates`, { title: '清水坂の茶店' });

  await page.goto(`/planner/${planId}/candidates`);
  await expect(page.getByRole('heading', { name: '候補箱', level: 1 })).toBeVisible();

  // 1. Ctrl+K → 検索 → Enter で開く
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: '検索' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('combobox', { name: '検索語' });
  await expect(input).toBeFocused();
  const searched = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/plans/${planId}/search`));
  await input.fill('清水');
  expect((await searched).status()).toBe(200);
  const events = dialog.getByRole('group', { name: /予定\(1件\)/ });
  await expect(events.getByRole('option', { name: /清水寺/ })).toHaveAttribute('aria-selected', 'true');
  await expect(dialog.getByRole('group', { name: /候補\(1件\)/ })).toBeVisible();
  await expectNoAxeViolations(page, 'コマンドパレット');
  await input.press('ArrowDown');
  await expect(dialog.getByRole('option', { name: /清水坂の茶店/ })).toHaveAttribute('aria-selected', 'true');
  await input.press('ArrowUp');
  await input.press('Enter');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/planner/${planId}$`));

  // 2. 今日
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  // 開き直しても前の検索語は残る(続けて探せる)。消してから「今日」で絞る
  await expect(dialog.getByRole('combobox')).toHaveValue('清水');
  await dialog.getByRole('combobox').fill('');
  await dialog.getByRole('button', { name: '今日' }).click();
  await expect(dialog.getByRole('group', { name: /予定\(2件\)/ })).toBeVisible();
  await dialog.getByRole('button', { name: '今日' }).click();

  // 3. 予約番号の末尾: 絞らないと当たらず、「予約」に絞ると伏せた番号で当たる
  const plain = page.waitForResponse((r) => new URL(r.url()).searchParams.get('q') === '5678');
  await dialog.getByRole('combobox').fill('5678');
  const plainBody = await (await plain).text();
  expect(plainBody).not.toContain('祇園の宿');
  await expect(dialog.getByText('見つかりませんでした。')).toBeVisible();
  const reserved = page.waitForResponse((r) => new URL(r.url()).searchParams.get('filter') === 'reservation');
  await dialog.getByRole('button', { name: '予約' }).click();
  const body = await (await reserved).text();
  expect(body).not.toContain('7781');
  const hit = dialog.getByRole('option', { name: /祇園の宿 本館/ });
  await expect(hit).toContainText('予約番号の末尾に一致');
  await expect(hit).toContainText('5678');
  await expect(hit).not.toContainText('7781');
  await expectNoAxeViolations(page, 'コマンドパレット(予約)');

  // 4. Esc
  await dialog.getByRole('combobox').press('Escape');
  await expect(dialog).toHaveCount(0);
});
