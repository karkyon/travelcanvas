import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerAccount, type Send } from './support/api';
import { expectNoAxeViolations } from './support/axe';
import { seedBaseline } from '../ux/baselineData';

/**
 * [Gate G9 後半] UX-2 旅行の表紙・UX-3 見出しと移動・UX-4 文脈型ダッシュボードを、実際のブラウザで確かめる。
 *   1. 旅行が無い時は「旅行を始める」。見出しは高さが一定(72px。スマホは 60px)で、項目名を折り返さない(360〜1440px)
 *   2. 旅行中・旅行前・旅行後の旅行がある時は旅行中を焦点にし、NOW/NEXT・準備・遅延と休業・操作(最大4つ)・段階ごとの一覧を出す。
 *      360/390/768/1024/1440px・暗い見た目で、横にはみ出さず axe 違反が無い。旅行の画面は表紙の見出しと「今開いている旅行」を示す
 *   3. 閲覧だけの参加者には招待の操作を出さない
 *   4. API の失敗(再試行で直る)・オフライン(つながると読み直す)
 */
const PASSWORD = 'Gate-G9-Dash-Pass-1';
const WIDTHS = [360, 390, 768, 1024, 1440] as const;

function tokyoToday(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function tokyoLaterTime(): string {
  const now = new Date();
  const hh = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', hour12: false }).format(now));
  if (hh >= 21) return '23:58';
  const later = new Date(now.getTime() + 2 * 3_600_000);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hour12: false }).format(later);
}

async function trip(send: Send, title: string, offsets: number[], events: Array<[string, string]> = []): Promise<string> {
  const plan = await send('post', '/travel-plans/', { title, destination: '奈良' }) as { id: string };
  const days: string[] = [];
  for (const off of offsets) {
    days.push((await send('post', `/plans/${plan.id}/days`, { local_date: tokyoToday(off), timezone_id: 'Asia/Tokyo' }) as { id: string }).id);
  }
  for (const [t, time] of events) {
    await send('post', `/plans/${plan.id}/events`, { day_id: days[0], title: t, event_type: 'sightseeing', local_start_time: time });
  }
  return plan.id;
}

async function expectHeaderStable(page: Page, where: string): Promise<void> {
  // [Gate AppShell] UI/UX モックの上の帯: 高さは 72px(760px 以下は 60px)で一定。画面の移動は左の帯(スマホは下の帯)
  const header = page.getByTestId('global-header');
  const bar = header.locator('.tc-topbar-row').first();
  const width = page.viewportSize()!.width;
  expect((await bar.boundingBox())!.height, `${where} 見出しの高さ`).toBe(width <= 760 ? 60 : 72);
  for (const link of await page.getByRole('navigation', { name: '主なメニュー' }).getByRole('link').all()) {
    if (!(await link.isVisible())) continue;
    const box = (await link.boundingBox())!;
    expect(box.height, `${where} ${await link.getAttribute('href')} の項目名は1行`).toBeLessThanOrEqual(62);
  }
}

