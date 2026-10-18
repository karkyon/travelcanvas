# Gate S7 段階的な計算の確認 トレーサビリティ表

- 対象: SEC-07(人間確認・ボット対策)
- Gate: S7(migration なし)
- 前提: Gate S6 適用後
- 関連ADR: `docs/adr/ADR-challenge.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は B = `backend/tests/test_gate_s7_challenge.py`、
U = `frontend/src/utils/challengeSolver.test.ts`・`frontend/src/services/api/core.challenge.test.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 点数が低い接続元には何も求めない | IMPLEMENTED | B `test_low_score_needs_nothing` |
| 2 | 怪しい接続元のログイン・登録・ゲスト開始・昇格に確認を求め、解けば通る | IMPLEMENTED | B `test_suspicious_client_must_solve_then_passes`、`test_login_guest_and_upgrade_are_protected` |
| 3 | 点数に応じて難しくなる・発行後に上がれば易しい解を拒む | IMPLEMENTED | B `test_difficulty_rises_with_score`、`test_easier_solution_after_score_rose_is_refused` |
| 4 | 偽造・誤った解・別の入口・形式違い・使い回し・別の接続元・期限切れを拒む | IMPLEMENTED | B `test_forged_or_wrong_solutions_are_refused`、`test_solution_cannot_be_reused`、`test_token_is_bound_to_client_and_time` |
| 5 | 画面が自動で解いて1回だけ送り直す(操作は増えない) | IMPLEMENTED | U `428 の問題を解き、同じ本文で1回だけ送り直す`、`送り直しても 428 なら…` |
| 6 | 不正な問題は解かない | IMPLEMENTED | U `問題が不正…`、`不正な問題は解かない` |
| 7 | backend と画面で同じ計算 | IMPLEMENTED | U `backend と同じ最小の解を見つける`、B `test_solver_matches_frontend_vectors` |
| 8 | ブラウザが問題を読める(CORS の expose) | IMPLEMENTED | B `test_challenge_headers_are_exposed_to_the_browser` |
| 9 | 常に求める・信頼する接続元・無効化 | IMPLEMENTED | B `test_always_mode_and_trusted_and_disabled` |
| 10 | 監視に数を出す | IMPLEMENTED | B `test_counted_in_metrics` |
| 10b | 解かずに送り続ける攻撃も最後は遮断する | IMPLEMENTED | B `test_ignoring_the_challenge_eventually_gets_blocked` |
| 11 | 外部 CAPTCHA | NOT STARTED | 必要になれば同じ 428 の仕組みで追加 |
