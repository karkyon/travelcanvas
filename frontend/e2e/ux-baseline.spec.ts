import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { CHECK_VIEWPORTS, SCREENS, seedBaseline } from '../ux/baselineData';

/**
 * [Gate G9] UX-0 今の6画面の「壊してはいけない所」(docs/ux/UX-0_baseline.md §3)を、360・390・768・1024・1440px の幅で確かめる
 * (後半の UX-2〜UX-4 で 768・1024・360 を足した)。
 * 見た目の改修(UX-2 以降)の前後で、この試験が通り続けることを条件にする。
 *   - 本文の目印(main)と見出し(h1)が1つずつある
 *   - 横にはみ出さない(スマホで横に動かさなくても全部読める)
 *   - その画面の主な情報が見える(予定・予約の名前)。予約番号はそのままの形で出さない。「Invalid Date」を出さない
 *   - プランナーの操作のボタンが全て画面の中にある(押せる)
 *   - axe(WCAG 2.1 AA)違反が無い
 */
const KEY_TEXT: Record<string, string | null> = {
  dashboard: '京都 紅葉の1泊2日',
  planner: '清水寺',
  today: null, // 旅行の日でないため「今日の予定」は空の案内になる(画面の形だけ確かめる)
  reservations: '祇園の料亭',
  share: '京都 紅葉の1泊2日',
  settings: null,
};

test('UX-0 今の6画面は PC・スマホの幅で、目印・見出し・主な情報を保ち、横にはみ出さない', async ({ page }) => {
  test.setTimeout(480_000);
  const { planId } = await seedBaseline(page, 'base');
  for (const vp of CHECK_VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const s of SCREENS) {
      const where = `${s.name}(${vp.id} ${vp.width}px)`;
      await page.goto(s.path(planId));
      const main = page.getByRole('main');
      await expect(main, where).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 }), where).toHaveCount(1);
      await expect(page.getByRole('heading', { level: 1 }), where).toBeVisible();
      const text = KEY_TEXT[s.id];
      if (text) await expect(main.getByText(text).first(), where).toBeAttached();
      await expect(main, where).not.toContainText('UXBASE1234');
      await expect(main, where).not.toContainText('Invalid Date');
      if (s.id === 'planner') {
        // 旅行の操作のボタンは全て画面の中にある(以前は1行に詰めて左端が画面の外に出て押せなかった)
        for (const b of await page.getByTestId('planner-actions').getByRole('button').all()) {
          const box = await b.boundingBox();
          expect(box && box.x >= 0 && box.x + box.width <= vp.width + 1, `${where} ${await b.innerText()} が画面の中`).toBe(true);
        }
      }
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${where} 横のはみ出し(px)`).toBeLessThanOrEqual(1);
      await expectNoAxeViolations(page, where);
    }
  }
});
