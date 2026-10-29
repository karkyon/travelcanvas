import { test, expect } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate G11 段階8] FR-007 候補箱で家族・グループが候補に投票する(合意形成 FR-022 の投票を使う。新しい表なし)。
 *
 *   1. 所有者が候補箱で「候補 2件で投票を始める」→ 候補ごとに 行きたい・行ってもいい・気になる・行きたくない を付けられる
 *   2. 閲覧のメンバーは投票を始められないが回答できる。「気になる点がある」は理由が要る
 *   3. 件数は全員の回答を合わせて出る(名前つきの投票)。後から足した候補は「この投票に入っていません」と示す
 *   4. 決定・旅程への反映は話し合いの画面(既存の gate-g4 で確かめる)へのリンク。axe 違反 0
 */
test('FR-007 候補箱の家族の投票: 始める・回答・理由・件数・後から足した候補', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = await registerMember(page, 'g11vote');
  const sendA = apiClient(page.context().request, owner.apiBase, owner.token);
  const plan = await sendA('post', '/travel-plans/', { title: `G11投票E2E-${Date.now()}` });
  const planId = String(plan.id);
  const c1 = await sendA('post', `/plans/${planId}/candidates`, { title: '錦市場' });
  const c2 = await sendA('post', `/plans/${planId}/candidates`, { title: '伏見稲荷' });

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const member = await registerMember(pageB, 'g11voteb');
    const sendB = apiClient(ctxB.request, member.apiBase, member.token);
    await sendA('post', `/travel-plans/${planId}/collaborators`, { email: member.email, role: 'viewer' });
    const invitation = (await sendB('get', '/travel-plans/invitations'))
      .find((i: { plan_id: string }) => i.plan_id === planId);
    await sendB('post', `/travel-plans/invitations/${invitation.id}/accept`);

    // 1. 所有者が始めて「行きたい」
    await page.goto(`/planner/${planId}/candidates`);
    const voting = page.getByTestId('candidate-voting');
    await expect(voting).toBeVisible({ timeout: 20_000 });
    await voting.getByTestId('candidate-voting-start').click();
    await expect(voting.getByRole('status')).toContainText('候補で投票を始めました');
    await voting.getByTestId(`candidate-vote-${c1.id}`).getByRole('radio', { name: '行きたい', exact: true }).click();
    await expect(voting.getByRole('status')).toContainText('「錦市場」に「行きたい」を付けました');
    await expectNoAxeViolations(page, '候補箱の投票');

    // 2. 閲覧のメンバー: 始めるボタンは無い(投票はある)・回答・理由
    await pageB.goto(`/planner/${planId}/candidates`);
    const votingB = pageB.getByTestId('candidate-voting');
    await expect(votingB.getByTestId(`candidate-vote-${c1.id}`)).toBeVisible({ timeout: 20_000 });
    await expect(votingB.getByTestId('candidate-voting-start')).toHaveCount(0);
    await votingB.getByTestId(`candidate-vote-${c1.id}`).getByRole('radio', { name: '行ってもいい', exact: true }).click();
    await expect(votingB.getByRole('status')).toContainText('「錦市場」に「行ってもいい」を付けました');
    await votingB.getByTestId(`candidate-vote-${c2.id}`).getByRole('radio', { name: '気になる点がある', exact: true }).click();
    const ask = votingB.getByTestId('candidate-vote-reason');
    await expect(ask.getByRole('button', { name: '付ける' })).toBeDisabled();
    await ask.getByRole('textbox').fill('階段が多い');
    await ask.getByRole('button', { name: '付ける' }).click();
    await expect(votingB.getByRole('status')).toContainText('「伏見稲荷」に「気になる点がある」を付けました');

    // 3. 件数・後から足した候補
    await sendA('post', `/plans/${planId}/candidates`, { title: '嵐山' });
    await page.reload();
    await expect(voting.getByTestId(`candidate-vote-${c1.id}`).getByTestId('candidate-vote-counts'))
      .toContainText('♥ 行きたい 1 · ○ 行ってもいい 1', { timeout: 20_000 });
    await expect(voting.getByTestId(`candidate-vote-${c2.id}`).getByTestId('candidate-vote-counts'))
      .toContainText('△ 気になる点がある 1');
    await expect(voting.getByTestId('candidate-voting-missing')).toContainText('投票の後に足した候補 1件(「嵐山」)');
    const polls = await sendA('get', `/plans/${planId}/polls`);
    expect(polls).toHaveLength(1);
    expect(polls[0].options.map((o: { candidate_id: string }) => o.candidate_id).sort()).toEqual([c1.id, c2.id].sort());
    // 4. 決定・反映は話し合いの画面へ
    await expect(voting.getByRole('link', { name: '締切・決定・旅程への反映は話し合いの画面へ' }))
      .toHaveAttribute('href', `/planner/${planId}/discussion`);
  } finally {
    await ctxB.close();
  }
});
