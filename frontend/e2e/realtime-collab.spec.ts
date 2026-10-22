import { test, expect } from '@playwright/test';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G2] FR-020 即時の共同編集(Server-Sent Events)の browser E2E。
 *
 * 2人が同じ旅行を開くと、即時の通知につながる(「変更はすぐに届きます」)。つながっている間の知らせ(ポーリング)の間隔は
 * 20秒に伸びるため、他の人の保存が数秒で届けば即時の通知で届いたことになる。
 */
test('即時の共同編集: 他の人の保存が、ポーリングを待たずに数秒で届く', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const owner = await registerMember(page, 'g2rt');
  const sendA = apiClient(page.context().request, owner.apiBase, owner.token);
  const plan = await sendA('post', '/travel-plans/', { title: `G2即時E2E-${Date.now()}` });
  const planId = String(plan.id);
  const day = await sendA('post', `/plans/${planId}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  const ev = await sendA('post', `/plans/${planId}/events`, { day_id: day.id, title: '金閣寺', local_start_time: '10:00' });

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const editor = await registerMember(pageB, 'g2rtb');
    const sendB = apiClient(ctxB.request, editor.apiBase, editor.token);
    await sendA('post', `/travel-plans/${planId}/collaborators`, { email: editor.email, role: 'editor' });
    const invitations = await sendB('get', '/travel-plans/invitations');
    await sendB('post', `/travel-plans/invitations/${invitations.find((i: { plan_id: string }) => i.plan_id === planId).id}/accept`);

    const stream = page.waitForResponse((r) => r.url().includes(`/plans/${planId}/events/stream`), { timeout: 30_000 });
    await page.goto(`/planner/${planId}`);
    expect((await stream).headers()['content-type']).toContain('text/event-stream');
    await pageB.goto(`/planner/${planId}`);
    const barA = page.getByRole('region', { name: '一緒に見ている人' });
    await expect(barA).toContainText('(編集者)', { timeout: 30_000 });
    await expect(page.getByTestId('presence-live')).toBeVisible({ timeout: 30_000 });
    // 知らせ(ポーリング)の直後を待ってから保存する(次のポーリングまで 20 秒ある)
    await page.waitForResponse((r) => r.url().endsWith(`/plans/${planId}/presence`), { timeout: 30_000 });
    const rev = (await sendB('get', `/plans/${planId}`)).revision;
    await sendB('put', `/plans/${planId}/events/${ev.id}`, { title: '金閣寺(午後)' }, { 'If-Match': `"${rev}"` });
    await expect(barA.getByRole('status')).toContainText('が「金閣寺(午後)」を更新しました', { timeout: 8_000 });
  } finally {
    await ctxB.close();
  }
});
