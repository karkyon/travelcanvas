import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerMember, type Send } from './support/api';
import { startGuestPlanViaApi } from './support/guestPlan';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate E1] FR-021/044/045 共有リンク・FR-047 旅程の複製の browser E2E。
 * [Gate G10-Q] FR-044 Guest Travel View: 未ログインの閲覧(合言葉・失効)はこの spec が証拠。
 *
 * 1. 会員が合言葉つきの共有リンクを発行する。QR は端末内で作り、共有 URL を外部へ送らない。
 *    ログインしていない別のブラウザで開くと合言葉の入力を求め(以前は /login へ飛ばされた)、
 *    誤った合言葉は拒否し、正しい合言葉で閲覧できる。閲覧画面に予約番号は出ない。
 *    失効すると同じ URL は「無効」になる。
 * 2. 旅程を複製すると日程・予定が新しいプランに写り、予約は写らない。元のプランは変わらない。
 */

const PASSCODE = 'e1-aikotoba-42';
const CONFIRMATION = 'E1SHARECONF777';

async function seedPlan(send: Send, title: string) {
  const plan = await send('post', '/travel-plans/', { title });
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' });
  await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '伏見稲荷E1', local_start_time: '09:00' });
  await send('post', `/plans/${plan.id}/reservations`, {
    type: 'accommodation', provider_name: '共有ホテルE1', confirmation_number: CONFIRMATION,
  });
  return plan.id as string;
}

/** 画面の外(localhost 以外)へ出ていく通信を記録する(Web フォント等も含む) */
function recordExternalRequests(page: Page): string[] {
  const external: string[] = [];
  page.on('request', (r) => {
    if (r.url().startsWith('data:') || r.url().startsWith('blob:')) return;
    const host = new URL(r.url()).hostname;
    if (!['localhost', '127.0.0.1'].includes(host)) external.push(r.url());
  });
  return external;
}

test('共有リンク: 合言葉つきで発行し、QRは端末内で作り、未ログインの閲覧は合言葉を求め、失効すると開けない', async ({ page, browser }) => {
  const member = await registerMember(page, 'share');
  const send = apiClient(page.request, member.apiBase, member.token);
  const title = `E1共有E2E-${Date.now()}`;
  const planId = await seedPlan(send, title);

  const external = recordExternalRequests(page);
  await page.goto(`/share/${planId}`);
  await expect(page.getByRole('heading', { name: /プラン共有・権限設定/, level: 1 })).toBeVisible();
  await expectNoAxeViolations(page, '共有設定(発行前)');

  // 1. 合言葉つきで発行
  await page.getByLabel('パスコード保護（任意）').fill(PASSCODE);
  await page.getByRole('button', { name: '共有リンクを発行' }).click();
  const urlBox = page.getByLabel('発行した共有URL');
  await expect(urlBox).toBeVisible();
  const shareUrl = await urlBox.inputValue();
  expect(shareUrl).toMatch(/\/s\/[A-Za-z0-9_-]{20,}$/);

  // 2. QR は data URL(端末内生成)。共有 URL のトークンを含む通信・QR 作成サービスへの通信が無い
  const qr = page.getByRole('img', { name: '共有リンクのQRコード' });
  await expect(qr).toBeVisible();
  expect(await qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  const shareToken = shareUrl.split('/s/')[1];
  const leaked = external.filter((u) => u.includes(shareToken) || u.includes(encodeURIComponent(shareUrl)) || /qrserver|qr-code|chart\.googleapis/.test(u));
  expect(leaked, `共有トークンを外部へ送った通信: ${leaked.join(', ')}`).toEqual([]);
  await expectNoAxeViolations(page, '共有設定(発行直後)');

  // 3. ログインしていない別のブラウザで開く
  const anonymous = await browser.newContext();
  const viewer = await anonymous.newPage();
  await viewer.goto(shareUrl);
  await expect(viewer.getByRole('heading', { name: 'パスコードが必要です' })).toBeVisible();
  expect(new URL(viewer.url()).pathname).toMatch(/^\/s\//); // /login へ飛ばされない
  await expectNoAxeViolations(viewer, '公開閲覧(合言葉の入力)');

  await viewer.getByLabel('パスコード').fill('wrong-passcode');
  await viewer.getByRole('button', { name: '閲覧する' }).click();
  await expect(viewer.getByRole('alert')).toHaveText('パスコードが正しくありません');
  expect(new URL(viewer.url()).pathname).toMatch(/^\/s\//);

  await viewer.getByLabel('パスコード').fill(PASSCODE);
  await viewer.getByRole('button', { name: '閲覧する' }).click();
  await expect(viewer.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(viewer.getByText('伏見稲荷E1')).toBeVisible();
  await expect(viewer.locator('body')).not.toContainText(CONFIRMATION);
  await expect(viewer.locator('body')).not.toContainText('共有ホテルE1');
  await expectNoAxeViolations(viewer, '公開閲覧(プラン)');

  // 4. 失効すると同じ URL は無効
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: /共有リンク「.+」を失効させる/ }).click();
  await expect(page.getByText('失効済み', { exact: true })).toBeVisible();
  // (失効の判定は合言葉の確認より先に行うため、合言葉の入力欄は出ない)
  await viewer.goto(shareUrl);
  await expect(viewer.getByRole('heading', { name: 'このリンクは無効です' })).toBeVisible();
  await expect(viewer.getByLabel('パスコード')).toHaveCount(0);
  await anonymous.close();
});

test('旅程の複製: 日程・予定は新しいプランに写り、予約は写らず、元のプランは変わらない', async ({ page }) => {
  // 複製はゲストでも使える。会員登録の回数制限(同じ IP から1分5回)を使わないようゲストで行う。
  const guest = await startGuestPlanViaApi(page, `E1複製の土台-${Date.now()}`, { open: false });
  const send = apiClient(page.request, guest.apiBase, guest.token);
  const title = `E1複製E2E-${Date.now()}`;
  const planId = await seedPlan(send, title);

  await page.goto('/planner');
  const original = page.getByRole('listitem', { name: title });
  await expect(original).toBeVisible();
  await expectNoAxeViolations(page, 'プラン一覧');

  page.once('dialog', (d) => d.accept());
  await original.getByRole('button', { name: `「${title}」を複製` }).click();
  const copy = page.getByRole('listitem', { name: `${title}のコピー` });
  await expect(copy).toBeVisible();

  // 複製先: 日程・予定はある、予約は無い
  const plans = await send('get', '/travel-plans/');
  const list = plans.plans as Array<{ id: string; title: string }>;
  const cloned = list.find((p) => p.title === `${title}のコピー`);
  expect(cloned, '複製したプランが一覧APIにありません').toBeTruthy();
  const clonedDetail = await send('get', `/plans/${cloned!.id}`);
  const events = clonedDetail.days.flatMap((d: { events: Array<{ title: string }> }) => d.events.map((e) => e.title));
  expect(events).toEqual(['伏見稲荷E1']);
  const clonedReservations = await send('get', `/plans/${cloned!.id}/reservations`);
  expect(clonedReservations).toHaveLength(0);

  // 元のプランは変わらない
  const originalReservations = await send('get', `/plans/${planId}/reservations`);
  expect(originalReservations).toHaveLength(1);

  // 複製したプランを画面で開ける
  await copy.getByRole('button', { name: `「${title}のコピー」を開く` }).click();
  await page.waitForURL(new RegExp(`/planner/${cloned!.id}$`), { timeout: 15_000 });
  await expect(page.getByText('伏見稲荷E1').first()).toBeVisible();
});
