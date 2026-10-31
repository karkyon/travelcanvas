# Gate SecretPolicy — 外部 API 鍵の取得元の一本化

基点: main `31016201cf35698d6de4f2ef0c40a5294e6a2a04`。実 API は呼ばない(adapter は未実装のまま)。提供元の認証の検証・Secret Manager・adapter は別 Gate。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 取得元は DB の有効な登録版だけ。.env・環境変数・settings へ戻らない | IMPLEMENTED | `test_no_db_version_never_falls_back_to_env`、`test_db_value_wins_and_env_is_never_read` |
| 2 | 無効化は保持され missing と区別。無効後も .env へ戻らない | IMPLEMENTED | `test_disabled_stays_disabled_even_with_env_left` |
| 3 | サンプル値(CHANGE_ME 等)を登録・移行で拒否。保存済み・.env の検出でも同じ規則 | IMPLEMENTED | `test_known_samples_are_placeholders`、`test_cms_rejects_placeholder_and_keeps_active_version`、`test_stored_placeholder_is_unusable_and_visible`、`test_env_placeholder_is_not_a_key` |
| 4 | 不正な候補で正常な有効版を壊さない | IMPLEMENTED | 同上 |
| 5 | 状態を分離(登録・形・取得・提供元認証)。登録済み≠提供元が認めた | IMPLEMENTED | `test_registered_is_not_provider_verified`、`test_corrupt_ciphertext_is_decrypt_failed_and_does_not_use_env` |
| 6 | 旧 .env は管理者の明示操作でだけ取り込む(理由必須・監査・値は返さない・.env は消さない) | IMPLEMENTED | `test_explicit_import_from_env`、`test_import_requires_admin` |
| 7 | 同時登録は 409、監査が書けなければ鍵も変えない(同一 transaction) | IMPLEMENTED | `test_conflict_is_reported_and_changes_nothing`、`test_audit_failure_changes_nothing` |
| 8 | 鍵の取得口は provider_secrets だけ。SDK の自動取得・静的なブラウザ鍵の経路が無い | IMPLEMENTED | `test_no_code_outside_provider_secrets_reads_provider_key_settings`、`test_frontend_has_no_static_google_maps_key_path` |
| 9 | 保管先: 最終の正本は GCP Secret Manager(要件02・運用環境07・スタック08・SaaSセキュリティ設計)。`SECRET_BACKEND` は未設定が既定(=鍵を取得も送信もしない)で、暫定の db_encrypted は明示した時だけ有効。自動選択はなく、自動探索・障害時の切替をしない。db_encrypted でも .env fallback は 0。未接続・不正な保管先は鍵を取得せず fail closed | IMPLEMENTED(明示モードと fail closed のみ) | `test_unconnected_or_invalid_backend_fails_closed_without_switching`、`test_app_has_no_default_backend_and_db_encrypted_must_be_chosen`、`test_db_encrypted_is_reported_as_interim_in_the_console`、`test_backend_unavailable_is_503_in_the_api` |
| 9b | Secret Manager 本体の接続(実行ID・最小IAM・版の固定・ローテーション・復旧・監査)。**判断**: GCP プロジェクト・実行ID・短期認証の用意が前提で、SEC-F3(gate-g1)は PROD と同時の未着手。LAN 受入はこの前提を置かない(別の指示書)。よって暫定モードで受入し、「高セキュリティ移行完了」とは報告しない | NOT_IMPLEMENTED(別 Gate・要 GCP 側の準備) | — |
| 9c | 提供元への実接続の検証・adapter・鍵の入れ替え手順 | NOT_IMPLEMENTED(別 Gate) | — |
| 10 | 実機 192.168.1.11 の受入 | NOT_RUN(この Gate の変更の試験結果は上の自動試験のみ。過去の合格は流用しない) | — |

## 正本仕様との対応(外部 API 鍵まわり)

| 正本 | 要求 | この Gate の実装 | 状態 |
|---|---|---|---|
| 02 要件定義書 353行 | 鍵・秘密は KMS/Secret Manager で管理し、監査・ローテーションする | 保管先を `SECRET_BACKEND` で明示。未設定・不正・未接続は鍵を取得せず送信しない。監査は鍵の変更と同一 transaction | 部分(Secret Manager 本体は未接続) |
| 07 運用環境 87行 | 秘密(DB password・JWT key・API key)の保管先は Secret Manager | `gcp_secret_manager` は選択肢として予約。接続が無い間は fail closed。`db_encrypted` は開発・LAN 受入の暫定 | 暫定 |
| 07 運用環境 190・205行 | API key をログ・複製に出さない | 応答・監査・ログに値を出さない(`test_secret_values_never_appear_in_responses_audit_or_logs`) | 実装済み |
| 08 スタック 118行 | Secrets は Cloud Secret Manager + KMS | 同上。サービスアカウント鍵ファイルは作らない | 未接続 |
| 11 セキュリティ | 秘密・個人情報をログに出さない | 同上。ログ検査は caplog(DEBUG)で実施 | 実装済み |
| 10 台帳(B-008 ほか) | 鍵管理・失効は別の項目として管理 | この Gate は外部 provider 鍵だけ。Offline Pack の鍵管理は対象外 | 対象外 |
| 14 MAP 289・291行 | MapView は表示部品で中核機能ではない。分割して拡張する | 旧 Google 用 MapView は参照ゼロのため削除(下記)。MAP provider は ADR で決める(08 の 351行) | 実装済み |
| 02 EX-020 | AI provider 全面停止でも手動入力・既存旅程を維持 | 保管先・鍵が使えない時は provider へ送らないだけで、画面の他の機能は止めない | 実装済み |
| 仕様追補(50円/旅行) | 実 API の原価上限・原価の実測 | FR059 の cost_guard は main に既存。**実 API の原価実測・請求照合は未実施** | 未完了 |

## 旧 Google 用 MapView の削除の根拠
- main の `frontend/src` で `MapView` を import している画面は無い(参照は `UiIcon.test.tsx` の「どこからも使われていない部品」の許可一覧と、`PlanMap.tsx` の経緯コメントだけ)。
- 実際の地図は `PlanMap`(Leaflet + OpenStreetMap)で、`PlannerPage` と相談の `AreaMap` が使う。これらの単体試験は vitest 全件に含まれ合格。
- 14 MAP 仕様の 289・291行は MapView を「表示部品」と位置づけ、分割して拡張する方針で、保持を必須とはしていない。MAP provider の採用は ADR で決める(08 の 351行)ため、Google 地図を採るなら、ブラウザ用の鍵は別 slot で公開前提の設計を新しく作る。
- 残る検証: 地図・経路の画面の E2E は CI(GitHub Actions)で確認する。ローカルでは未実行。
