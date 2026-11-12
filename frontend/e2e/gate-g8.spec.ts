import { test, expect, type Page } from '@playwright/test';
import { apiClient, registerAccount, type Send } from './support/api';
import { expectNoAxeViolations } from './support/axe';
import { grantAdmin, revokeAdmin } from './support/admin';
import { stepNow, totp } from './support/totp';
import { TEXT_PAIRS } from '../src/styles/tokens';

/**
 * [Gate G8・G9] 外部の判断の要らない残りを、実際のブラウザで確かめる。
 *   1. (FR-019 もしもの案の区間・予約の変更は [Gate PlanB-P8] でやめた。日ごとの案は test_gate_planb_variants と画面の試験)
 *   2. FR-021・FR-039 所有者の移譲(申し出 → 相手がパスワードで受け入れ)、旅行の中の情報の訂正の申し出と対応、
 *      出典つきの本人の情報の訂正と取り消し
 *   3. FR-004 同じ会員の2つの端末で同じ予定を同時に直すと、あとの保存は黙って上書きせず違いを示し、重ねて保存できる
 *   4. FR-004・O02 管理者の画面で定期の処理の状態を見る / UX-1 デザインの決まりの一覧(明るい・暗い)に axe 違反が無い
 */

const PASSWORD = 'Gate-G8-TestPass-1';


async function member(page: Page, label: string): Promise<{ send: Send; email: string; username: string }> {
  const a = await registerAccount(page, { prefix: 'g8', label, password: PASSWORD });
  return { send: apiClient(page.request, a.apiBase, a.token), email: a.email, username: a.username };
}


test('FR-021・FR-039 所有者の移譲、訂正の申し出と対応、出典つきの本人の情報の訂正', async ({ page, browser }) => {
  test.setTimeout(240_000);
  const owner = await member(page, 'own');
  const plan = await send0(owner.send, `京都G8移譲-${Date.now()}`);
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    const next = await member(pageB, 'next');
    await owner.send('post', `/travel-plans/${plan}/collaborators`, { email: next.email, role: 'editor' });
    const invitations = await next.send('get', '/travel-plans/invitations') as Array<{ id: string; plan_id: string }>;
    await next.send('post', `/travel-plans/invitations/${invitations.find((i) => i.plan_id === plan)!.id}/accept`);

    // 所有者が申し出る(パスワードで本人確認)
    await page.goto(`/share/${plan}`);
    const section = page.getByRole('region', { name: '所有者の移譲' });
    await section.getByLabel('引き継ぐ人').selectOption({ label: next.username });
    await section.getByLabel('引き継いだ後のあなた').selectOption('viewer');
    await section.getByLabel('本人確認のためのパスワード').fill(PASSWORD);
    await section.getByRole('button', { name: '移譲を申し出る' }).click();
    await expect(section.getByRole('status').filter({ hasText: 'さんへ申し出ました' })).toBeVisible();
    await expect(section.getByTestId('ownership-pending')).toContainText('受け入れ後のあなた: 閲覧者として残る');
    await expectNoAxeViolations(page, '共有(所有者の移譲)');

    // 受け取る人がお知らせの画面で受け入れる
    await pageB.goto('/notifications');
    const card = pageB.getByRole('region', { name: '所有者の移譲の申し出' });
    await expect(card).toContainText(`「京都G8移譲-`);
    await card.getByLabel('受け入れるにはパスワード').fill(PASSWORD);
    await expectNoAxeViolations(pageB, 'お知らせ(所有者の移譲の申し出)');
    await card.getByRole('button', { name: '所有者を引き継ぐ' }).click();
    await expect(card.getByRole('status').filter({ hasText: 'の所有者になりました。' })).toBeVisible();
    expect((await next.send('get', `/plans/${plan}/ownership-transfer`) as { role: string }).role).toBe('owner');
    expect((await owner.send('get', `/plans/${plan}/ownership-transfer`) as { role: string }).role).toBe('viewer');

    // 前の所有者(今は閲覧者)が、旅行の中の情報の訂正を申し出る
    await page.goto(`/planner/${plan}`);
    await page.getByRole('button', { name: '訂正の申し出', exact: true }).click();
    await page.waitForURL(new RegExp(`/planner/${plan}/corrections$`));
    await page.getByLabel('どの情報か(例: 予約の名義)').fill('予約の名義');
    await page.getByLabel('今の表示(任意)').fill('YAMADA TARO');
    await page.getByLabel('正しい内容').fill('YAMADA TAROU');
    await page.getByLabel('根拠(出典)').selectOption('official_document');
    await page.getByRole('button', { name: '所有者へ申し出る' }).click();
    await expect(page.getByRole('status').filter({ hasText: '所有者へ申し出ました' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'あなたの申し出' })).toContainText('予約の名義: YAMADA TARO → YAMADA TAROU');
    await expectNoAxeViolations(page, '訂正の申し出(参加者)');

    // 新しい所有者が対応を記録する
    await pageB.goto(`/planner/${plan}/corrections`);
    const list = pageB.getByRole('list', { name: '届いた申し出' });
    await expect(list).toContainText('出典: 公的な書類');
    await list.getByLabel('ひとこと(任意)').fill('名義を直しました');
    await list.getByRole('button', { name: '対応した' }).click();
    await expect(pageB.getByRole('status').filter({ hasText: '対応したことを記録しました。' })).toBeVisible();
    await expect(list).toContainText('対応済み・所有者: 名義を直しました');
    await expectNoAxeViolations(pageB, '訂正の申し出(所有者)');

    // 本人の情報の訂正(出典つき)と、申し出の状態・取り消し
    await page.goto('/settings/data');
    const corr = page.getByRole('region', { name: '情報の訂正' });
    await expect(corr.getByRole('list', { name: '訂正の申し出' })).toContainText('対応済み(所有者: 名義を直しました)');
    await corr.getByLabel('正しい値').fill('山田 太郎');
    await corr.getByLabel('根拠(出典)').selectOption('official_document');
    await corr.getByLabel('根拠の補足(任意・500文字まで)').fill('旅券の表記');
    await corr.getByRole('button', { name: '訂正する' }).click();
    await expect(corr.getByRole('status').filter({ hasText: '表示名を訂正しました(出典: 公的な書類)。' })).toBeVisible();
    const history = corr.getByRole('list', { name: '訂正の履歴' });
    await expect(history).toContainText(`表示名: ${owner.username} → 山田 太郎`);
    await expect(history).toContainText('出典: 公的な書類(旅券の表記)');
    await expectNoAxeViolations(page, 'データとプライバシー(情報の訂正)');
    await history.getByRole('button', { name: 'この訂正を取り消す' }).click();
    await expect(corr.getByRole('status').filter({ hasText: '訂正を取り消しました。' })).toBeVisible();
    await expect(history).toContainText('取り消し済み');
    expect((await owner.send('get', '/auth/me') as { username: string }).username).toBe(owner.username);
  } finally {
    await ctxB.close();
  }
});

