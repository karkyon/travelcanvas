import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G11] 旅行の表紙の写真(docs/ux/G11_UIUX全範囲_実装仕様.md §3.1、UIX-M10・UIX-M11・UIX-M13。FR-037)。
 *
 *   1. 所有者が旅程の見出しの「写真を設定」から写真を取り込み(この旅行内に非公開で保存)、位置と拡大を整えて保存する。
 *      見出し・ダッシュボードの大きな表紙・旅行のカードが同じ写真になり、再読み込みしても続く
 *   2. 閲覧者には変える操作が無く、非公開の写真は見えない(色の表紙)。写真の記録を「メンバー」にすると閲覧者にも見える
 *   3. 所有者が「写真を外す」と色の表紙に戻り、写真の記録は残る
 *   4. 画面の幅 360px・暗い見た目で、表紙の操作と選ぶ画面が崩れない。axe(WCAG 2.1 AA)違反が無い
 */

// 2x2 の PNG(赤・青)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
);

async function hasPhoto(page: Page, testId: string): Promise<void> {
  const cover = page.getByTestId(testId).first();
  await expect(cover).toHaveAttribute('data-has-photo', 'true', { timeout: 20_000 });
  const img = cover.getByTestId('trip-cover-photo');
  await expect(img).toHaveAttribute('src', /^blob:/);
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

test('旅行の表紙の写真: 取り込み・位置・同期・閲覧者には非公開・外す', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = await registerMember(page, 'g11own');
  const sendA = apiClient(page.context().request, owner.apiBase, owner.token);
  const title = `G11表紙E2E-${Date.now()}`;
  const plan = await sendA('post', '/travel-plans/', { title, destination: '京都' });
  const planId = String(plan.id);
  await sendA('post', `/plans/${planId}/days`, { local_date: '2026-11-14', timezone_id: 'Asia/Tokyo' });

  // 1. 取り込み・位置・保存
  await page.goto(`/planner/${planId}`);
  const header = page.getByTestId('trip-header-cover');
  await expect(header).toBeVisible({ timeout: 20_000 });
  await expect(header).not.toHaveAttribute('data-has-photo', 'true');
  await header.getByRole('button', { name: '写真を設定' }).click();
  const dialog = page.getByTestId('cover-photo-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('まだ選べる写真がありません', { exact: false })).toBeVisible();
  await expect(dialog.getByText(/撮影情報\(撮影位置など\)は取り除きます/)).toBeVisible();
  await dialog.getByTestId('cover-upload-input').setInputFiles({ name: 'kyoto.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByText('非公開(自分だけ)で保存しました', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(dialog.getByTestId('cover-private-note')).toBeVisible();
  await dialog.getByTestId('cover-zoom').fill('160');
  await dialog.getByRole('button', { name: '横の位置を減らす' }).click();
  for (const size of ['hero', 'header', 'card']) await hasPhoto(page, `cover-preview-${size}`);
  await expectNoAxeViolations(page, '表紙の写真を選ぶ画面');
  await dialog.getByTestId('cover-save').click();
  await expect(dialog).toBeHidden();
  await hasPhoto(page, 'trip-header-cover');
  await expect(header.getByRole('button', { name: '写真を変更' })).toBeVisible();
  const saved = await sendA('get', `/plans/${planId}/cover`);
  expect(saved.cover).toMatchObject({ zoom: 160, focus_x: 45, focus_y: 50, visibility: 'private' });
  const style = await header.getByTestId('trip-cover-photo').getAttribute('style');
  expect(style).toContain('45% 50%');
  expect(style).toContain('scale(1.6)');

  await page.reload();
  await hasPhoto(page, 'trip-header-cover');
  await page.goto('/dashboard');
  await hasPhoto(page, 'dashboard-hero');
  await expectNoAxeViolations(page, 'ダッシュボード(表紙の写真)');

  // 2. 閲覧者
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const viewer = await registerMember(pageB, 'g11view');
    const sendB = apiClient(ctxB.request, viewer.apiBase, viewer.token);
    await sendA('post', `/travel-plans/${planId}/collaborators`, { email: viewer.email, role: 'viewer' });
    const invitations = await sendB('get', '/travel-plans/invitations');
    const invitation = invitations.find((i: { plan_id: string }) => i.plan_id === planId);
    await sendB('post', `/travel-plans/invitations/${invitation.id}/accept`);

    await pageB.goto(`/planner/${planId}`);
    const headerB = pageB.getByTestId('trip-header-cover');
    await expect(headerB).toContainText(title, { timeout: 20_000 });
    await expect(headerB.getByRole('button', { name: /写真を(設定|変更)/ })).toHaveCount(0);
    await expect(headerB).not.toHaveAttribute('data-has-photo', 'true');
    expect((await sendB('get', `/plans/${planId}/cover`)).cover).toBeNull();

    const memories = await sendA('get', `/plans/${planId}/memories`);
    const photo = memories.memories.find((m: { kind: string }) => m.kind === 'photo');
    await sendA('patch', `/plans/${planId}/memories/${photo.id}`, { visibility: 'members' }, { 'If-Match': String(photo.revision) });
    await pageB.reload();
    await hasPhoto(pageB, 'trip-header-cover');
    await expect(headerB.getByRole('button', { name: /写真を(設定|変更)/ })).toHaveCount(0);
  } finally {
    await ctxB.close();
  }

  // 3. 外す(写真の記録は残る)
  await page.goto(`/planner/${planId}`);
  await header.getByRole('button', { name: '写真を変更' }).click();
  await page.getByTestId('cover-clear').click();
  await expect(page.getByTestId('cover-photo-dialog')).toBeHidden();
  await expect(header).not.toHaveAttribute('data-has-photo', 'true');
  expect((await sendA('get', `/plans/${planId}/cover`)).cover).toBeNull();
  expect((await sendA('get', `/plans/${planId}/memories`)).memories.some((m: { kind: string }) => m.kind === 'photo')).toBe(true);
});

test('表紙の写真の操作: 幅 360px・暗い見た目で崩れない', async ({ page }) => {
  test.setTimeout(120_000);
  const owner = await registerMember(page, 'g11mob');
  const send = apiClient(page.context().request, owner.apiBase, owner.token);
  const plan = await send('post', '/travel-plans/', { title: `G11表紙スマホ-${Date.now()}`, destination: '那覇' });
  await page.setViewportSize({ width: 360, height: 780 });
  await page.evaluate(() => window.localStorage.setItem('tc.theme', 'dark'));
  await page.goto(`/planner/${plan.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const header = page.getByTestId('trip-header-cover');
  await header.getByRole('button', { name: '写真を設定' }).click();
  const dialog = page.getByTestId('cover-photo-dialog');
  await dialog.getByTestId('cover-upload-input').setInputFiles({ name: 'naha.png', mimeType: 'image/png', buffer: PNG });
  await expect(dialog.getByTestId('cover-zoom')).toBeVisible({ timeout: 20_000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expectNoAxeViolations(page, '表紙の写真を選ぶ画面(360px・暗い見た目)');
  await dialog.getByTestId('cover-save').click();
  await hasPhoto(page, 'trip-header-cover');
  await expectNoAxeViolations(page, '旅程の見出し(表紙の写真・360px・暗い見た目)');
});
