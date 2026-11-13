/**
 * [Gate Remaining-1] アプリの殻を端末に置く Service Worker(public/tc-push-sw.js)を登録する。
 * 通知と同じファイル(同じ範囲に 1 つしか置けないため)。API の応答は置かない。
 *
 * - 本番の組み立て(import.meta.env.PROD)だけ。自動操作のブラウザ(navigator.webdriver。試験)では登録しない
 *   (試験の通信の差し替えを Service Worker が素通りさせないため)
 * - 登録の後、手の空いた時に旅の当日の画面を読んでおく(通信が無い所で初めて開いても画面が出るように)
 */
export const APP_SHELL_SW_URL = '/tc-push-sw.js';

export function shouldRegister(env: { prod: boolean }, nav: Navigator | undefined): boolean {
  if (!env.prod || !nav) return false;
  if ((nav as Navigator & { webdriver?: boolean }).webdriver) return false;
  return 'serviceWorker' in nav;
}

export async function registerAppShell(nav: Navigator = navigator, prod: boolean = import.meta.env.PROD): Promise<boolean> {
  if (!shouldRegister({ prod }, nav)) return false;
  try {
    await nav.serviceWorker.register(APP_SHELL_SW_URL, { scope: '/' });
  } catch {
    return false;
  }
  const warm = () => {
    void import('@/pages/TodayPage').catch(() => undefined);
    void import('@/pages/today/live/TodayScreens').catch(() => undefined);
  };
  const w = window as Window & { requestIdleCallback?: (cb: () => void) => void };
  if (w.requestIdleCallback) w.requestIdleCallback(warm);
  else window.setTimeout(warm, 3000);
  return true;
}
