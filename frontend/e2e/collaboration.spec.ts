import { test, expect, type Page } from '@playwright/test';
import { expectNoAxeViolations } from './support/axe';
import { apiClient, registerMember } from './support/api';

/**
 * [Gate C1] FR-020 共同編集(準リアルタイム)・FR-023 秘匿プロフィールの browser E2E(2人の正式アカウント・2つの画面)。
 *
 *   1. 所有者Aが旅行を作り、編集者Bを招待して、Bが承諾する
 *   2. 2人がプランナーを開くと、互いに「開いている人」に出る。Bが予定の編集を始めると、Aに「編集中」と出る
 *   3. Bが保存すると、Aの画面に「Bさんが「清水寺(朝)」を更新しました」と「最新を読み込む」が出る(勝手に書き換えない)
 *   4. 同時に編集: Bが先に開始時刻を変えて保存し、Aが古い画面のままメモを保存すると、Aの入力は残ったまま違いが示され、
 *      「自分の変更を最新の内容に重ねて保存」で Bの開始時刻と Aのメモの両方が残る(黙って上書きしない)
 *   5. Bが設定で非公開の条件(朝は11時より後)を登録し、旅行に適用する。Aの制約の画面では伏せられ、
 *      実行可能性チェックは「秘匿制約を満たしていません」とだけ示す(条件の名前・値は出ない)
 *   各画面に axe(WCAG 2.1 AA)違反が無い
 */
const eventItem = (page: Page, title: string) =>
  page.getByRole('listitem', { name: `${title}(上下矢印キーで並べ替え)` });

test('共同編集: 開いている人・編集中・他の人の変更を示し、同時の編集を黙って上書きせず、非公開の条件は伏せて判定に使う', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const owner = await registerMember(page, 'c1own');
  const sendA = apiClient(page.context().request, owner.apiBase, owner.token);
  const plan = await sendA('post', '/travel-plans/', { title: `C1共同E2E-${Date.now()}` });
  const planId = String(plan.id);
  const day = await sendA('post', `/plans/${planId}/days`, { local_date: '2026-11-02', timezone_id: 'Asia/Tokyo' });
  await sendA('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', local_start_time: '10:00' });

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const editor = await registerMember(pageB, 'c1edit');
    const sendB = apiClient(ctxB.request, editor.apiBase, editor.token);
    await sendA('post', `/travel-plans/${planId}/collaborators`, { email: editor.email, role: 'editor' });
    const invitations = await sendB('get', '/travel-plans/invitations');
    const invitation = invitations.find((i: { plan_id: string }) => i.plan_id === planId);
    await sendB('post', `/travel-plans/invitations/${invitation.id}/accept`);

    // 2. 互いに「開いている人」に出る
    await page.goto(`/planner/${planId}`);
    await pageB.goto(`/planner/${planId}`);
    const barA = page.getByRole('region', { name: '一緒に見ている人' });
    await expect(barA).toContainText('(編集者)', { timeout: 20_000 });
    await expect(pageB.getByRole('region', { name: '一緒に見ている人' })).toContainText('(所有者)', { timeout: 20_000 });

    // Bが編集を始める → Aに「編集中」
    await eventItem(pageB, '清水寺').click();
    const dialogB = pageB.getByRole('dialog');
    await expect(dialogB).toBeVisible();
    await expect(barA).toContainText('「清水寺」を編集中', { timeout: 20_000 });
    await expectNoAxeViolations(page, '開いている人・編集中の表示');

    // 3. Bが保存 → Aに変更の知らせ(画面は古いまま)
    await dialogB.getByLabel('タイトル').fill('清水寺(朝)');
    await dialogB.getByRole('button', { name: '保存' }).click();
    await expect(dialogB).toBeHidden();
    const notice = barA.getByRole('status');
    await expect(notice).toContainText('が「清水寺(朝)」を更新しました', { timeout: 20_000 });
    await expect(eventItem(page, '清水寺')).toBeVisible();
    await barA.getByRole('button', { name: '最新を読み込む' }).click();
    await expect(eventItem(page, '清水寺(朝)')).toBeVisible();
    await expect(notice).toBeHidden({ timeout: 20_000 });

    // 4. 同時に編集: Aが開いたまま、Bが先に開始時刻を変えて保存する
    await eventItem(page, '清水寺(朝)').click();
    const dialogA = page.getByRole('dialog');
    await expect(dialogA).toBeVisible();
    await eventItem(pageB, '清水寺(朝)').click();
    await expect(dialogA.getByRole('status')).toContainText('もこの予定を編集中です', { timeout: 20_000 });
    await dialogB.getByLabel('開始時刻').fill('09:30');
    await dialogB.getByRole('button', { name: '保存' }).click();
    await expect(dialogB).toBeHidden();
    await dialogA.getByLabel('メモ').fill('朝一番に行く');
    await dialogA.getByRole('button', { name: '保存' }).click();
    const conflict = dialogA.getByTestId('edit-conflict');
    await expect(conflict).toContainText('保存する前に、ほかの人がこの予定を変更しました。あなたの入力は残っています。');
    await expect(conflict).toContainText('開始時刻: ほかの人の値「09:30」');
    await expect(dialogA.getByLabel('メモ')).toHaveValue('朝一番に行く');
    await expectNoAxeViolations(page, '編集の競合');
    await conflict.getByRole('button', { name: '自分の変更を最新の内容に重ねて保存' }).click();
    await expect(dialogA).toBeHidden();
    const detail = await sendA('get', `/plans/${planId}`);
    const saved = detail.days[0].events[0];
    expect(saved).toMatchObject({ title: '清水寺(朝)', local_start_time: '09:30', description: '朝一番に行く' });

    // 5. Bの非公開の条件
    await pageB.goto('/settings?tab=conditions');
    const section = pageB.getByRole('region', { name: '非公開の条件(あなただけに見えます)' });
    await section.getByLabel('名前(あなたにだけ表示)').fill('朝はゆっくりしたい');
    await section.getByLabel('時刻').fill('11:00');
    await section.getByRole('button', { name: '条件を追加して保存' }).click();
    await expect(section.getByRole('status')).toHaveText('非公開の条件を保存しました');
    await expect(section.getByRole('list', { name: '登録した非公開の条件' })).toContainText('11:00より後に始める');
    await expectNoAxeViolations(pageB, '非公開の条件');

    await pageB.goto(`/planner/${planId}/constraints`);
    await pageB.getByRole('button', { name: 'この旅行に適用する' }).click();
    await expect(pageB.getByText('非公開の条件をこの旅行に適用しました')).toBeVisible();
    await expect(pageB.getByText('朝はゆっくりしたい')).toBeVisible();
    await expect(pageB.getByText('非公開の条件から')).toBeVisible();
    await expect(pageB.getByRole('button', { name: '朝はゆっくりしたいを編集' })).toHaveCount(0);
    await expectNoAxeViolations(pageB, '制約(非公開の条件を適用)');

    await page.goto(`/planner/${planId}/constraints`);
    await expect(page.getByText('他のメンバーの秘匿制約')).toBeVisible();
    await page.getByRole('button', { name: '検証する' }).click();
    const result = page.getByTestId('feasibility-result');
    await expect(result).toContainText('秘匿制約を満たしていません(内容は作成者本人にだけ表示されます)');
    await expect(page.locator('body')).not.toContainText('朝はゆっくり');
    await expect(page.locator('body')).not.toContainText('11:00');
    await expectNoAxeViolations(page, '制約(他の参加者の非公開の条件)');
  } finally {
    await ctxB.close();
  }
});
