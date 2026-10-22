import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G2] FR-045 同行者(参加者)向けの項目の規則の browser E2E(2人の正式アカウント・2つの画面)。
 *
 *   1. 所有者が旅行(メモ・住所つきの予定、予約番号つきの予約)を作り、閲覧者を招待して承諾してもらう
 *   2. 所有者が共有の画面の「参加者に見せない項目」で、閲覧者に「予定のメモ」「予定の住所・位置」「予約」を見せない設定にする
 *      (予約を選ぶとチケット・予約番号の表示も自動で選ばれる)
 *   3. 閲覧者の旅程の画面: 知らせが出て、メモ・住所はどこにも出ない。予約の画面は理由つきで見られない。
 *      検索・書き出し(API)にも出ない
 *   4. 所有者が閲覧者だけ「役割の設定に戻す」前に1人だけの設定(何も隠さない)にすると、閲覧者は予約を見られる
 *   各画面に axe(WCAG 2.1 AA)違反が無い
 */
const NOTE = '裏口に集合G2E2E';
const ADDR = '京都市東山区G2E2E番地';
const CONF = 'G2E2E-5544-7788';

test('同行者向けの項目の規則: 所有者が選んだ項目は、閲覧者の画面・検索・書き出しのどこにも出ない', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = await registerMember(page, 'g2own');
  const sendA = apiClient(page.context().request, owner.apiBase, owner.token);
  const plan = await sendA('post', '/travel-plans/', { title: `G2項目E2E-${Date.now()}` });
  const planId = String(plan.id);
  const day = await sendA('post', `/plans/${planId}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  await sendA('post', `/plans/${planId}/events`, {
    day_id: day.id, title: '清水寺G2', local_start_time: '10:00', description: NOTE, address: ADDR,
    latitude: 34.9949, longitude: 135.785,
  });
  await sendA('post', `/plans/${planId}/reservations`, { type: 'accommodation', provider_name: '宿G2E2E', confirmation_number: CONF });

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const viewer = await registerMember(pageB, 'g2view');
    const sendB = apiClient(ctxB.request, viewer.apiBase, viewer.token);
    await sendA('post', `/travel-plans/${planId}/collaborators`, { email: viewer.email, role: 'viewer' });
    const invitations = await sendB('get', '/travel-plans/invitations');
    const invitation = invitations.find((i: { plan_id: string }) => i.plan_id === planId);
    await sendB('post', `/travel-plans/invitations/${invitation.id}/accept`);

    // 規則の前は全て見える(本Gate以前と同じ)
    expect((await sendB('get', `/plans/${planId}`)).days[0].events[0].description).toBe(NOTE);

    // 2. 所有者の設定
    await page.goto(`/share/${planId}`);
    const panel = page.getByRole('region', { name: '参加者に見せない項目' });
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await panel.getByRole('checkbox', { name: '閲覧者に「予定のメモ」を見せない' }).check();
    await panel.getByRole('checkbox', { name: '閲覧者に「予定の住所・位置」を見せない' }).check();
    await panel.getByRole('checkbox', { name: '閲覧者に「予約」を見せない' }).check();
    await expect(panel.getByRole('checkbox', { name: '閲覧者に「チケット・QR」を見せない' })).toBeChecked();
    await panel.getByRole('button', { name: '役割ごとの設定を保存する' }).click();
    await expect(panel.getByRole('status')).toContainText('役割ごとの設定を保存しました');
    await expectNoAxeViolations(page, '参加者に見せない項目');

    // 3. 閲覧者の画面
    await pageB.goto(`/planner/${planId}`);
    await expect(pageB.getByTestId('member-policy-notice')).toContainText('予定のメモ', { timeout: 20_000 });
    await expect(pageB.getByText('清水寺G2').first()).toBeVisible();
    await expect(pageB.locator('body')).not.toContainText(NOTE);
    await expect(pageB.locator('body')).not.toContainText(ADDR);
    await expectNoAxeViolations(pageB, '旅程(項目を隠された参加者)');
    await pageB.goto(`/planner/${planId}/reservations`);
    await expect(pageB.getByText(/見せない設定にしています/).first()).toBeVisible({ timeout: 20_000 });
    await expect(pageB.locator('body')).not.toContainText('宿G2E2E');

    const detail = await sendB('get', `/plans/${planId}`);
    expect(detail.hidden_fields).toEqual(expect.arrayContaining(['event_notes', 'event_address', 'reservations', 'tickets']));
    expect(detail.days[0].events[0].description).toBeNull();
    expect(detail.days[0].events[0].address).toBeNull();
    const search = await sendB('get', `/plans/${planId}/search?q=${encodeURIComponent('宿G2E2E')}`);
    expect(JSON.stringify(search.categories)).not.toContain('宿G2E2E');
    const ics = await ctxB.request.get(`${viewer.apiBase}/plans/${planId}/exports/calendar.ics?include_addresses=true`,
      { headers: { Authorization: `Bearer ${viewer.token}` } });
    expect(ics.status()).toBe(200);
    expect(await ics.text()).not.toContain('G2E2E番地');
    const gpx = await ctxB.request.get(`${viewer.apiBase}/plans/${planId}/exports/places.gpx`,
      { headers: { Authorization: `Bearer ${viewer.token}` } });
    expect(gpx.status()).toBe(403);

    // 4. 1人だけの設定(何も隠さない)
    await page.reload();
    const member = panel.getByRole('listitem').filter({ hasText: viewer.email });
    await member.getByRole('button', { name: `${viewer.email} だけの設定を変える` }).click();
    for (const label of ['予定のメモ', '予定の住所・位置', '予約']) await member.getByRole('checkbox', { name: label, exact: true }).uncheck();
    await member.getByRole('button', { name: '保存する' }).click();
    await expect(panel.getByRole('status')).toContainText('の設定を保存しました');
    await pageB.reload();
    await expect(pageB.getByText('宿G2E2E').first()).toBeVisible({ timeout: 20_000 });
  } finally {
    await ctxB.close();
  }
});
