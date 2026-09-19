import { test, expect, type Page } from '@playwright/test';

/**
 * [Gate M10] FR-013 文書ウォレット(documents)のbrowser E2E。
 *
 * 過去の複数回のGate M10試行(ハンドオフ資料参照)では、本テストの実行時に
 * 以下のようなCORSエラーで全件失敗していた:
 *
 *   Access to XMLHttpRequest at '.../documents' from origin
 *   'http://localhost:4173' has been blocked by CORS policy: No
 *   'Access-Control-Allow-Origin' header is present on the requested
 *   resource.
 *
 * 根本原因は、backend/app/core/config.py の DOCUMENT_STORAGE_DIR が
 * (Dockerの名前付きボリュームではなく)bind mount配下の書き込み不可な
 * パスを指しており、アップロード時にOSErrorが未捕捉のまま
 * ServerErrorMiddleware(CORSMiddlewareの外側)まで伝播し、その結果の
 * 500応答にCORSヘッダーが一切付与されていなかったこと。この修正は
 * config.py/documents.py/main.pyの3ファイルで別途完了している。
 *
 * 本ファイルはそのCORS修正が実際にPlaywright E2Eを通すことを検証する
 * ためのテスト本体。テストの構成・命名規則は quickdraft-flow.spec.ts に
 * 準拠する。
 *
 * 失敗時の切り分けを容易にするため、各テストの全体を1つのtry/catchで
 * 包み、失敗時には必ずナビゲーション履歴・HTTP応答本文(documents関連
 * または4xx/5xx全て)・requestfailedイベント・JS例外・コンソールログを
 * 一括出力する(attachDiagnostics/diagnosticsSummary)。
 */

interface DiagnosticsState {
  navUrls: string[];
  httpResponses: string[];
  requestFailures: string[];
  jsErrors: string[];
  consoleLogs: string[];
}

// テスト用の最小限のPDFバイナリ(実際にPDFとしてパース可能である必要は
// なく、backend側がバリデーションで弾かない程度のマジックバイトのみ持つ)。
function pdfFile(suffix: string): { name: string; mimeType: string; buffer: Buffer } {
  const minimalPdf =
    '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n' +
    'trailer<</Root 1 0 R>>\n' +
    '%%EOF';
  return {
    name: `M10文書E2E-${suffix}.pdf`,
    mimeType: 'application/pdf',
    buffer: Buffer.from(minimalPdf, 'utf-8'),
  };
}

// page/frame/requestのイベントを収集し、失敗時に一括出力できるようにする。
function attachDiagnostics(page: Page): DiagnosticsState {
  const state: DiagnosticsState = {
    navUrls: [],
    httpResponses: [],
    requestFailures: [],
    jsErrors: [],
    consoleLogs: [],
  };

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      state.navUrls.push(frame.url());
    }
  });

  page.on('response', (response) => {
    const url = response.url();
    const status = response.status();
    const isDocumentsRelated = url.includes('/documents');
    if (!isDocumentsRelated && status < 400) return;
    void response
      .text()
      .catch(() => '(本文取得不可)')
      .then((body) => {
        state.httpResponses.push(
          `[HTTP ${status}] ${response.request().method()} ${url} body=${body.slice(0, 500)}`,
        );
      });
  });

  page.on('requestfailed', (request) => {
    state.requestFailures.push(
      `[REQUEST FAILED] ${request.method()} ${request.url()} reason=${
        request.failure()?.errorText ?? '不明'
      }`,
    );
  });

  page.on('pageerror', (err) => {
    state.jsErrors.push(err.message);
  });

  page.on('console', (msg) => {
    state.consoleLogs.push(`[console.${msg.type()}] ${msg.text()}`);
    if (state.consoleLogs.length > 30) state.consoleLogs.shift();
  });

  return state;
}

function diagnosticsSummary(state: DiagnosticsState): string {
  const lines: string[] = [];
  lines.push('');
  lines.push('===== 診断情報 =====');
  lines.push(`nav回数=${state.navUrls.length}件`);
  lines.push('遷移先URL一覧: ');
  state.navUrls.forEach((url, i) => lines.push(`  ${i + 1}. ${url}`));
  lines.push(
    `HTTP応答(documents関連または4xx/5xx、本文含む): ${
      state.httpResponses.length === 0 ? 'なし' : ''
    }`,
  );
  state.httpResponses.forEach((entry, i) => lines.push(`  ${i + 1}. ${entry}`));
  lines.push(`requestfailed: ${state.requestFailures.length === 0 ? 'なし' : ''}`);
  state.requestFailures.forEach((entry, i) => lines.push(`  ${i + 1}. ${entry}`));
  lines.push(`JS例外: ${state.jsErrors.length === 0 ? 'なし' : ''}`);
  state.jsErrors.forEach((entry, i) => lines.push(`  ${i + 1}. ${entry}`));
  lines.push(`consoleログ(直近30件): ${state.consoleLogs.length === 0 ? 'なし' : ''}`);
  state.consoleLogs.forEach((entry, i) => lines.push(`  ${i + 1}. ${entry}`));
  lines.push('=====================');
  return lines.join('\n');
}

