import { execFileSync, execSync } from 'node:child_process';
import path from 'node:path';

/**
 * [Gate A2] E2E から運用の道具(backend/scripts/security_incident.py)を動かす。
 *
 * - 管理者の権限は画面・API からは付けられない(運用者がサーバーの中で付ける。Runbook §8.5)
 * - 計算の確認の E2E は、それまでの試験で積み上がった接続元の点数(S6)を最初に消す(Runbook §3.9 と同じ扱い)
 *
 * CI・omega-dev2 は docker compose の backend のコンテナの中で動かす。docker の無い環境では E2E_OPS_CMD
 * (security_incident.py の引数を後ろに付けて動かすコマンド)で差し替える。
 */
function ops(args: string[]): void {
  const custom = process.env.E2E_OPS_CMD;
  if (custom) {
    execSync(`${custom} ${args.map((a) => JSON.stringify(a)).join(' ')}`, { stdio: 'pipe' });
    return;
  }
  // バインドマウント(./backend)へ pycache を書かない
  execFileSync('docker', [
    'compose', 'exec', '-T', '-e', 'PYTHONDONTWRITEBYTECODE=1', 'backend', 'python', 'scripts/security_incident.py',
    ...args,
  ], { cwd: path.resolve(process.cwd(), '..'), stdio: 'pipe' });
}

export function grantAdmin(email: string): void {
  ops(['grant-admin', '--email', email, '--yes', '--reason', 'e2e']);
}

/** 試験の後に管理者の権限を外す(開発の DB に試験用の管理者を残さない) */
export function revokeAdmin(email: string): void {
  ops(['revoke-admin', '--email', email, '--yes', '--reason', 'e2e']);
}

/** 全ての接続元の怪しさの点数・遮断を消す(試験の接続元は1つ) */
export function resetThreatScores(): void {
  ops(['unblock-all']);
}

/**
 * [Gate AuthE2E] 試験の環境だけ: 登録・ログインの回数制限(1分5回・接続元ごと)の記録を消す。
 * CI は全ての試験が同じ接続元から登録するため、試験の順と速さで前の試験の回数が残る。本番では使えない(backend が断る)
 */
export function resetAuthLimits(): void {
  ops(['e2e-reset-rate-limits', '--yes']);
}

/**
 * [Gate ConsultAI] CI の E2E だけ: 模擬の提供元(PROVIDER_HTTP_STUB)で、模擬の鍵を登録・確認し、
 * その会員に会員のクラスと AI の同意を付ける(実の API へは送らない)
 */
export function e2eStubReady(email: string, tier: 'trip' | 'journey' | 'explorer' = 'journey'): void {
  ops(['e2e-stub-ready', '--email', email, '--tier', tier, '--yes']);
}

/** [Gate ConsultAI] 模擬の鍵を無効にする(後の試験に「接続済み」を残さない) */
export function e2eStubReset(): void {
  ops(['e2e-stub-reset', '--yes']);
}
