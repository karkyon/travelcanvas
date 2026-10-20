import { test, expect } from '@playwright/test';
import { apiClient, registerMember } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate F45] FR-045(CA-003)項目単位の共有の規則の browser E2E。
 *
 * 1. 共有設定の画面で「閲覧者に見える内容」を発行前に確かめられる。標準では住所・予約は見せず、見せない件数を示す
 * 2. 機密の項目(予定の住所)は選んでも確認するまで発行できない。確認するとプレビューに住所が出る
 * 3. 発行後に「閲覧者に見える内容を確認」しても使用回数を使わない(上限1回のリンクがまだ開ける)
 * 4. ログインしていない閲覧者には選んだ項目だけが見え、予約番号・選んでいないメモ・予約は見えない
 * 5. 上限1回なので2回目は無効。画面に axe(WCAG 2.1 AA)違反が無い
 */
const CONFIRMATION = 'F45E2ECONF-9137';

test('共有の項目: 発行前に見える内容を確かめ、機密は確認してから選んだ項目だけを共有する', async ({ page, browser }) => {
  // 共有リンクの発行は会員だけ(share.py は get_current_active_user)
  const member = await registerMember(page, 'f45');
  const send = apiClient(page.request, member.apiBase, member.token);
  const title = `F45共有E2E-${Date.now()}`;
  const plan = await send('post', '/travel-plans/', { title }) as { id: string };
  const planId = plan.id;
  const day = await send('post', `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo', title: '東山F45' }) as { id: string };
  await send('post', `/plans/${planId}/events`, {
    day_id: day.id, title: '清水寺F45', address: '京都市東山区清水1-294', local_start_time: '10:00',
    description: '入口メモF45', latitude: 34.9949, longitude: 135.785,
  });
  await send('post', `/plans/${planId}/reservations`, {
    type: 'accommodation', provider_name: '祇園の宿F45', confirmation_number: CONFIRMATION,
  });

  await page.goto(`/share/${planId}`);
  await expect(page.getByRole('heading', { name: /プラン共有・権限設定/, level: 1 })).toBeVisible();

  // 1. 発行前のプレビュー(標準)
  const preview = page.getByRole('region', { name: '閲覧者に見える内容' });
  await expect(preview.getByRole('heading', { name: title, level: 3 })).toBeVisible();
  await expect(preview.getByText('清水寺F45')).toBeVisible();
  await expect(preview.getByText(/予約番号 1件/)).toBeVisible();
  await expect(preview).not.toContainText('京都市東山区清水1-294');
  await expect(preview).not.toContainText(CONFIRMATION);
  await expectNoAxeViolations(page, '共有設定(項目の選択・発行前のプレビュー)');

  // 2. 機密の項目は確認するまで発行できない
  const issue = page.getByRole('button', { name: '共有リンクを発行' });
  await page.getByRole('checkbox', { name: /予定の住所\(機密\)/ }).check();
  await expect(issue).toBeDisabled();
  await expect(page.getByText(/URLを知っている人なら誰でも「予定の住所」を見られます/)).toBeVisible();
  await expectNoAxeViolations(page, '共有設定(機密の確認)');
  const refreshed = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(`/travel-plans/${planId}/share-preview`) && r.status() === 200);
  await page.getByRole('checkbox', { name: '機密の項目を見せることを確認しました' }).check();
  await refreshed;
  await expect(preview.getByText('住所: 京都市東山区清水1-294')).toBeVisible();
  await expect(issue).toBeEnabled();

  await page.getByLabel('最大使用回数（任意）').fill('1');
  await issue.click();
  const urlBox = page.getByLabel('発行した共有URL');
  await expect(urlBox).toBeVisible();
  const shareUrl = await urlBox.inputValue();
  await expect(page.getByText('見せる項目: 旅行の説明・日程の見出し・予定の時刻・予定の住所')).toBeVisible();

  // 3. 発行後の確認は使用回数を使わない
  await page.getByRole('button', { name: '閲覧者に見える内容を確認' }).click();
  await expect(preview.getByText(/発行済みのリンク「\.\.\..+」で見える内容です/)).toBeVisible();
  await expect(preview.getByText('住所: 京都市東山区清水1-294')).toBeVisible();
  const links = await send('get', `/travel-plans/${planId}/share`) as Array<{ use_count: number }>;
  expect(links[0]!.use_count).toBe(0);

  // 4. ログインしていない閲覧者
  const anonymous = await browser.newContext();
  const viewer = await anonymous.newPage();
  await viewer.goto(shareUrl);
  await expect(viewer.getByRole('heading', { name: title, level: 1 })).toBeVisible();
  await expect(viewer.getByRole('heading', { name: '東山F45', level: 2 })).toBeVisible();
  await expect(viewer.getByText('住所: 京都市東山区清水1-294')).toBeVisible();
  await expect(viewer.getByText('10:00')).toBeVisible();
  const body = viewer.locator('body');
  await expect(body).not.toContainText(CONFIRMATION);
  await expect(body).not.toContainText('入口メモF45'); // メモは選んでいない
  await expect(body).not.toContainText('祇園の宿F45'); // 予約の概要は選んでいない
  await expect(body).not.toContainText('34.9949');
  await expectNoAxeViolations(viewer, '公開閲覧(選んだ項目)');

  // 5. 上限1回: 所有者の確認は数えていないので、閲覧者の2回目で無効になる
  await viewer.reload();
  await expect(viewer.getByRole('heading', { name: 'このリンクは無効です' })).toBeVisible();
  await anonymous.close();
});
