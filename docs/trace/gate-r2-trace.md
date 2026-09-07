# Gate R2 Trace表（QuickDraft）

正本: DOC-02（要件）, DOC-06（API）, DOC-05（DB）, ADR: `docs/adr/ADR-quick-draft.md`
状態値: IDEA -> DESIGNED -> IMPLEMENTED -> VERIFIED -> RELEASED（DOC-10方針。commit/test/migration/deploy/観測証拠が揃うまでIMPLEMENTEDと書かない）

| Sub-Gate | 要件/契約 | 対象 | 状態 | 根拠 |
|---|---|---|---|---|
| R2-0 | QuickDraft状態機械・Idempotency拡張・Promote規則の確定 | ADR-quick-draft.md v3 | DESIGNED | 本コミット。v1はbackend pytestが安全装置で失敗(DATABASE_URL未分離、コード変更・push無しでrollback)。v2で設計不備5件を是正。v3実行ではbackend 151/151・frontend 61/61全成功も、`diff_check`が無関係な未追跡ファイルを誤検知しcommit直前でrollback、スクリプト側のバグを修正 |
| R2-1 | `devices`, `quick_drafts`, `idempotency_records`拡張 migration | DB | IDEA | 未着手。ユーザー承認後に実施 |
| R2-2 | `POST /v1/quick-drafts` | API/DB/SEC | IDEA | 未着手 |
| R2-3 | `POST /v1/quick-drafts/{id}/promote` | API/DB/SEC | IDEA | 未着手 |
| R2-4 | frontend `createQuickPlan()`置換 | Frontend | IDEA | 未着手。既存逐次呼出し実装が残存 |
| R2-5 | Backend/Frontend/E2E/CI/観測 一式検証 | 全体 | IDEA | 未着手。この完了をもってFR-043/G1完了と判定する |

## 既知の非互換・要決定事項（ADRで確定済み、R2-1で実装）

| 項目 | 現状 | 決定 |
|---|---|---|
| `IdempotencyRecord.user_id` | `NOT NULL FK->users.id` | `NULL`許容化＋`device_id`列追加＋CHECK制約 |
| Idempotency payload比較 | 未実装（keyのみ一致で前回応答返却） | `payload_hash`列追加、異payloadは409 |
| Idempotency処理中状態 | 未実装 | `status IN_PROGRESS/COMPLETED/FAILED`追加 |
| Anonymous device token | 存在しない（guestはJWT、DB行なし） | 新規`devices`テーブル、token_digest方式 |
| エラー封筒 | `{"error":{...}}`（DOC-06 problem+json非準拠） | QuickDraft 2 endpointのみproblem+json新規導入 |

## v3失敗の記録と是正

| 項目 | v2実行時の問題 | v3での是正 |
|---|---|---|
| commit直前でrollback | `git add -A`がworktree直下の無関係な未追跡ファイル(ユーザーが確認用に置いたと見られる`ADR-quick-draft.md`/`gate-r2-trace.md`)まで拾い、「意図外の差分」として誤検知 | 本Gateが作成した`docs/adr/ADR-quick-draft.md`/`docs/trace/gate-r2-trace.md`の2ファイルのみ明示`git add`する方式へ変更 |
| commit後チェック | `git status --porcelain`が未追跡ファイルも拾い、commit後の残差分チェックを誤検知させ得る状態だった | `--untracked-files=no`へ変更し、tracked差分のみを見るよう修正 |
| テスト結果 | backend 151/151、frontend tsc/build/vitest 61/61すべて成功(この時点でADR/trace文書の内容自体に問題は無かった) | 変更なし(文書内容はv2のまま) |

## v1失敗の記録と是正

| 項目 | v1の問題 | v2での是正 |
|---|---|---|
| 実行時エラー | `docker compose exec -T backend pytest`が開発DBの`DATABASE_URL`をそのまま使用し、conftest.pyの安全装置で起動時abort | パッチスクリプトが`.env`のDATABASE_URLから末尾DB名のみを`DB_NAME_TEST`(既定`travelcanvas_test`)へ置換し、`alembic upgrade head`→`pytest`の順でtest DBに対してのみ実行する。URLはログへ出力しない(マスク表示のみ) |
| ヘッダー設計 | `X-Device-Token`という正式仕様に存在しないヘッダーを新設していた | `Authorization: Bearer`方式へ統一(既存guest実装と同じ経路) |
| DB制約設計 | UUID列への`COALESCE(column,'')`はPostgreSQLで型エラーになる | 部分unique index2本に変更 |
| Idempotency設計 | IN_PROGRESS〜mutation〜COMPLETEDを単一transactionにしており、`OPERATION_IN_PROGRESS`の即時応答要件(DOC-06 §22.3)を満たせない | Phase A(IN_PROGRESS即commit)/Phase B(mutation)/Phase C(結果反映)の2段階commitへ変更 |
| migration説明 | 「additiveのみ」と記述していたが`user_id`のNOT NULL緩和を含んでおり不正確 | 緩和である旨を明記し、downgrade時のデータ有無チェックを追加 |
| token/expiry/replay/audit | 未確定のまま次Gateへ先送りしていた | 生成方式(既存`_generate_refresh_secret`再利用)、保存(digestのみ)、expiry、stale in-progress回収、監査event/metricを具体化 |

## 却下案の記録

Gate R2a（仮`POST /api/v1/travel-plans/quick`、既存TravelPlan直書き）は2026-09-07付で不採用確定。理由と詳細はADR「却下した代替案」章、および`TravelCanvas_最新コード再々監査報告書_HEAD6d81e90_2026-09-07.md`を参照。
