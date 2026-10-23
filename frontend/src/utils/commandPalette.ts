/** [Gate C3] 今の画面の経路から、開いているプランの ID を取り出す(コマンドパレットの「この旅行」) */
export function planIdFromPath(pathname: string): string | null {
  const m = /^\/planner\/([0-9a-f-]{36})(?:\/|$)/.exec(pathname);
  return m ? m[1]! : null;
}

/** [Gate G4] MAP-03 コマンドで旅程を変えた時に送る window の出来事(store/planStore.ts が受けて読み直す) */
export const PLAN_MUTATED_EVENT = 'tc:plan-mutated';
