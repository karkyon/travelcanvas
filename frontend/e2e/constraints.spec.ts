import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * [Gate L2] FR-016 制約管理(SC-15の制約部分)のbrowser E2E。
 *
 * ゲストで旅行を作り、プランナーの「⚖️ 制約」から制約画面へ進んで次を確認する。
 *   1. 制約ゼロの表示と「検証(実行可能性チェック)は未実施」の注記が別に出る(SC-15)
 *   2. ハード制約(予算上限・共有)と、ソフト制約(個人・秘匿・理由付き)を画面から登録できる
 *   3. 再読込後もハード/ソフトの区分・秘匿の表示・本人向けの理由が保たれる(永続化)
 *   4. 秘匿制約の内容は画面のAPI応答では本人にだけ返り、他人向けの形(masked)とは別になる
 *      (他人から見た非表示はbackend統合試験 test_gate_l2_constraints.py で検証する)
 *   5. 無効化・削除ができる
 *   6. 制約画面と入力ダイアログにaxe(WCAG 2.1 AA)違反が無い
 *
 * 登録のレート制限(1分5回)を消費しないようゲストで行う。
 */

async function axeViolations(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `- [${v.impact}] ${v.id}: ${v.help} (該当要素${v.nodes.length}件) ${v.helpUrl}`)
      .join('\n');
    throw new Error(`${label}でaxe violationsが${results.violations.length}件検出されました:\n${summary}`);
  }
}

async function startGuestPlan(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const newPlanButton = page.getByRole('button', { name: /新しいプラン/ });
  await newPlanButton.waitFor({ state: 'visible', timeout: 15_000 });
  await newPlanButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('例: 東京旅行').fill(`L2制約E2E-${Date.now()}`);
  await dialog.getByRole('button', { name: '作成' }).click();
  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = page.url().match(/\/planner\/([0-9a-fA-F-]{36})/);
  if (!match) throw new Error(`planIdをURLから取得できませんでした: ${page.url()}`);
  return match[1];
}

test('制約: ハード(共有)とソフト(秘匿・理由付き)を登録し、再読込後も保持され、無効化・削除できる', async ({ page }) => {
  const planId = await startGuestPlan(page);

  // 1. プランナーから制約画面へ(画面から到達できること自体も確認する)
  await page.getByRole('button', { name: /制約/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/constraints$`), { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: '制約', exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/制約はまだ登録されていません/)).toBeVisible();
  await expect(page.getByRole('note')).toContainText('まだ行っていません');
  await axeViolations(page, '制約画面(空)');

  // 2a. ハード・共有: 予算上限 50000円
  await page.getByRole('button', { name: /制約を追加/ }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await axeViolations(page, '制約の追加ダイアログ');
  await dialog.getByLabel('題名', { exact: true }).fill('予算は1人5万円まで');
  await dialog.getByLabel('種類', { exact: true }).selectOption('budget_limit');
  await dialog.getByLabel('数値', { exact: true }).fill('50000');
  await dialog.getByLabel('単位', { exact: true }).selectOption('JPY');
  const created = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/plans/${planId}/constraints`),
  );
  await dialog.getByRole('button', { name: '保存' }).click();
  expect((await created).status()).toBe(201);
  await expect(dialog).toBeHidden();

  // 2b. ソフト・秘匿・個人・理由付き: 避けたい移動手段
  await page.getByRole('button', { name: /制約を追加/ }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('題名', { exact: true }).fill('夜行バスは避けたい');
  await dialog.getByLabel('種類', { exact: true }).selectOption('avoid_transport');
  await dialog.getByLabel('内容', { exact: true }).fill('夜行バス');
  await dialog.getByLabel(/^重み/).fill('80');
  await dialog.getByLabel('適用範囲', { exact: true }).selectOption('member');
  await dialog.getByLabel(/自分だけ\(秘匿/).check();
  await dialog.getByLabel(/理由/).fill('腰を痛めている');
  const privateCreated = page.waitForResponse(
    (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith(`/plans/${planId}/constraints`),
  );
  await dialog.getByRole('button', { name: '保存' }).click();
  const privateBody = await (await privateCreated).json();
  expect(privateBody).toMatchObject({
    visibility: 'full', is_mine: true, privacy_level: 'private', hardness: 'soft', weight: 80,
    title: '夜行バスは避けたい', reason: '腰を痛めている', scope_type: 'member',
  });
  await expect(dialog).toBeHidden();

  // 3. 再読込後も保持されている
  await page.reload();
  const hard = page.getByRole('region', { name: /ハード制約/ });
  const soft = page.getByRole('region', { name: /ソフト制約/ });
  await expect(hard.getByText('予算は1人5万円まで')).toBeVisible({ timeout: 15_000 });
  await expect(hard.getByText(/上限 50000 円/)).toBeVisible();
  await expect(soft.getByText('夜行バスは避けたい')).toBeVisible();
  await expect(soft.getByText('自分だけ(秘匿)')).toBeVisible();
  await expect(soft.getByText(/重み 80/)).toBeVisible();
  await expect(soft.getByText(/理由\(自分だけに表示\): 腰を痛めている/)).toBeVisible();
  await expect(soft.getByText(/適用範囲: 個人/)).toBeVisible();
  await axeViolations(page, '制約画面(登録後)');

  // 4. 画面が再取得した一覧APIの応答で、自分の秘匿制約は本人向け(full)として返る
  const refreshed = page.waitForResponse(
    (r) => r.request().method() === 'GET' && new URL(r.url()).pathname.endsWith(`/plans/${planId}/constraints`),
  );
  await page.reload();
  const listed = (await (await refreshed).json()) as Array<Record<string, unknown>>;
  const mine = listed.find((c) => c.id === privateBody.id);
  expect(mine).toMatchObject({ visibility: 'full', reason: '腰を痛めている' });

  // 5a. 無効化
  const toggled = page.waitForResponse((r) => r.request().method() === 'PATCH');
  await hard.getByRole('button', { name: '無効にする' }).click();
  expect((await toggled).status()).toBe(200);
  await expect(hard.getByRole('button', { name: '有効にする' })).toBeVisible();
  await expect(hard.getByText('無効', { exact: true })).toBeVisible();

  // 5b. 削除
  page.once('dialog', (d) => d.accept());
  const deleted = page.waitForResponse((r) => r.request().method() === 'DELETE');
  await soft.getByRole('button', { name: '夜行バスは避けたいを削除' }).click();
  expect((await deleted).status()).toBe(200);
  await expect(soft.getByText('夜行バスは避けたい')).toBeHidden();
  await expect(soft.getByText('ありません')).toBeVisible();
});