async function send0(send: Send, title: string): Promise<string> {
  return (await send('post', '/travel-plans/', { title }) as { id: string }).id;
}

test('FR-004 同じ会員の2つの端末で同じ予定を同時に直すと、違いを示して重ねて保存できる', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const a = await member(page, 'dev');
  const planId = await send0(a.send, `G8二端末-${Date.now()}`);
  const day = await a.send('post', `/plans/${planId}/days`, { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' }) as { id: string };
  const ev = await a.send('post', `/plans/${planId}/events`, { day_id: day.id, title: '清水寺', local_start_time: '10:00' }) as { id: string };
  const ctx2 = await browser.newContext();
  const page2 = await ctx2.newPage();
  try {
    // 2つ目の端末で同じ会員としてログインする
    await page2.goto('/login');
    await page2.locator('#email').fill(a.email);
    await page2.locator('#password').fill(PASSWORD);
    await page2.getByRole('button', { name: 'Sign in' }).click();
    await page2.waitForURL(/\/dashboard$/, { timeout: 30_000 });
    const sessions = await a.send('get', '/auth/sessions') as Array<unknown> | { sessions: Array<unknown> };
    expect((Array.isArray(sessions) ? sessions : sessions.sessions).length).toBeGreaterThanOrEqual(2);

    const item = (p: Page) => p.getByRole('listitem', { name: '清水寺(上下矢印キーで並べ替え)' });
    await page.goto(`/planner/${planId}`);
    await page2.goto(`/planner/${planId}`);
    await item(page).getByRole('button', { name: /を編集$/ }).click();
    await item(page2).getByRole('button', { name: /を編集$/ }).click();
    const d1 = page.getByRole('dialog', { name: 'スポットを編集' });
    const d2 = page2.getByRole('dialog', { name: 'スポットを編集' });
    await expect(d1.getByLabel('タイトル')).toHaveValue('清水寺');
    await expect(d2.getByLabel('タイトル')).toHaveValue('清水寺');
    // 端末2が先に開始時刻を保存する
    await d2.getByLabel('開始時刻').fill('09:30');
    await d2.getByRole('button', { name: '保存', exact: true }).click();
    await expect(d2).toBeHidden();
    // 端末1があとからメモを保存すると、黙って上書きせず違いを示す
    await d1.getByLabel('メモ').fill('朝一番に行く');
    await d1.getByRole('button', { name: '保存', exact: true }).click();
    const conflict = d1.getByTestId('edit-conflict');
    await expect(conflict).toContainText('開始時刻: ほかの人の値「09:30」');
    await expect(d1.getByLabel('メモ')).toHaveValue('朝一番に行く');
    await conflict.getByRole('button', { name: '自分の変更を最新の内容に重ねて保存' }).click();
    await expect(d1).toBeHidden();
    const latest = await a.send('get', `/plans/${planId}`) as { days: Array<{ events: Array<{ id: string; local_start_time: string; notes?: string | null; description?: string | null }> }> };
    const saved = latest.days[0]!.events.find((e) => e.id === ev.id)!;
    expect(saved.local_start_time).toBe('09:30');
    expect(JSON.stringify(saved)).toContain('朝一番に行く');
    // 端末2は読み込み直すと両方の変更を見る
    await page2.reload();
    await expect(item(page2)).toContainText('09:30');
  } finally {
    await ctx2.close();
  }
});

test('FR-004 管理者の画面の定期の処理、UX-1 デザインの決まりの一覧', async ({ page }) => {
  test.setTimeout(180_000);
  // UX-1 デザインの決まり(ログイン不要・利用者のデータを含まない)
  await page.goto('/design-system');
  await expect(page.getByRole('heading', { name: 'デザインの決まり' })).toBeVisible();
  // 見出しの行 + 決めた組み合わせの数(G9 後半で暗い見た目の状態の色・表紙の色を足した)
  await expect(page.getByRole('table', { name: '文字と地の組み合わせ' }).getByRole('row')).toHaveCount(TEXT_PAIRS.length + 1);
  // 面の見本4つ + 一覧の区切り6つ(色・コントラスト・形・文字・強調色・動き)
  await expect(page.locator('[data-surface]')).toHaveCount(4 + 6);
  await expectNoAxeViolations(page, 'デザインの決まり(明るい)');
  await page.getByLabel('暗い見た目で確かめる').check();
  await expect(page.locator('[data-theme="dark"]')).toHaveCount(1);
  await expectNoAxeViolations(page, 'デザインの決まり(暗い)');
  await page.getByLabel('表紙から取った色(例)').fill('#ffff00');
  await expect(page.getByText(/白い地の上で文字に使う色:/)).toContainText(/\((4\.[5-9]\d*|[5-9]\.\d+|\d{2}\.\d+) : 1\)/);

  // 管理者の画面の定期の処理
  const admin = await member(page, 'adm');
  grantAdmin(admin.email);
  try {
    await page.goto('/login');
    await page.locator('#email').fill(admin.email);
    await page.locator('#password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
    await page.goto('/admin');
    await page.getByRole('link', { name: '多要素認証を設定する' }).click();
    await page.getByRole('button', { name: '多要素認証を設定する' }).click();
    await page.getByLabel('確認のため、現在のパスワードを入力してください').fill(PASSWORD);
    await page.getByRole('button', { name: '次へ' }).click();
    const secret = (await page.getByTestId('mfa-secret').getAttribute('data-secret')) ?? '';
    await page.getByLabel('確認コード(6桁)').fill(totp(secret, stepNow()));
    await page.getByRole('button', { name: '有効にする' }).click();
    await expect(page.getByTestId('mfa-recovery-codes').locator('li')).toHaveCount(10);
    await page.getByRole('button', { name: '保存しました' }).click();
    await page.goto('/admin');
    const jobs = page.getByRole('table', { name: '定期の処理の状態' });
    await expect(jobs).toBeVisible({ timeout: 15_000 });
    for (const name of ['webhook-retry', 'poll-deadlines', 'email-outbox', 'account-deletions', 'plan-purge']) {
      await expect(jobs.getByRole('rowheader', { name })).toBeVisible();
    }
    await expect(jobs.getByRole('rowheader', { name: 'account-deletions' }).locator('xpath=..')).toContainText('1日ごと');
    await expectNoAxeViolations(page, '管理者ダッシュボード(定期の処理)');
  } finally {
    revokeAdmin(admin.email);
  }
});
