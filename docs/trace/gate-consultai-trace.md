# Gate ConsultAI — 旅行相談の AI の読み取り・方面の案・Google の場所と経路(旅行を作る前の相談の口座)

基点: `gate/provider-connect` `679277e`。正本: 「Claude一括作業指示 旅行相談AI実接続・CI収束・ユーザーテスト準備」(2026-11-01)の Gate 3〜5。
外への通信の試験は httpx.MockTransport と、CI の E2E だけの模擬の提供元(`PROVIDER_HTTP_STUB`)。模擬の成功は実の API の成功ではない。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 相談の最初の文章を OpenAI Responses(構造化の出力・JSON Schema strict)で旅行の条件へ。地名・日付・人数・予算・移動・過ごし方・未確定のことを分ける | IMPLEMENTED | `consult_ai.SCHEMA`・`test_ai_extract_marks_ai_rows_unconfirmed_and_records_without_text` |
| 2 | AI の推定は「AI の読み取り · 未確認」。あなたの入力を優先。確かめた行だけを条件に使う。根拠の語は相談の文章に実際にある時だけ示す | IMPLEMENTED | `test_evidence_not_in_text_is_dropped_and_values_out_of_range_are_ignored`、vitest `ConsultAi.test.tsx` |
| 3 | 営業時間・料金・混み具合・所要時間を AI に作らせない(指示と schema に持たない)。方面の案は「AI の案 · 未確認」で、足した時だけ比べる | IMPLEMENTED | `consult_ai.INSTRUCTIONS`・`SuggestedAreasPanel`、E2E `zz-consult-ai.spec.ts` |
| 4 | 旅行を作る前の相談の口座(`trip_consult_sessions`・usage_budget_accounts scope_type='consult'、migration `c3e5a7b9d1f4`)。1相談 = 1旅行と同じ 50円・回数の枠。下書きを作ると使った額・回数・数えた月を旅行の口座へ移して相談を閉じる | IMPLEMENTED | `cost_guard.adopt_consult_account`・`test_places_route_then_draft_moves_usage_and_closes_consult` |
| 5 | 送る前に: 相談の持ち主・期限 → AI の利用の同意 → クラス・回数・50円(予約)→ 停止 → 確認済みの鍵。どれかが欠ければ外へ 0 回 | IMPLEMENTED | `test_no_consent_sends_nothing`・`test_free_class_and_unverified_key_send_nothing`・`test_ai_call_quota_and_cap_are_enforced_per_consult` |
| 6 | 時間切れは見込みで確定(解放しない)、5xx は解放、読めない応答(JSON でない・未完了・拒否)は使った分で確定して 502。二重押し・同じ Idempotency-Key で二度送らない | IMPLEMENTED | `test_timeout_and_5xx`・`test_unreadable_output_is_counted_and_reported`・`test_idempotency_and_session_ownership` |
| 7 | 方面の詳細で「Google で場所を探す」「出発地からの経路を調べる」(押した時だけ・出典と取得時刻・保存しない)。場所は参考の出典として下書きへ | IMPLEMENTED | `ConsultLookupPanel`・E2E `zz-consult-ai.spec.ts` |
| 8 | 鍵は画面へ来ない。相談の文章・AI の結果は保存しない。監査は件数と分類だけ | IMPLEMENTED | `test_ai_extract_marks_ai_rows_unconfirmed_and_records_without_text` |
| 9 | 画面: 同意の印・クラス・AI の状態(使えない理由)・この相談の利用枠。使えない時も AI を使わない読み取りで続けられる | IMPLEMENTED | vitest `ConsultAi.test.tsx` |
| 10 | 既存の旅行の中の「AI に聞く」も AI の利用の同意が無ければ送らない | IMPLEMENTED | `paid_actions.ai_suggest`・`test_gate_providerconnect.py` |
| 11 | 試験用の模擬の提供元(`PROVIDER_HTTP_STUB`)。本番・ステージングでは起動を拒む。画面・API に「模擬」と出す | IMPLEMENTED | `test_stub_answers_are_deterministic_and_refused_in_production`・E2E |
| 12 | 実の鍵での AI の読み取り・Places・Routes の少数の送信と請求の照合 | NOT_RUN(omega-dev2 で利用者が行う。runbook `secretpolicy-acceptance-omega-dev2.md`) | — |
| 13 | GCP Secret Manager(SECRET_BACKEND=gcp_secret_manager) | NOT_IMPLEMENTED(Gate ProviderConnect #18 のまま) | — |
| 14 | [監査 A01] PR の本文を期待の SHA から読む(古い作業ツリーで作れる)。push・PR・CI を段ごとに確かめ、途中から再開できる。重複の PR を作らない。新しい PR の head を確かめてから #43 を閉じる | IMPLEMENTED | `test_ops_consultai_apply.py`(古い作業ツリー・PR 作成の失敗からの再開・SHA 違い・fast-forward でない・置き場所) |
| 15 | [監査 A02] 同じ Idempotency-Key の並行・処理中の再送で二度送らない(送信権の原子的な確保 `sent_at`・unique の競合は同じ要求として扱う・要求の指紋 `request_hash`。違う内容は 409) | IMPLEMENTED | `test_concurrent_same_key_sends_once_on_real_postgres`(実の PostgreSQL・別々の接続で同時 → 送信 1・予約 1・確定 1) |
| 16 | [監査 A03] usage が無い・負・型違いを 0 とせず予約の見込みで確定(`usage_unknown`)。送った後の想定外の例外も解放しない(`local_error`)。期限切れの予約も送った後なら確定 | IMPLEMENTED | `test_unknown_usage_is_settled_at_the_reserved_amount`・`test_local_error_after_send_is_not_released` |
| 17 | [監査 A04/A05/A10] deploy: 未 merge・main の CI が赤・未追跡の衝突・模擬の設定は何も変えずに止まる。merge・squash の両方を見分ける。migrate の終了・DB の head・health/ready・画面(/・/trip-consult・/admin/ops)・LAN の CORS が 200/一致でなければ失敗。決め打ちの downgrade を案内しない | IMPLEMENTED | `test_ops_consultai_apply.py` |
| 18 | [監査 A06] 確かめていない日数・出発地を後の工程で使わない(日数は確かめるまで比較へ進めない) | IMPLEMENTED | vitest `Consult.test.tsx`・`ConsultInputs.test.tsx`、E2E |
| 19 | [監査 A07] 予算の意味(誰の分・対象: 宿泊費/交通費/食費/旅行全体/その他・期間・上限か目安か)。旅行全体の額を宿泊費にしない | IMPLEMENTED | `test_budget_meaning_and_other_wishes_are_kept`・`test_draft_keeps_budget_meaning_and_notes` |
| 20 | [監査 A08] 入力の仕方(AI に自由に相談 / 項目ごとに入力)・音声で入力(録音・停止・文字起こしの確認と修正・追加・取消)・その他の希望・追加で伝える(確かめた行は残し、違う値は変更案)・直前の変更を元に戻す | IMPLEMENTED(音声は安全な接続(https)が要る。http の LAN では理由を出して文字入力へ) | vitest `ConsultInputs.test.tsx`、E2E `zz-consult-ai.spec.ts` |
| 21 | [監査 A09] CI の検査の道具の自己試験は一時の要約へ書く。要約は総数と合格を分ける。E2E のリリース判定(失敗・flaky・欠落・0 件で止める) | IMPLEMENTED | `test_gate_g3_ci_tools.py`・conftest `_isolated_github_summary` |
| 22 | [監査 A11] 「サーバーに保存しない」と「このタブの間だけ一時的に残す」を分けて表示 | IMPLEMENTED | `ConsultAiPanels.tsx` |
| 23 | [監査 A12] Actions を Node 24 の版へ(setup-node v5・upload-artifact v5・setup-python v6・checkout v5)。差分の空白 0 | IMPLEMENTED | `git diff --check` |
