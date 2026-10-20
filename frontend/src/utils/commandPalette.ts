/** [Gate C3] 今の画面の経路から、開いているプランの ID を取り出す(コマンドパレットの「この旅行」) */
export function planIdFromPath(pathname: string): string | null {
  const m = /^\/planner\/([0-9a-f-]{36})(?:\/|$)/.exec(pathname);
  return m ? m[1]! : null;
}
