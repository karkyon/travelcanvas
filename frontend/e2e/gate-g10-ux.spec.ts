import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient } from './support/api';
import { startGuestPlanViaApi } from './support/guestPlan';
import { seedBaseline } from '../ux/baselineData';

/**
 * [Gate G10-UX] UX-5 当日の画面・UX-6 共通の部品・UX-8 暗い見た目を全ての画面へ の browser E2E。
 *
 * 1. 設定の「テーマ」で暗い見た目を選ぶと、全ての画面(<html data-theme="dark">)が暗くなり、読み直しても続く。
 *    主な画面を 1440px・360px で開き、横にはみ出さず axe(WCAG 2.1 AA。暗い地の文字のコントラストを含む)違反が無い
 * 2. 当日の画面(スマホ 390px): 今(残り・進み)→ 次(出発まで)→ この後の予定・済んだ数。簡易表示は今と次だけで、
 *    端末に覚える。当日の操作は画面の下(親指の届く所)にあり、押せる大きさ(高さ 44px 以上)。明るい・暗いで axe 違反が無い
 */

async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${where}: 横にはみ出している`).toBeLessThanOrEqual(0);
}

test('UX-8 設定で選んだ暗い見た目が全ての画面に効き、読み直しても続き、主な画面に axe 違反が無い', async ({ page }) => {
  test.setTimeout(600_000);
  const { planId } = await seedBaseline(page, 'g10dark');

  await page.goto('/settings?tab=preferences');
  const theme = page.getByLabel('テーマ');
  await expect(theme).toBeVisible({ timeout: 15_000 });
  await theme.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByLabel('テーマ')).toHaveValue('dark');

  const screens = [
    { name: 'ダッシュボード', path: '/dashboard', h1: 'ダッシュボード' },
    { name: 'プランナー', path: `/planner/${planId}`, h1: '京都 紅葉の1泊2日' },
    { name: '今日', path: `/planner/${planId}/today`, h1: '今日' },
    { name: '予約', path: `/planner/${planId}/reservations`, h1: null },
    { name: '共有', path: `/share/${planId}`, h1: null },
    { name: '準備', path: `/planner/${planId}/preparation`, h1: null },
    { name: '費用', path: `/planner/${planId}/expenses`, h1: null },
    { name: 'データとプライバシー', path: '/settings/data', h1: 'データとプライバシー' },
    { name: '設定', path: '/settings?tab=preferences', h1: null },
  ];
  for (const width of [1440, 360]) {
    await page.setViewportSize({ width, height: width === 360 ? 780 : 900 });
    for (const s of screens) {
      const where = `${s.name}(暗い・${width}px)`;
      await page.goto(s.path);
      await expect(page.getByRole('main'), where).toHaveCount(1);
      if (s.h1) await expect(page.getByRole('heading', { level: 1, name: s.h1 }), where).toBeVisible({ timeout: 15_000 });
      else await expect(page.getByRole('heading', { level: 1 }), where).toBeVisible({ timeout: 15_000 });
      await expect(page.locator('html'), where).toHaveAttribute('data-theme', 'dark');
      // 地は暗い色(白い地が残っていない)。本文の目印の背景が明るすぎないことを確かめる
      const lum = await page.evaluate(() => {
        const bg = getComputedStyle(document.body).backgroundColor;
        const m = bg.match(/\d+(\.\d+)?/g)?.map(Number) ?? [255, 255, 255];
        return (0.2126 * m[0]! + 0.7152 * m[1]! + 0.0722 * m[2]!) / 255;
      });
      expect(lum, `${where}: 地が暗くない`).toBeLessThan(0.2);
      await expectNoOverflow(page, where);
      await expectNoAxeViolations(page, where);
    }
  }

  // 明るい見た目へ戻す(この端末の選択を消す)
  await page.goto('/settings?tab=preferences');
  await page.getByLabel('テーマ').selectOption('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test.describe('UX-5 当日の画面(スマホ)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, locale: 'ja-JP' });

  test('今(残り・進み)→ 次(出発まで)→ この後の予定。簡易表示は端末に覚え、操作は画面の下で押せる大きさ', async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString();
    const r = await startGuestPlanViaApi(page, `G10当日-${suffix}`);
    const send = apiClient(page.request, r.apiBase, r.token);
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fmt = (d: Date) => {
      const p = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
      const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
      return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
    };
    // 今の時刻の前後に予定を置く(日をまたがない時間帯なら、済んだ・今・次・この後 の4つ)
    const now = Date.now();
    const at = (min: number) => new Date(now + min * 60_000);
    const today = fmt(at(0)).date;
    const sameDay = [-150, -20, 60, 150].every((m) => fmt(at(m)).date === today);
    test.skip(!sameDay, '日をまたぐ時間帯(端末の 0 時の前後)は予定を同じ日に置けない');
    const day = await send('post', `/plans/${r.planId}/days`, { local_date: today, timezone_id: zone }) as { id: string };
    const titles = { done: `済み-${suffix}`, now: `今-${suffix}`, next: `次-${suffix}`, later: `後-${suffix}` };
    await send('post', `/plans/${r.planId}/events`, { day_id: day.id, title: titles.done, local_start_time: fmt(at(-150)).hhmm });
    await send('post', `/plans/${r.planId}/events`, { day_id: day.id, title: titles.now, local_start_time: fmt(at(-20)).hhmm });
    await send('post', `/plans/${r.planId}/events`, { day_id: day.id, title: titles.next, local_start_time: fmt(at(60)).hhmm });
    await send('post', `/plans/${r.planId}/events`, { day_id: day.id, title: titles.later, local_start_time: fmt(at(150)).hhmm });

    await page.goto(`/planner/${r.planId}/today`);
    await expect(page.getByRole('heading', { level: 1, name: '今日' })).toBeVisible({ timeout: 15_000 });
    const nowCard = page.getByTestId('today-now');
    const nextCard = page.getByTestId('today-next');
    await expect(nowCard.getByRole('heading', { name: titles.now })).toBeVisible();
    await expect(nowCard.getByRole('progressbar', { name: '今の予定の進み' })).toBeVisible();
    await expect(nowCard.getByText(/^残り \d+分$/)).toBeVisible();
    await expect(nextCard.getByRole('heading', { name: titles.next })).toBeVisible();
    await expect(nextCard.getByTestId('today-countdown')).toHaveText(/^(まもなく|\d+分後|\d+時間(\d+分)?後)$/);
    const later = page.getByRole('list', { name: 'この後の予定' });
    await expect(later.getByText(titles.later)).toBeVisible();
    await expect(later.getByText(titles.next)).toHaveCount(0); // 次の予定は一覧に重ねない
    await expect(page.getByTestId('today-summary')).toHaveText(/済んだ予定 1件/);
    await expect(page.getByTestId('today-sync')).toHaveText('最新');
    await expectNoAxeViolations(page, '当日(明るい・390px)');

    // 当日の操作: 画面の下(親指の届く所)に固定され、押せる大きさ
    const nav = page.getByRole('navigation', { name: '当日の操作' });
    for (const name of [/遅延・休業などの対応/, /^プランへ$/]) {
      const box = await nav.getByRole('button', { name }).boundingBox();
      expect(box, String(name)).not.toBeNull();
      expect(box!.height, String(name)).toBeGreaterThanOrEqual(44);
      expect(box!.y + box!.height, String(name)).toBeLessThanOrEqual(844);
      expect(box!.y, String(name)).toBeGreaterThan(844 * 0.75);
    }
    await expectNoOverflow(page, '当日(390px)');

    // 簡易表示: 今と次だけ。読み直しても続く
    await page.getByRole('button', { name: '簡易表示' }).click();
    await expect(page.getByRole('list', { name: 'この後の予定' })).toHaveCount(0);
    await page.reload();
    await expect(nowCard.getByRole('heading', { name: titles.now })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('button', { name: '簡易表示: 入' })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('list', { name: 'この後の予定' })).toHaveCount(0);
    await page.getByRole('button', { name: '簡易表示: 入' }).click();
    await expect(page.getByRole('list', { name: 'この後の予定' })).toBeVisible();

    // 暗い見た目でも読める(この端末の選択)
    await page.evaluate(() => window.localStorage.setItem('tc.theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(nowCard.getByRole('heading', { name: titles.now })).toBeVisible({ timeout: 15_000 });
    await expectNoAxeViolations(page, '当日(暗い・390px)');
    await page.evaluate(() => window.localStorage.removeItem('tc.theme'));
  });
});
