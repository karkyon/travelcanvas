# Gate DOC10-Rev トレース(DOC-10 の版の食い違いの解消・状態の監査表)

対象: 利用者の監査「TravelCanvas 最新ソース監査と Claude 作業継続指示」(2026-10-30)の Gate A。
PR #36 の commit 本文と DOC-10 の変更履歴は r31 と書いたのに、DOC-10 の冒頭の版と `docs/trace/fr-status.json` の revision は r30 のままだった。
migration なし・API の変更なし・FR の状態の遷移なし。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 正本を r31 にそろえる(冒頭の版・`fr-status.json` の revision・変更履歴の最後の行)。r31 の行に #37 を書き足す | IMPLEMENTED | `docs/spec/DOC-10_*.md`・`docs/trace/fr-status.json` |
| 2 | 3つが食い違ったら CI で落とす | IMPLEMENTED | BE `test_gate_g1_doc10.py::test_doc10_revision_matches_status_and_changelog` |
| 3 | 表・集計は生成の道具で作る(手で直さない) | IMPLEMENTED | `python3 scripts/ci/render_doc10.py --check`(生成部分は一致)・`render_trace_index.py` |
| 4 | 基準 commit・試験の実測・CI の run を `ad041f5` に更新 | IMPLEMENTED | DOC-10 §0.1 |

## 状態の監査表(2026-10-31 時点)

凡例: **確認済み** = この Gate で証拠(CI の記録・コード・試験の実行)を取った / **報告のみ** = 利用者の貼ったログ・会話の報告だけで、こちらで取り直していない / **未確認** = まだ誰も確かめていない / **未実装** = コードが無い。

| 項目 | 状態 | 根拠 |
|---|---|---|
| main の先頭 `ad041f5`(#33・#35・#36・#37 を含む)・開いている PR 0 | 確認済み | `git log`・GitHub API(pulls?state=open は 0 件) |
| main の CI 5 ジョブ成功・E2E 99 合格・flaky の行なし | 確認済み | https://github.com/karkyon/travelcanvas/actions/runs/41070234927 |
| DOC-10 の版 r31・fr-status.json の revision r31 | 確認済み(この Gate) | 上の表 #1・#2 |
| Alembic head `f2a6d8c4b9e1`(単一) | 確認済み | BE `test_doc10_states_migration_head_and_baseline_commit` |
| omega-dev2 が `ad041f5` へ fast-forward・build・migrate の container が Exited | 報告のみ | 利用者の貼ったログ(2026-10-30)。`git rev-parse HEAD`・`alembic current`・`/ready` の出力はまだ無い |
| omega-dev2 の画面の受入(旅行相談の家族4人・地図・人数の確認・伊勢の観光の自動検索) | 未確認 | 利用者の実機の確認待ち |
| 運用コンソールの鍵の登録(アプリの DB の `provider_secrets` に暗号化して保存) | 確認済み(コード・試験) | 保存先は GCP Secret Manager ではない。鍵を登録しても提供元の adapter が無いので外へは送らない |
| 有料の提供元(OpenAI・Maps JavaScript・Places・Routes)の adapter・実の通信 | 未実装 | DOC-06・Runbook。契約・鍵・承認が先 |
| FR-059 の旅行1件 50円の上限 | Fake で確認済み・実請求は未確認 | Fake の家族旅行の試験は 49.55円で止まる。実の API の請求額の証明ではない |
| FR-058(料金・Entitlement・決済) | 未実装(製品の判断待ち) | fr-status.json で SPECIFIED |
| 新しい GCP の project への展開・限定公開 | 未実装 | workflow は backend の image の push と、任意で非公開の Cloud Run の backend だけ。frontend の配信は無い |
| ログイン・登録・設定の画面のモック化 | 未実装 | ハンドオフ 2026-10-30n |
