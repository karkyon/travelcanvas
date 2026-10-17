# Gate K1 B-008 オフラインデータの鍵 トレーサビリティ表

- 対象: B-008、FR-032 Offline Pack、FR-048 Offline Travel Pack(DOC-02)、DOC-11(端末内データ)
- Gate: K1(API・画面・E2E。migration なし)
- 前提: Gate E1 適用後
- 関連ADR: `docs/adr/ADR-offline-keys.md`

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `backend/tests/test_gate_k1_offline_keys.py`(B)、`frontend/src/...`(F)、`frontend/e2e/offline-pack.spec.ts`(E)。

| # | 要件 | 根拠 | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 再ログイン・トークン更新後も保存したパックを読める | B-008 | IMPLEMENTED | B `test_get_key_returns_same_key_every_time_without_cache`; F `offlinePack.test.ts`; E |
| 2 | 通信できない時に端末の鍵で開ける | FR-032 | IMPLEMENTED | F `通信できなくても…`; E(backend 遮断) |
| 3 | 失効(全端末)。失効した版のデータは端末から消える | B-008、FR-048 | IMPLEMENTED | B `test_rotate_requires_if_match_and_checks_version`; F `失効…`; E |
| 4 | ログアウト後は鍵を受け取るまで開けない | DOC-11 | IMPLEMENTED | F `ログアウト後に通信できないと開けない` |
| 5 | 別の利用者のデータを開かない | DOC-11 | IMPLEMENTED | B `test_each_user_gets_a_different_key`; F `別の利用者…` |
| 6 | 当日画面の保存を暗号化し、平文を消す | FR-032、DOC-11 | IMPLEMENTED | F `todayModel.test.ts`, `TodayPage.test.tsx` |
| 7 | ゲストも保存できる | FR-032 | IMPLEMENTED | B `test_guest_can_get_a_key` |
| 8 | 鍵を DB・監査・ログに残さない | DOC-11、B-009 | IMPLEMENTED | B `test_rotate_is_audited_with_versions_only`、全ログ検査(鍵を秘密として登録) |
| 9 | 応答をキャッシュさせない・回数制限 | DOC-11 | IMPLEMENTED | B `test_get_key_…`, `test_rate_limits` |
| 10 | 利用者が版を戻せない | DOC-11 | IMPLEMENTED | B `test_profile_update_cannot_reset_the_key_version` |
| 11 | 改ざんされた暗号文を読まない | DOC-11 | IMPLEMENTED | F `改ざんされた暗号文は読まない` |
| 12 | 旧形式の移行 | — | IMPLEMENTED | F `以前の形式…` |
| 13 | API 契約 | DOC-06 | IMPLEMENTED | F `contract.test.ts`(4種), `k1offlinePack.test.ts`, `c2b3.test.ts`(242 routes) |
| 14 | 画面の a11y(axe 0件) | NFR | IMPLEMENTED | E |
| 15 | 端末ごとの失効・サーバー側パック | FR-048 | NOT STARTED | ADR §4 |
| 16 | XSS・悪意ある拡張からの保護 | — | NOT STARTED | ADR §3(クライアント暗号の限界) |
