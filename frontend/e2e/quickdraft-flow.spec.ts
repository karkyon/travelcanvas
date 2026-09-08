import { test, expect } from '@playwright/test';

/**
 * [Gate R2-6] FR-043 / FC-101〜105 (QuickDraft) のbrowser E2E。
 *
 * docs/trace/gate-r2-trace.md の R2-5行が「未達」としていた
 * 「Playwright browser E2E」を満たすために追加。
 *
 * シナリオ(ハンドオフ資料 2026-09-08 §6 記載のものに準拠):
 *   匿名開始 → QuickDraft作成(+内部でpromoteまで連続実行) → reload →
 *   plan保持(=DBへ実際に永続化されたことの確認。楽観的UI状態ではないこと)
 *
 * 注意: frontend/src/store/planStore.ts の createQuickPlan() は
 * `POST /quick-drafts` → `POST /quick-drafts/{id}/promote` を連続実行する
 * 単一のユーザー操作(モーダルの「作成」ボタン1回のクリック)として実装
 * されている(2段階のユーザー操作ではない)。そのためこのテストでは
 * 「作成」クリック後に /planner/{id} へ遷移することをもってpromote成功と
 * みなし、その後の reload で内容が消えない(=optimisticなクライアント状態
 * ではなくbackend/DBに実在する)ことを検証する。
 */
test('匿名ゲスト開始 → QuickDraft作成 → reload → プランが永続化されている', async ({
  page,
}) => {
  test.setTimeout(60_000);

  // [Gate R2-6 v5] v3/v4実行で "新しいプラン" クリック前後にページが
  // 繰り返しリロードされる事象が発生し、`waitForLoadState('networkidle')`
  // 自体がタイムアウトして失敗の原因が埋もれた(Playwrightの内部イベント
  // ログだけが大量出力され、こちらのconsole.logが流れてしまった)。
  // v5では: (1) networkidle待ちを廃止しPlaywright標準のelement待ちのみに
  // 戻す、(2) フレーム遷移回数を自前でカウントし、失敗時のエラーメッセージ
  // に埋め込むことで、ログが流れても原因の切り分け(リロードループの有無)
  // が一目で分かるようにした。
  let navCount = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) navCount += 1;
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      console.log(`[HTTP ${response.status()}] ${response.request().method()} ${response.url()}`);
    }
  });
  page.on('pageerror', (err) => {
    console.log(`[PAGE ERROR] ${err.message}`);
  });

  const uniqueSuffix = Date.now().toString();
  const planTitle = `E2Eテスト旅行-${uniqueSuffix}`;
  const destination = `E2E目的地-${uniqueSuffix}`;
  const eventTitle = `E2E予定-${uniqueSuffix}`;
  const eventLocation = `E2E場所-${uniqueSuffix}`;

  // 1. 匿名(未ログイン)でトップページへアクセス
  await page.goto('/');

  // 2. 「登録せずに試してみる(ゲストとして始める)」を選択
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });
  const navCountAfterLanding = navCount;

  // 3. 新しい旅行プラン作成モーダルを開く
  const newPlanButton = page.getByRole('button', { name: /新しいプラン/ });
  try {
    await newPlanButton.waitFor({ state: 'visible', timeout: 15_000 });
  } catch (e) {
    throw new Error(
      `"新しいプラン"ボタンが表示されませんでした。/planner到達後のフレーム` +
        `遷移回数=${navCount - navCountAfterLanding}回(0であれば単純に描画が` +
        `遅いだけ、1以上なら/loginなどへ自動リダイレクトされている可能性が高い)。` +
        `元エラー: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  await newPlanButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // 4. プラン名・目的地・最初の予定を入力
  await dialog.getByPlaceholder('例: 東京旅行').fill(planTitle);
  await dialog.getByPlaceholder('例: 東京', { exact: true }).fill(destination);
  await dialog.getByPlaceholder('例: ホテルチェックイン').fill(eventTitle);
  await dialog.getByPlaceholder('例: 東京駅').fill(eventLocation);

  // 5. 作成(QuickDraft作成 → promote が内部で連続実行される)
  await dialog.getByRole('button', { name: '作成' }).click();

  // 6. プラン詳細画面(/planner/{uuid})へ遷移 = promote成功・planId確定
  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const planUrl = page.url();

  await expect(page.getByRole('heading', { name: planTitle })).toBeVisible();
  await expect(page.getByText(eventTitle).first()).toBeVisible();

  // 7. anonymous device tokenがlocalStorageへ保存されていることを確認
  //    (ADR-quick-draft.md §1、次回訪問でも同一匿名デバイスと識別するため)
  const deviceToken = await page.evaluate(() =>
    window.localStorage.getItem('travelcanvas_quickdraft_device_token'),
  );
  expect(deviceToken).toBeTruthy();

  // 8. reload = backendから再フェッチさせ、DBへ実際に永続化されたことを
  //    検証する(クライアント側のoptimistic stateではないことの確認)
  await page.reload();
  await expect(page).toHaveURL(planUrl);
  await expect(page.getByRole('heading', { name: planTitle })).toBeVisible();
  await expect(page.getByText(eventTitle).first()).toBeVisible();

  // 9. プラン一覧に戻っても、作成したプランが表示され続けることを確認
  await page.goto('/planner');
  await expect(page.getByText(planTitle)).toBeVisible();
});
