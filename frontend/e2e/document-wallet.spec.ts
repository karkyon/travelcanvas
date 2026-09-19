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
});

