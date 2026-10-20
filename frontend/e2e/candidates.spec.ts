import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { startGuestPlanViaApi } from './support/guestPlan';
import { apiClient } from './support/api';

/**
 * [Gate C2] FR-007 候補箱・FR-008 場所の一元管理の browser E2E。
 *
 * ゲストで旅行と日程を用意して次を確かめる。
 *   1. URL で候補を足すと、追跡用の付け足し(utm_*)を外した URL が出典になり、名前はサイト名になる
 *   2. 同じ名前・近い場所の候補を足すと重複の可能性を理由つきで示し(自動では消さない)、まとめられる
 *   3. 旅程に追加(日・時刻)すると予定ができ、候補は「予定に配置済み」で残る
 *   4. 場所の詳細で電話・入口・営業時間を直すと、出典が「利用者の入力」になる
 *   5. 予定を消すと、候補は「候補」に戻る
 *   6. 画面に axe(WCAG 2.1 AA)違反が無い
 */
function tokyoDate(offsetDays: number): string {
  const d = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86400_000);
  return d.toISOString().slice(0, 10);
}

test('候補箱: URL で足し、重複をまとめ、旅程に追加し、場所を直し、予定を消すと候補に戻る', async ({ page, context }) => {
  const { planId, apiBase, token } = await startGuestPlanViaApi(page, `C2候補箱E2E-${Date.now()}`, { open: false });
  const send = apiClient(context.request, apiBase, token);
  await send('post', `/plans/${planId}/days`, { local_date: tokyoDate(3), timezone_id: 'Asia/Tokyo' });

  // 1. URL で足す
  await page.goto(`/planner/${planId}/candidates`);
  await expect(page.getByRole('heading', { name: '候補箱', level: 1 })).toBeVisible();
  const form = page.getByRole('form', { name: '候補を追加' });
  await form.getByLabel('URL(任意)').fill('https://www.kiyomizudera.or.jp/?utm_source=e2e&utm_medium=x');
  await form.getByLabel('優先度').selectOption('1');
  await form.getByRole('button', { name: '候補に追加' }).click();
  await expect(page.getByRole('status')).toHaveText('候補を追加しました');
  const first = page.getByRole('article', { name: 'kiyomizudera.or.jp' }).first();
  await expect(first.getByRole('link', { name: 'kiyomizudera.or.jp' })).toHaveAttribute('href', 'https://www.kiyomizudera.or.jp/');
  await expect(first.getByTestId('candidate-status')).toHaveText('候補');
  await expectNoAxeViolations(page, '候補箱');

  // 2. 重複 → まとめる
  await form.getByLabel('名前').fill('kiyomizudera.or.jp');
  await form.getByLabel('メモ(任意)').fill('夕方も良い');
  await form.getByRole('button', { name: '候補に追加' }).click();
  await expect(page.getByRole('status')).toHaveText('候補を追加しました');
  await expect(page.getByText('重複の可能性がある候補が 1組あります(自動では消しません)。')).toBeVisible();
  const cards = page.getByRole('region', { name: '候補の一覧' }).getByRole('article');
  await expect(cards).toHaveCount(2);
  await cards.nth(1).getByRole('button', { name: /にまとめる$/ }).click();
  await expect(page.getByRole('status')).toContainText('にまとめました');
  await expect(cards).toHaveCount(1);
  await expect(cards.first()).toContainText('まとめた候補: kiyomizudera.or.jp');

  // 3. 旅程に追加
  const card = cards.first();
  await card.getByLabel('時刻').fill('10:00');
  await card.getByRole('button', { name: 'kiyomizudera.or.jpを旅程に追加' }).click();
  await expect(page.getByRole('status')).toHaveText('「kiyomizudera.or.jp」を旅程に追加しました');
  await expect(card.getByTestId('candidate-status')).toHaveText('予定に配置済み');
  const detail = await send('get', `/plans/${planId}`) as { revision: number; days: Array<{ events: Array<{ id: string; title: string; local_start_time: string | null; place_id: string | null }> }> };
  const ev = detail.days.flatMap((d) => d.events).find((e) => e.title === 'kiyomizudera.or.jp');
  expect(ev?.local_start_time).toBe('10:00');
  expect(ev?.place_id).toBeTruthy();

  // 4. 場所の詳細を直す
  await card.getByRole('link', { name: '場所の詳細' }).click();
  await expect(page.getByRole('heading', { name: '場所の詳細', level: 1 })).toBeVisible();
  const placeForm = page.getByRole('form', { name: '場所の情報を直す' });
  await expect(page.getByTestId('source-name')).toContainText('出典: 登録した URL');
  await placeForm.getByLabel('正式名').fill('音羽山 清水寺');
  await placeForm.getByLabel('電話').fill('075-551-1234');
  await placeForm.getByLabel('入口').fill('仁王門から');
  await placeForm.getByRole('button', { name: '場所の情報を保存' }).click();
  await expect(page.getByRole('status')).toHaveText('場所の情報を保存しました');
  await expect(page.getByTestId('source-phone')).toContainText('出典: 利用者の入力');
  const hours = page.getByRole('region', { name: '営業時間' });
  await hours.getByRole('button', { name: '営業時間を追加' }).click();
  await hours.getByLabel('開く').fill('06:00');
  await hours.getByLabel('閉じる').fill('18:00');
  await hours.getByRole('button', { name: '営業時間を保存' }).click();
  await expect(page.getByRole('status')).toHaveText('営業時間を保存しました');
  await expect(page.getByRole('region', { name: 'この場所を使う予定' })).toContainText('kiyomizudera.or.jp');
  await expectNoAxeViolations(page, '場所の詳細');

  // 5. 予定を消すと候補に戻る
  const now = await send('get', `/plans/${planId}`) as { revision: number };
  await send('delete', `/plans/${planId}/events/${ev!.id}`, undefined, { 'If-Match': String(now.revision) });
  await page.goto(`/planner/${planId}/candidates`);
  await expect(page.getByRole('region', { name: '候補の一覧' }).getByRole('article').first().getByTestId('candidate-status')).toHaveText('候補');
});
