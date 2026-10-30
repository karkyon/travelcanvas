import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerAccount } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate UX6-Icons2] 画面に出る文字に OS のカラー絵文字を使わない(UiIcon の SVG と文字にした)。
 *   1. 旅程・移動区間・経路の比較・遅延の対応・共有・設定・検索・検索の設定・スポット一覧・旅行相談で、本文の文字に
 *      カラー絵文字(Emoji_Presentation・U+FE0F)が無い。旅行名・メモなど利用者の入力は対象にしない(試験の入力に絵文字を使わない)
 *   2. 確定の予定には「確定」の印が出る(並べ替えの知らせ「確定の予定のため動かせません」が指す印)
 *   3. 暗い見た目でもアイコンは文字の色に従う(読み上げから外れている)
 */

const PASSWORD = 'Gate-UX6-TestPass-1';
const EMOJI = /\p{Emoji_Presentation}|\u{FE0F}|(?=\p{Extended_Pictographic})[\u{1F000}-\u{1FAFF}]/u;

async function emojiIn(page: Page): Promise<string[]> {
  const text = await page.locator('body').innerText();
  return text.split('\n').filter((line) => EMOJI.test(line));
}

test('画面に出る文字に OS のカラー絵文字が無く、確定の予定に「確定」の印が出る', async ({ page }) => {
  test.setTimeout(180_000);
  const a = await registerAccount(page, { prefix: 'ux6', label: 'icons', password: PASSWORD });
  const send = apiClient(page.request, a.apiBase, a.token);
  const plan = await send('post', '/travel-plans/', { title: `UX6-${Date.now()}`, destination: '京都' }) as { id: string };
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-21', timezone_id: 'Asia/Tokyo' }) as { id: string };
  const ev = await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '宿', event_type: 'accommodation', local_start_time: '18:00' }) as { id: string };
  await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '清水寺', event_type: 'sightseeing', local_start_time: '09:00' });
  const detail = await send('get', `/plans/${plan.id}`) as { revision: number };
  await send('put', `/plans/${plan.id}/events/${ev.id}`, { locked: true }, { 'If-Match': String(detail.revision) });

  await page.goto(`/planner/${plan.id}`);
  const list = page.getByRole('list', { name: /の予定$/ });
  await expect(list).toBeVisible();
  const locked = list.getByTestId('schedule-locked');
  await expect(locked).toHaveCount(1);
  await expect(locked).toContainText('確定');
  await expect(list.getByRole('listitem', { name: '宿(上下矢印キーで並べ替え)' }).getByTestId('schedule-locked')).toBeVisible();
  await expect(list.getByTestId('schedule-category').first().getByTestId('ui-icon')).toHaveAttribute('aria-hidden', 'true');
  expect(await emojiIn(page), '旅程').toEqual([]);

  for (const [path, label] of [
    [`/planner/${plan.id}/segments`, '移動区間'],
    [`/planner/${plan.id}/route-options`, '経路の比較'],
    [`/planner/${plan.id}/alerts`, '遅延の対応'],
    [`/share/${plan.id}`, '共有'],
    ['/settings', '設定'],
    ['/search', '検索'],
    ['/search/settings', '検索の設定'],
    ['/spots', 'スポット一覧'],
    ['/trip-consult', '旅行相談'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(await emojiIn(page), label).toEqual([]);
  }

  // 暗い見た目: 旅程の日の集計のアイコンは読み上げから外れ、文字の色に従う
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/planner/${plan.id}`);
  await expect(page.getByRole('list', { name: /の予定$/ })).toBeVisible();
  const icon = page.getByTestId('schedule-category').first().getByTestId('ui-icon');
  const colors = await icon.evaluate((el) => ({ stroke: el.getAttribute('stroke'), color: getComputedStyle(el).color }));
  expect(colors.stroke).toBe('currentColor');
  expect(colors.color).not.toBe('rgb(0, 0, 0)');
  expect(await emojiIn(page), '旅程(暗い見た目)').toEqual([]);
  await expectNoAxeViolations(page, '旅程(暗い見た目・アイコン)');
});
