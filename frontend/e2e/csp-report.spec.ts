import { test, expect } from '@playwright/test';

/**
 * [Gate S10] CSP の違反をブラウザが backend へ報告すること。
 *
 * 画面にインラインのスクリプトを差し込む(CSP は script-src に 'unsafe-inline' を許していないので止まる)。
 * ブラウザは CSP の report-uri へ報告を送り、backend は 204 で受け取る。
 */
test('CSP で止めたスクリプトの実行を、ブラウザが backend へ報告する', async ({ page }) => {
  const top = await page.goto('/');
  const csp = top!.headers()['content-security-policy'];
  expect(csp).toMatch(/report-uri \S+\/api\/v1\/security\/csp-report/);

  const reported = page.waitForResponse(
    (r) => new URL(r.url()).pathname.endsWith('/security/csp-report') && r.request().method() === 'POST',
    { timeout: 15_000 },
  );
  // 画面にインラインのスクリプトを差し込む(XSS の再現)。CSP の script-src は 'unsafe-inline' を許していないので実行されない
  // (page.evaluate そのものは開発者ツールの経路で CSP の対象外のため、差し込んだ要素で確かめる)
  const executed = await page.evaluate(async () => {
    const el = document.createElement('script');
    el.textContent = 'window.__cspInjected = true;';
    document.head.appendChild(el);
    // 差し込んだスクリプトは(許されていれば)その場で動く。次の描画まで待てば十分(固定の待ち時間は使わない。Gate G3 CI-04)
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    return (window as unknown as { __cspInjected?: boolean }).__cspInjected === true;
  });
  expect(executed).toBe(false);
  const response = await reported;
  expect(response.status()).toBe(204);
  const body = JSON.parse(response.request().postData() ?? '{}');
  expect(body['csp-report']?.['effective-directive'] ?? body['csp-report']?.['violated-directive']).toContain('script-src');
});