async function createGuestPlan(page: Page, titleSuffix: string): Promise<string> {
  await page.goto('/');
  await page.getByRole('button', { name: /ゲストとして始める/ }).click();
  await page.waitForURL(/\/planner\/?$/, { timeout: 15_000 });

  const newPlanButton = page.getByRole('button', { name: /新しいプラン/ });
  await newPlanButton.waitFor({ state: 'visible', timeout: 15_000 });
  await newPlanButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('例: 東京旅行').fill(`M10文書E2E-${titleSuffix}`);
  await dialog.getByRole('button', { name: '作成' }).click();

  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = page.url().match(/\/planner\/([0-9a-fA-F-]{36})/);
  if (!match) throw new Error(`planId をURLから取得できませんでした: ${page.url()}`);
  return match[1];
}

// [Gate M10-R2] restricted文書が別editorへ非露出であることをE2Eで検証する
// ためには、ゲストではなく正式アカウント2つ(招待する側/される側)が必要
// (招待受諾はメールアドレス一致で照合するため、メールを持たないゲストは
// そもそも招待対象になれない)。/registerはメール確認を要求せず登録直後に
// 認証済みとしてログインされる(RegisterPage参照)ため、E2E内で使い捨て
// アカウントをその場で作成する。
async function registerUser(page: Page, label: string): Promise<{ email: string }> {
  const suffix = `${Date.now()}-${label}-${Math.floor(Math.random() * 100000)}`;
  const email = `m10r1e2e-${suffix}@example.com`;
  await page.goto('/register');
  await page.locator('#username').fill(`m10r1e2e${suffix}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 30));
  await page.locator('#email').fill(email);
  await page.locator('#password').fill('Gate-M10-R1-TestPass-1');
  await page.locator('#confirmPassword').fill('Gate-M10-R1-TestPass-1');
  await page.getByRole('button', { name: 'Create Account' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 15_000 });
  return { email };
}

// createGuestPlanとほぼ同じだが、既に認証済み(ゲストではない正式アカウント)
// の場合は「ゲストとして始める」の遷移が不要かつ表示されないため、
// /plannerへ直接遷移してから同じ作成ダイアログ操作を行う。
async function createPlanAsCurrentUser(page: Page, titleSuffix: string): Promise<string> {
  await page.goto('/planner');
  const newPlanButton = page.getByRole('button', { name: /新しいプラン/ });
  await newPlanButton.waitFor({ state: 'visible', timeout: 15_000 });
  await newPlanButton.click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByPlaceholder('例: 東京旅行').fill(`M10文書E2E-${titleSuffix}`);
  await dialog.getByRole('button', { name: '作成' }).click();

  await page.waitForURL(/\/planner\/[0-9a-fA-F-]{36}$/, { timeout: 15_000 });
  const match = page.url().match(/\/planner\/([0-9a-fA-F-]{36})/);
  if (!match) throw new Error(`planId をURLから取得できませんでした: ${page.url()}`);
  return match[1];
}

// SharePage.tsxには"編集可能"を含むcomboboxが2つ存在する(共有リンク発行用の
// アクセス権限select: value="edit"、コラボレーター招待用の権限select:
// value="editor")。option value(文言ではなく実際に送信される値)で一意に
// 絞り込むことで、表示文言の変更に影響されない安定したlocatorにする。
function inviteRoleSelect(page: Page) {
  return page.locator('select:has(option[value="editor"])');
}

async function openDocumentsPage(page: Page, planId: string) {
  await page.getByRole('button', { name: /📄\s*文書/ }).click();
  await page.waitForURL(new RegExp(`/planner/${planId}/documents$`), { timeout: 15_000 });
  const uploadButton = page.getByRole('button', { name: '新規アップロード' });
  await uploadButton.waitFor({ state: 'visible', timeout: 20_000 });
  return uploadButton;
}

async function fillAndSubmitUpload(
  page: Page,
  uploadButton: ReturnType<Page['getByRole']>,
  file: ReturnType<typeof pdfFile>,
  classification: string,
) {
  await uploadButton.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('input[type="file"]').setInputFiles(file);
  await dialog.getByRole('combobox').selectOption(classification);
  const submitButton = dialog.getByRole('button', { name: 'アップロード' });
  await expect(submitButton).toBeEnabled();
  await submitButton.click();
  await expect(dialog).not.toBeVisible({ timeout: 15_000 });
}

test.describe('文書ウォレット (FR-013) E2E', () => {
  test('アップロード → 一覧表示 → ダウンロード → 削除', async ({ page }) => {
    test.setTimeout(90_000);
    const state = attachDiagnostics(page);
    try {
      const suffix = Date.now().toString();
      const planId = await createGuestPlan(page, suffix);

      // 1. プランから「📄 文書」で文書ウォレット画面へ遷移
      await openDocumentsPage(page, planId);
      await expect(page.getByText('文書がまだ登録されていません')).toBeVisible();

      // 2. アップロード
      const file = pdfFile(suffix);
      const uploadButton = page.getByRole('button', { name: '新規アップロード' });
      await fillAndSubmitUpload(page, uploadButton, file, 'confidential');

      // 3. モーダルが閉じ、一覧に反映される(DBへ実際に保存されたことの
      //    確認は後続のreloadで行う)
      await expect(page.getByText(file.name)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('機密')).toBeVisible();

      // 4. reload後も一覧に残っている(backend/DBへ永続化されたことの確認、
      //    quickdraft-flow.spec.tsと同じ考え方)
      await page.reload();
      await expect(page.getByText(file.name)).toBeVisible({ timeout: 15_000 });

      // 5. ダウンロード。[Gate M10 v23] backend側はContent-Disposition:
      //    attachmentを付与している(Gate M7 P1-01)。以前はwindow.open()で
      //    新規タブを開く方式だったが、ユーザー操作とURL取得の非同期な
      //    隙間によりChromiumがポップアップをブロックする問題が実機で
      //    再現したため、frontend側は非表示<a>要素のクリックで同一タブ内
      //    から直接ダウンロードをトリガーする方式に変更した(新規タブ・
      //    ポップアップは発生しない)。ここではpageの'download'イベントで
      //    実際にファイル取得の経路が動作したことを確認する。
      const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
      await page.getByRole('button', { name: 'ダウンロード' }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toBeTruthy();

      // 6. 削除。DocumentsPage.handleDeleteはwindow.confirm()を使うため、
      //    確認ダイアログを自動acceptする。
      page.once('dialog', (d) => d.accept());
      await page.getByRole('button', { name: '削除' }).click();

      // 7. 一覧から消え、空状態メッセージへ戻る
      await expect(page.getByText('文書がまだ登録されていません')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(file.name)).not.toBeVisible();

      // 8. reloadしても削除が永続化されている(soft delete + purgeがUIから
      //    見て「消えたまま」であることの確認。Gate M7 P0-04)
      await page.reload();
      await expect(page.getByText('文書がまだ登録されていません')).toBeVisible({ timeout: 15_000 });
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)}\n${diagnosticsSummary(state)}`);
    }
  });

  test('厳重管理(restricted)分類の文書を所有者自身が作成・閲覧できる', async ({ page }) => {
    test.setTimeout(90_000);
    const state = attachDiagnostics(page);
    try {
      const suffix = `restricted-${Date.now()}`;
      const planId = await createGuestPlan(page, suffix);

      const file = pdfFile(suffix);
      const uploadButton = await openDocumentsPage(page, planId);
      await fillAndSubmitUpload(page, uploadButton, file, 'restricted');

      // 所有者本人には厳重管理の文書も正しく表示される(P0-03は
      // owner本人を除外するものではない)
      await expect(page.getByText(file.name)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('厳重管理')).toBeVisible();

      await page.reload();
      await expect(page.getByText(file.name)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('厳重管理')).toBeVisible();
    } catch (e) {
      throw new Error(`${e instanceof Error ? e.message : String(e)}\n${diagnosticsSummary(state)}`);
    }
  });

  // [Gate M10-R2 P1] 監査報告書 §6 Gate M10-R2 項目5「restricted owner表示、
  // 別user/editorへの非露出/拒否を検証する」に対応する。backend側は
  // Gate M7で_document_visible_to()により、restricted文書をdocument owner
  // 本人以外(plan editorであっても)には一覧・詳細・download-urlのいずれ
  // からも存在自体を404で隠す設計になっており、backend/tests/
  // test_gate_m7_document_hardening.pyで単体検証済みだが、browser E2Eでの
  // 検証がこれまで存在しなかった。実際に2つの独立した正式アカウント
  // (owner/editor)・2つの独立したbrowser contextを使い、招待→承諾という
  // 実際の共同編集導線を経由した上で、editor側の画面に restricted文書が
  // 一切現れないことを確認する。
  test('厳重管理(restricted)文書はplanのeditorに招待された別ユーザーには一切表示されない', async ({ page, browser }) => {
    test.setTimeout(120_000);
    const stateOwner = attachDiagnostics(page);

    const context2 = await browser.newContext();
    const page2 = await context2.newPage();
    const stateEditor = attachDiagnostics(page2);

    try {
      const suffix = `${Date.now()}`;

      // 1. owner(A)を登録し、プランを作成する
      const ownerLabel = `owner-${suffix}`;
      await registerUser(page, ownerLabel);
      const planId = await createPlanAsCurrentUser(page, suffix);

      // 2. Aがrestricted文書と、対比用のconfidential文書をそれぞれ1件
      //    アップロードする
      const restrictedFile = pdfFile(`restricted-${suffix}`);
      const confidentialFile = pdfFile(`confidential-${suffix}`);
      const uploadButton = await openDocumentsPage(page, planId);
      await fillAndSubmitUpload(page, uploadButton, restrictedFile, 'restricted');
      await fillAndSubmitUpload(
        page,
        page.getByRole('button', { name: '新規アップロード' }),
        confidentialFile,
        'confidential',
      );
      await expect(page.getByText(restrictedFile.name)).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText(confidentialFile.name)).toBeVisible({ timeout: 15_000 });

      // 3. editor(B)を別accountとして登録する(別browser context、
      //    Aのセッションとは完全に分離されている)
      const editorLabel = `editor-${suffix}`;
      const { email: editorEmail } = await registerUser(page2, editorLabel);

      // 4. Aが/share/{planId}からBをeditor権限で招待する
      await page.goto(`/share/${planId}`);
      await page.getByPlaceholder('collaborator@example.com').fill(editorEmail);
      await inviteRoleSelect(page).selectOption('editor');
      await page.getByRole('button', { name: '招待を送信' }).click();
      await expect(page.getByText('コラボレーターを招待しました')).toBeVisible({ timeout: 15_000 });

      // 5. Bが/notificationsから招待を承諾する
      //
      // [Gate M10-R2 P1 回帰修正] 以前は`.p-4`要素をplanタイトル文字列の
      // 部分一致(hasText)のみで絞り込み`.last()`していたが、招待送信時に
      // 招待先が既存ユーザーであれば別途「「{title}」に招待されました」
      // という通常の通知(Notification)も作成され、こちらも`.p-4`かつ
      // 同じplanタイトルを含むため、DOM順で後に描画される通知一覧側の
      // カード(「承諾する」ボタンを持たない)に`.last()`が誤ってマッチ
      // してしまい、存在しないボタンへのclick()が120秒のtest timeoutまで
      // 無応答のまま待ち続ける事象が実機で発生した(NotificationsPage.tsx
      // 側にdata-testid="pending-invitation-card"を追加し、こちらのみを
      // 一意に選択するよう修正。あわせて、万一今後また一致しなくなった
      // 場合に120秒待たされるのではなく15秒で明確に失敗するよう、
      // clickの前に明示的なtoBeVisible待機を挟む)。
      await page2.goto('/notifications');
      const invitationCard = page2.locator(
        '[data-testid="pending-invitation-card"]',
        { hasText: `M10文書E2E-${suffix}` },
      );
      await expect(invitationCard).toBeVisible({ timeout: 15_000 });
      await invitationCard.getByRole('button', { name: '承諾する' }).click();
      await expect(page2.getByText('招待を承諾しました')).toBeVisible({ timeout: 15_000 });

      // 6. Bが文書ウォレット画面を開く。confidential文書は通常通り
      //    editorに見えるが(これが見えないと「B側の画面がそもそも
      //    正しくdocumentsを取得できていない」偽陰性を排除できない)、
      //    restricted文書はGate M7 P0-03によりowner以外には一切
      //    現れない(存在しないdocument_idと区別できない404で応答する
      //    設計のため、一覧からも静かに除外される)。
      await page2.goto(`/planner/${planId}/documents`);
      await expect(page2.getByRole('heading', { name: '文書ウォレット' })).toBeVisible({ timeout: 15_000 });
      await expect(page2.getByText(confidentialFile.name)).toBeVisible({ timeout: 15_000 });
      await expect(page2.getByText(restrictedFile.name)).not.toBeVisible();
      await expect(page2.getByText('厳重管理')).not.toBeVisible();

      // 7. reloadしても同様(キャッシュ由来の一時的な非表示ではないこと)
      await page2.reload();
      await expect(page2.getByText(confidentialFile.name)).toBeVisible({ timeout: 15_000 });
      await expect(page2.getByText(restrictedFile.name)).not.toBeVisible();
    } catch (e) {
      throw new Error(
        `${e instanceof Error ? e.message : String(e)}\n` +
          `--- owner(A)側診断 ---${diagnosticsSummary(stateOwner)}\n` +
          `--- editor(B)側診断 ---${diagnosticsSummary(stateEditor)}`,
      );
    } finally {
      await context2.close();
    }
  });
});

