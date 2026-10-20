# Gate S8 侵害が疑われる時の封じ込め トレーサビリティ表

- 対象: SEC-19(インシデント対応の手順)・SEC-20(封じ込めの手段)
- Gate: S8(migration なし)
- 前提: Gate S7 適用後
- 関連ADR: `docs/adr/ADR-incident-response.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験は `backend/tests/test_gate_s8_incident.py`(B)。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 警戒モードで全員に計算の確認、解除で元に戻る | IMPLEMENTED | B `test_lockdown_requires_challenge_from_everyone` |
| 2 | 新規登録・ゲスト開始を止められ、既存の利用者はログインできる | IMPLEMENTED | B `test_lockdown_can_close_signup_but_not_login` |
| 3 | 警戒モードで自動遮断の閾値を下げる | IMPLEMENTED | B `test_lockdown_lowers_the_block_threshold` |
| 4 | 警戒モードは期限付き・上限あり | IMPLEMENTED | B `test_lockdown_expires_and_is_bounded` |
| 5 | 1人・全員のセッションを失効(アクセストークンも即時に無効) | IMPLEMENTED | B `test_revoke_one_users_sessions`、`test_revoke_everyone`、`test_revoke_requires_exactly_one_scope` |
| 6 | 危ない・効果の無い操作を拒む(全員の失効の確認、Redis 無し) | IMPLEMENTED | B `test_script_refuses_unsafe_or_ineffective_use` |
| 7 | 運用のコマンドから backend のコンテナへ渡す | IMPLEMENTED | B `test_tcops_passes_security_commands_into_the_backend` |
| 8 | 手順・鍵の替え方 | IMPLEMENTED | Runbook §8 |
| 9 | 暗号化の鍵の版の切り替え | NOT STARTED | SEC-F(DB の変更が要る) ※ **SUPERSEDED BY Gate G1(SEC-F1。DB の変更なしで実装。docs/ops/KEY-INVENTORY.md)** |
