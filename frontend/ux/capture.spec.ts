import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { SCREENS, VIEWPORTS, seedBaseline } from './baselineData';

/**
 * [Gate G9] UX-0 今の6画面を PC(1440×900)・スマホ(390×844)で撮る。docs/ux/baseline/<画面>-<幅>.jpg に置く。
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
