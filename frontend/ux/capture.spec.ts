import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { CHECK_VIEWPORTS, SCREENS, VIEWPORTS, seedBaseline } from './baselineData';

/**
 * [Gate G9] UX-0 今の6画面を PC(1440×900)・スマホ(390×844)で撮る。docs/ux/baseline/<画面>-<幅>.jpg に置く。
 * 後半(UX-2〜UX-4)で、ダッシュボードの旅行中・タブレット(768px)・暗い見た目も撮る(dashboard-ongoing-*.jpg・dashboard-dark-*.jpg)。
 * 時刻・乱数で変わる所(登録した名前など)は写るが、見比べるのは配置・情報の順番・操作の場所。
 */
const OUT = path.resolve(process.cwd(), '..', 'docs', 'ux', 'baseline');

test('UX-0 今の画面を撮る', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { planId } = await seedBaseline(page, 'cap');
  for (const vp of VIEWPORTS) {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    for (const s of SCREENS) {
      await page.goto(s.path(planId));
      await page.getByRole('main').first().waitFor();
      await page.waitForLoadState('networkidle');
      await page.screenshot({ path: path.join(OUT, `${s.id}-${vp.id}.jpg`), type: 'jpeg', quality: 60, fullPage: false });
    }
  }
});

test('UX-4 ダッシュボード(旅行中・タブレット・暗い見た目)を撮る', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const { send } = await seedBaseline(page, 'cap4');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date());
  const plan = await send('post', '/travel-plans/', { title: '今日の奈良', destination: '奈良' }) as { id: string };
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: today, timezone_id: 'Asia/Tokyo' }) as { id: string };
  await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '東大寺', event_type: 'sightseeing', local_start_time: '23:58' });
  const shots: Array<[string, number, number, 'light' | 'dark']> = [
    ['dashboard-ongoing-desktop', 1440, 900, 'light'], ['dashboard-ongoing-mobile', 390, 844, 'light'],
    ['dashboard-ongoing-tablet', CHECK_VIEWPORTS.find((v) => v.id === 'tablet')!.width, 1024, 'light'],
    ['dashboard-dark-desktop', 1440, 900, 'dark'], ['dashboard-dark-mobile', 390, 844, 'dark'],
  ];
  for (const [name, width, height, theme] of shots) {
    await page.setViewportSize({ width, height });
    await page.goto('/dashboard');
    await page.getByTestId('dashboard-hero').waitFor();
    await page.getByLabel('表示').selectOption(theme);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 60, fullPage: false });
  }
});
