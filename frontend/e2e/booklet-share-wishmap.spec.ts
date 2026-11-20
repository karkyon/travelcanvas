import { test, expect } from '@playwright/test';
import { tokyoDateAfter } from './support/dates';
import { apiClient, registerAccount } from './support/api';
import { expectNoAxeViolations } from './support/axe';

/**
 * [Gate BookletShare] しおりの版の「共有」: 公開 → URL・QR コード・メールアプリ(mailto)・スマホの共有・アプリからのメール(PDF 添付)。
 * [Gate WishMap] 行きたい場所の地図: 絞り込んだ結果を番号つきの印で出し、カードで選ぶと赤い印と小窓を出す。
 * 外部の地図のタイルは読まない(page.route で止める)。メールの送り先の設定(SMTP)が無い環境では、アプリからのメールは使えない旨を出す。
 */
const PASSWORD = 'Gate-BookletShare-TestPass-1';

test('しおりの版を公開し、QR コードとメールアプリのリンクで送れる', async ({ page }) => {
  test.setTimeout(150_000);
  const a = await registerAccount(page, { prefix: 'bshare', label: 'owner', password: PASSWORD });
  const send = apiClient(page.request, a.apiBase, a.token);
  const title = `共有E2E-${Date.now()}`;
  const plan = await send('post', '/travel-plans/', { title }) as { id: string };
  const day = await send('post', `/plans/${plan.id}/days`, { local_date: tokyoDateAfter(30), timezone_id: 'Asia/Tokyo' }) as { id: string };
  await send('post', `/plans/${plan.id}/events`, { day_id: day.id, title: '清水寺', local_start_time: '10:00' });
  await send('post', `/plans/${plan.id}/booklet-exports`, { theme: 'simple', sections: ['cover', 'schedule'] });

  await page.goto(`/planner/${plan.id}/booklet`);
  await page.getByTestId('booklet-share-1').click();
  const dlg = page.getByTestId('booklet-share');
  await expect(dlg).toBeVisible();
  // 既定は「編集できる同行者用」(ログインして開く)。公開ページを選んで公開する
  await expect(dlg.getByTestId('booklet-share-url')).toHaveValue(new RegExp(`/planner/${plan.id}/booklet/`));
  await dlg.getByRole('radio', { name: /公開ページ/ }).check();
  page.once('dialog', (d) => void d.accept()); // 公開してよいかの確認
  await dlg.getByTestId('booklet-share-publish').getByRole('button', { name: 'Web のページとして公開する' }).click();
  const url = dlg.getByTestId('booklet-share-url');
  await expect(url).toHaveValue(/\/b\/[A-Za-z0-9_-]{20,}$/);
  const link = await url.inputValue();
  await expect(dlg.getByTestId('booklet-share-qr')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expectNoAxeViolations(page, 'しおりの共有(QR コード)');

  await dlg.getByRole('tab', { name: 'メールアプリで送る' }).click();
  const mailto = await dlg.getByTestId('booklet-share-mailto').getAttribute('href');
  expect(mailto).toMatch(/^mailto:/);
  expect(decodeURIComponent(mailto ?? '')).toContain(link);

  await dlg.getByRole('tab', { name: 'アプリから送る(PDF 添付)' }).click();
  await expect(dlg.getByTestId('booklet-share-appmail')).toBeVisible();

  // 公開した URL は、ログインしていない人でも開ける。閉じて開き直しても同じ URL が出る(作り直さない)
  await page.getByRole('dialog').getByRole('button', { name: '閉じる', exact: true }).last().click();
  await expect(page.getByTestId('booklet-share')).toHaveCount(0);
  await page.getByTestId('booklet-share-1').click();
  await page.getByTestId('booklet-share').getByRole('radio', { name: /公開ページ/ }).check();
  await expect(page.getByTestId('booklet-share-url')).toHaveValue(link);
  const anon = await page.context().browser()!.newContext();
  const p2 = await anon.newPage();
  await p2.goto(new URL(link).pathname);
  await expect(p2.getByText('清水寺').first()).toBeVisible({ timeout: 20_000 });
  await anon.close();
});

test('行きたい場所の地図: 絞り込みの結果だけを印で出し、カードで選ぶと赤い印と詳しい小窓を出す', async ({ page }) => {
  test.setTimeout(120_000);
  await page.route(/tile\.openstreetmap\.org/, (r) => r.abort());
  const a = await registerAccount(page, { prefix: 'wmap', label: 'owner', password: PASSWORD });
  const send = apiClient(page.request, a.apiBase, a.token);
  await send('post', '/spots/', { name: '清水寺', category: 'sightseeing', address: '京都府京都市東山区', description: '朝早く行く', latitude: 34.9949, longitude: 135.785 });
  await send('post', '/spots/', { name: '錦市場', category: 'shopping', address: '京都府京都市中京区', latitude: 35.005, longitude: 135.765 });
  await send('post', '/spots/', { name: '位置なし食堂', category: 'restaurant' });

  await page.goto('/spots');
  const map = page.getByTestId('wish-map');
  await expect(map).toContainText('地図に 2 か所');
  await expect(map.locator('.leaflet-marker-icon')).toHaveCount(2);
  await page.getByTestId('wish-cat-shopping').click();
  await expect(map.locator('.leaflet-marker-icon')).toHaveCount(1);
  await page.getByTestId('wish-cat-all').click();
  await expect(map.locator('.leaflet-marker-icon')).toHaveCount(2);

  const card = page.getByRole('listitem', { name: '清水寺' });
  await card.getByRole('button', { name: '「清水寺」を地図で表示' }).click();
  await expect(card).toHaveAttribute('data-selected', 'true');
  await expect(map.locator('.tc-pin.is-sel')).toHaveCount(1);
  const pop = page.locator('.leaflet-popup [data-testid^="wish-pop-"]');
  await expect(pop).toContainText('清水寺');
  await expect(pop).toContainText('朝早く行く');
  await expect(pop.getByRole('link', { name: /Google マップ/ })).toHaveAttribute('href', /google\.com\/maps/);
  await expectNoAxeViolations(page, '行きたい場所の地図');

  // 印を押すと、その場所のカードを選ぶ
  await map.locator('.leaflet-marker-icon[title$="錦市場"]').click();
  await expect(page.getByRole('listitem', { name: '錦市場' })).toHaveAttribute('data-selected', 'true');
});