async function expectNoOverflow(page: Page, where: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${where} 横のはみ出し(px)`).toBeLessThanOrEqual(1);
}

test('UX-4 旅行が無い時は旅行を始める案内。UX-3 見出しは高さが一定で折り返さない', async ({ page }) => {
  test.setTimeout(120_000);
  await registerAccount(page, { prefix: 'g9', label: 'empty', password: PASSWORD });
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 860 });
    await page.goto('/dashboard');
    const hero = page.getByTestId('dashboard-hero');
    await expect(hero).toBeVisible();
    await expect(hero.getByRole('link').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'この旅行の操作' })).toHaveCount(0);
    await expectHeaderStable(page, `旅行なし ${w}px`);
    await expectNoOverflow(page, `旅行なし ${w}px`);
  }
  await expectNoAxeViolations(page, 'ダッシュボード(旅行なし)');
});

test('UX-2・UX-3・UX-4 旅行中を焦点に、全ての幅・暗い見た目で読め、旅行の画面は表紙の見出し', async ({ page }) => {
  test.setTimeout(300_000);
  const { planId: upcoming, send } = await seedBaseline(page, 'g9');
  await trip(send, '先月の奈良', [-12, -11]);
  const ongoing = await trip(send, '今日の奈良', [0, 1], [['東大寺', tokyoLaterTime()]]);

  for (const w of WIDTHS) {
    const where = `ダッシュボード ${w}px`;
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto('/dashboard');
    const hero = page.getByTestId('dashboard-hero');
    await expect(hero, where).toHaveAttribute('data-phase', 'ongoing');
    await expect(hero.getByRole('heading', { level: 2 })).toHaveText('今日の奈良');
    await expect(page.getByTestId('dashboard-phase')).toHaveText('旅行中');
    await expect(page.getByTestId('dashboard-nownext')).toContainText('東大寺');
    const actions = page.getByRole('navigation', { name: 'この旅行の操作' });
    const n = await actions.getByRole('link').count();
    expect(n, where).toBeGreaterThan(0);
    expect(n, where).toBeLessThanOrEqual(4);
    await expect(page.getByRole('list', { name: '旅行中の旅行' }).getByTestId(`trip-card-${ongoing}`)).toBeVisible();
    await expect(page.getByRole('list', { name: '旅行前の旅行' }).getByTestId(`trip-card-${upcoming}`)).toContainText('京都 紅葉の1泊2日');
    await expect(page.getByRole('list', { name: '旅行後の旅行' })).toContainText('先月の奈良');
    await expect(page.getByTestId('dashboard')).not.toContainText('Invalid Date');
    await expectHeaderStable(page, where);
    await expectNoOverflow(page, where);
    if (w === 360 || w === 1440) await expectNoAxeViolations(page, where);
  }

  // 暗い見た目(この端末に保存。読み直しても続く)
  await page.getByLabel('表示').selectOption('dark');
  await expect(page.getByTestId('dashboard')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.getByTestId('dashboard')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByTestId('dashboard-hero')).toBeVisible();
  await expectNoAxeViolations(page, 'ダッシュボード(暗い・1440px)');
  await page.setViewportSize({ width: 390, height: 844 });
  await expectNoAxeViolations(page, 'ダッシュボード(暗い・390px)');
  await page.getByLabel('表示').selectOption('light');

  // 旅行の画面: 表紙の見出し・今開いている旅行・状態は文字で示す
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByTestId(`trip-card-${upcoming}`).click();
  await expect(page).toHaveURL(new RegExp(`/planner/${upcoming}$`));
  const cover = page.getByTestId('trip-header-cover');
  // [Gate MockScreens] 旅程の画面の h1 は page-head(旅行の名前)。表紙の名前は2段目
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('京都 紅葉の1泊2日');
  await expect(cover.getByRole('heading', { level: 2 })).toHaveText('京都 紅葉の1泊2日');
  await expect(page.getByTestId('header-current-trip')).toContainText('京都 紅葉の1泊2日');
  await expectHeaderStable(page, '旅行の画面 1024px');
  for (const w of [360, 1440]) {
    await page.setViewportSize({ width: w, height: 900 });
    await expectNoOverflow(page, `旅行の画面 ${w}px`);
  }
  await expectNoAxeViolations(page, '旅行の画面(表紙の見出し)');
});

test('UX-4 閲覧だけの参加者には招待の操作を出さない', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const { planId, send } = await seedBaseline(page, 'g9own');
  const ctx = await browser.newContext();
  const viewerPage = await ctx.newPage();
  try {
    const v = await registerAccount(viewerPage, { prefix: 'g9', label: 'viewer', password: PASSWORD });
    const sendV = apiClient(viewerPage.request, v.apiBase, v.token);
    await send('post', `/travel-plans/${planId}/collaborators`, { email: v.email, role: 'viewer' });
    const inv = (await sendV('get', '/travel-plans/invitations') as Array<{ id: string; plan_id: string }>)
      .find((i) => i.plan_id === planId)!;
    await sendV('post', `/travel-plans/invitations/${inv.id}/accept`);
    await viewerPage.goto('/dashboard');
    const hero = viewerPage.getByTestId('dashboard-hero');
    await expect(hero).toHaveAttribute('data-phase', 'upcoming');
    await expect(hero).toContainText('閲覧のみ');
    const actions = viewerPage.getByRole('navigation', { name: 'この旅行の操作' });
    await expect(actions.getByRole('link', { name: /旅程を開く/ })).toBeVisible();
    await expect(actions.getByRole('link', { name: /一緒に行く人を招く/ })).toHaveCount(0);
    await expectNoAxeViolations(viewerPage, 'ダッシュボード(閲覧のみ)');
  } finally {
    await ctx.close();
  }
  // 所有者には招待の操作が出る
  await page.goto('/dashboard');
  await expect(page.getByRole('navigation', { name: 'この旅行の操作' }).getByRole('link', { name: /一緒に行く人を招く/ })).toBeVisible();
});

test('UX-4 API の失敗は再試行で直り、オフラインはつながると読み直す', async ({ page, context }) => {
  test.setTimeout(120_000);
  await seedBaseline(page, 'g9err');
  let fail = true;
  await page.route('**/api/v1/dashboard', async (route) => {
    if (fail) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ detail: '一時的な失敗' }) });
    else await route.continue();
  });
  await page.goto('/dashboard');
  const err = page.getByTestId('dashboard-error');
  await expect(err).toBeVisible();
  await expect(err).toHaveAttribute('role', 'alert');
  await expectNoAxeViolations(page, 'ダッシュボード(読み込みの失敗)');
  fail = false;
  await err.getByRole('button', { name: 'もう一度読み込む' }).click();
  await expect(page.getByTestId('dashboard-hero')).toHaveAttribute('data-phase', 'upcoming');
  await page.unroute('**/api/v1/dashboard');

  // 旅程の一覧を一度開いて(画面の塊を読み込んでおく)、オフラインでダッシュボードへ戻る
  // [Gate AppShell] 旅行の外では、上の帯の「旅行を選ぶ」が旅程の一覧へ移る
  await page.getByTestId('header-trip-picker').click();
  await expect(page).toHaveURL(/\/planner$/);
  // URL は先に変わり、画面の塊を読み込む間はダッシュボードの見出しが残る。プランナーの見出しが出て
  // ダッシュボードが閉じたことを確かめてから切る(閉じる前に切ると、開いたままのダッシュボードへ戻るだけで読み直さない)
  await expect(page.getByRole('heading', { level: 1, name: 'プランナー' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: '次の旅を、楽しみに変える' })).toHaveCount(0);
  await context.setOffline(true);
  await page.getByRole('navigation', { name: '主なメニュー' }).getByRole('link', { name: 'ホーム' }).click();
  await expect(page.getByTestId('dashboard-offline')).toContainText('オフラインです');
  await expectNoAxeViolations(page, 'ダッシュボード(オフライン)');
  await context.setOffline(false);
  await expect(page.getByTestId('dashboard-hero')).toHaveAttribute('data-phase', 'upcoming');
});
