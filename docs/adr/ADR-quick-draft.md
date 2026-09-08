# ADR: QuickDraft 正式契約（Gate R2-0 Contract Freeze）

- 状態: ACCEPTED
- 日付: 2026-09-07
- 対象: Gate R2-1〜R2-5（正式`quick_drafts`実装）
- 正本: DOC-02, DOC-05, DOC-06, DOC-09, DOC-11, DOC-13 (v5.1)
- 監査基準HEAD: `6d81e900e6c2ebf4b73cf24d9c295f57170a6396`
- 却下案: Gate R2a（仮`POST /api/v1/travel-plans/quick`、既存TravelPlan直書き）

## 改訂履歴

| 版 | 内容 |
|---|---|
| v1 (2026-09-07) | 初版。omega-dev2実行時にbackend pytestが`DATABASE_URL`未分離のため安全装置で失敗、rollbackで無傷。コード変更・pushなし。 |
| v2 (2026-09-07) | v1の設計不備を独立clone再調査のうえ是正: (1) 未定義ヘッダー`X-Device-Token`を廃止しAuthorization Bearer方式へ統一、(2) UUID列への`COALESCE(...,'')`を部分unique indexへ訂正、(3) Idempotency状態遷移を2段階commitへ変更（単一transactionでは`OPERATION_IN_PROGRESS`の即時応答要件を満たせないため）、(4) migrationを「additiveのみ」とした記述を訂正（`user_id`のNOT NULL緩和を明記）、(5) token生成・保存・expiry・replay・stale in-progress回収・監査方針を具体化。パッチスクリプトはbackend pytest実行前に専用test DBへ`DATABASE_URL`を安全に切替える処理を追加。 |
| v3 (2026-09-07) | omega-dev2実行でbackend 151/151・frontend tsc/build/vitest 61/61すべて成功したが、`diff_check`が`git add -A`でworktree直下の無関係な未追跡ファイル(ユーザーが確認用に置いたコピー)まで拾い「意図外の差分」として誤検知しcommit直前で失敗、rollback。ADR/trace文書自体の内容変更は無し。パッチスクリプトを本Gateが作成した2ファイルのみ明示`git add`する方式へ修正し、commit後の残差分チェックも未追跡ファイルを無視するよう修正。 |
| v4 (2026-09-08, Gate R2-6) | R2-5完了時点でPARTIALのまま残っていた4項目のうち「Playwright browser E2E」「CIへのE2E blocking追加」を実装。詳細はdocs/trace/gate-r2-trace.mdのR2-6行、および本ADR §11参照。副次的発見1として`frontend/src/services/quickDraftApi.ts`の`resolveApiBaseUrl()`が`docker-compose.yml`のbuild引数`VITE_API_URL`を見ておらず`VITE_API_BASE_URL`のみ参照していたため、`VITE_API_URL`を変更する本番相当デプロイでは常に既定値`http://localhost:8001`へ誤fallbackする不整合を発見・是正(omega-dev2では既定値と実際の値が偶然一致するため症状が表面化していなかった)。副次的発見2として`frontend/Dockerfile`のruntime stageが`COPY --from=build`に`--chown`を指定しておらずroot:root所有のままだったため、`USER node`後の`npm run preview`が`package.json`を`EACCES`で読めずfrontendコンテナが起動不能というインフラ上の既存バグを発見・是正(`--chown=node:node`を追加)。**v1はomega-dev2実行時、`docker compose up -d --build`のfrontendビルドが`npm ci`でlockfile不同期(`@playwright/test`が`package-lock.json`未反映)のため失敗しrollback(無傷)。v2で`package-lock.json`を修正対象へ追加して是正したが、イメージビルド自体は成功したもののfrontendコンテナ起動後に上記EACCESで再起動ループしhealth待機タイムアウト、再度rollback(無傷)。v3でDockerfileの`--chown`修正を追加して是正。**v4はv3実行時、docker/frontend起動・backend pytest(177/177)・frontend tsc/build/vitest(62/62)まで全て成功したがPlaywright実行時にguest bootstrap後`/login`への連続リダイレクトが発生し失敗、rollback(無傷)。原因未特定のためcurlベースの診断ステップとE2E側のHTTPエラー計装を追加して原因特定を試みる段階。** **v5はv4実行時、curl診断でbackend側(guest token発行・`/travel-plans/`取得)は正常と確認できたが、`waitForLoadState('networkidle')`自体がタイムアウトし診断ログが埋もれたため、networkidle待ちを廃止しフレーム遷移回数カウント方式へ変更、また要望により過去セッションの残置ファイル自動削除を追加。** **v6はv5実行で真因が判明: `frontend/src/components/Header.tsx`の未読通知バッジポーリングeffectが`isGuest`を使わずguestでも会員限定の`/notifications/unread-count`を叩き続け、401→`/auth/refresh`401→`window.location.href='/login'`強制リロードを無限に繰り返していた実害バグ。effectガードに`isGuest`を追加して是正。**** |
| v5 (2026-09-08, Gate R2-7) | R2-5完了時点で残っていた最後の2項目「accessibility試験」「audit/metric基盤」を実装。詳細は本ADR §9(改訂)・§12、docs/trace/gate-r2-trace.mdのR2-7行参照。この完了をもってR2-5の未達4項目が全て解消し、FR-043/G1はVERIFIED判定の前提条件を満たす（DOC-10更新は別途実施）。 |

## 背景

DOC-06はQuickDraftを次の正式契約として定義している。

```
POST /v1/quick-drafts          | anonymous device token | title?,start_date,end_date,events[] | 201 QuickDraft | 400/413/429
POST /v1/quick-drafts/{id}/promote | user/owner | target_plan_id?,base_revision | 201 Plan | 401/403/409/410
```

現行コード（HEAD `6d81e90`）を独立clone・実コードで確認した結果、以下が判明した。

1. `quick_drafts`テーブル・モデルは存在しない。
2. `POST /api/v1/travel-plans` 等、既存TravelPlan APIをfrontend `createQuickPlan()`が逐次呼出し（plan作成→day作成→event作成を複数リクエストに分割）しており、途中失敗時に中間plan/dayが残留するリスクがある。
3. Anonymous device token（DBでrevoke可能なtoken_digest方式）は存在しない。現行の「ゲスト」は`users`テーブルに`user_type='guest'`の行を作り、ステートレスJWT（`backend/app/core/auth.py: create_guest_token`）を発行する方式であり、DB側にセッション/デバイス行を持たない。個別tokenの即時失効ができない。
4. Idempotency機構は存在する（`IdempotencyRecord`, Gate #29, `backend/app/models/models.py:472`）が、次の理由で正式契約を満たさない。
   - `user_id`が`NOT NULL FK -> users.id`であり、匿名デバイスを表現できない。
   - リクエストpayloadのhashを保存・比較していない（同一key・異payloadでも常に前回応答を返しており、`409 IDEMPOTENCY_KEY_REUSED`を返す分岐が無い）。
   - `IN_PROGRESS`状態が無く、同時多重送信時に二重実行を防げない。
   - `expires_at`（TTL）が無く、無期限に蓄積する。
5. エラー応答は`{"error": {...}}`形式であり、DOC-06が要求する`application/problem+json`ではない。

## 決定事項

### 1. Anonymous device tokenの発行・hash保存・expiry・revoke

- 新規`devices`テーブルを追加する。列: `id UUID PK`, `token_digest bytea UNIQUE NOT NULL`（token本体はDB保存しない、SHA-256 digestのみ）, `created_at`, `last_seen_at`, `revoked_at NULL`, `expires_at`。
- token本体はサーバーが生成しレスポンス時に一度だけ返す（share tokenと同じ方針、DOC-11 §5）。JWTではなくランダムopaque tokenとし、`X-Device-Token`ヘッダーで送信する。
- 既定TTLは30日（`quick_drafts.expires_at`と同期）。`last_seen_at`更新でスライド延長はしない（固定期限、DOC-05のpurge方針に合わせる）。
- revokeは`revoked_at`セットのみ（物理削除しない、監査のため）。

### 2. 現行guest Bearer tokenとの互換・移行方針

- 現行の`X-Guest-Token`（`users.user_type='guest'`のJWT、plan共同編集用）とは**別モデルとして併存**させる。QuickDraft用device tokenは「ログイン前にイベントを1件も無駄なく保存する」という別ユースケースのために存在し、既存guestの「plan/day/eventを直接編集する」ユースケースとは責務が異なるため無理に統合しない。
- 統合は行わず、promote成功時に`quick_drafts.promoted_plan_id`経由でTravelPlanへ変換し、以後は既存guest/member経路に合流させる。
- 移行期間・廃止期限は設定しない（別モデルとして恒久的に併存する設計のため）。

### 3. `X-Guest-Token`と`Authorization`混在規則

**[R2-0改訂] `X-Device-Token`という独自ヘッダーは導入しない。**

DOC-06 §2の共通ヘッダー表を再確認した結果、`X-Device-ID`（オフライン端末識別、非秘密の識別子）と`Authorization`（Bearer access token）は定義されているが、`X-Device-Token`のような専用ヘッダーは正式仕様に存在しない。また現行コード（`backend/app/core/auth.py: create_guest_token`）を確認すると、現行guestトークンも実際には独自ヘッダー`X-Guest-Token`ではなく**`Authorization: Bearer <guest JWT>`として送信**されている（`get_current_user`がAuthorizationヘッダー1本でuser/guest両方を判定する設計）。DOC-06記載の`X-Guest-Token`は現行コードでは未実装のまま放置された仕様であり、Gate R1監査でも指摘済みの既知ギャップである（このADRで新規に矛盾を持ち込まない）。

決定：

- Anonymous device tokenは`Authorization: Bearer <device-token>`として送信する（既存のBearer方式に統一。新規ヘッダーを増やさない）。
- Device tokenと通常user/guest tokenはJWTの`type`クレームで区別する現行方式を踏襲せず、**JWTにしない**（4.の理由により、DBでrevoke可能なopaque tokenとする）。したがってAuthorizationヘッダーの値そのものからは種別を判別できないため、`POST /v1/quick-drafts`はまず`devices.token_digest`照合を試み、一致すればdevice tokenとして処理する（user/guestのJWT検証とは別経路）。
- Promote系（`POST /v1/quick-drafts/{id}/promote`）は`Authorization: Bearer <user access token>`（user/owner認証）必須。加えてrequest bodyまたは別ヘッダーではなく、**draft作成時に発行したdevice tokenをrequest body内`device_token`フィールドとして送らせる**（Authorizationヘッダーは1つしか値を持てず、user認証とdevice所有証明を同時に表現できないため）。これによりdraft所有者本人であることを確認する。
- `X-Device-ID`（既存・オフライン端末識別用）とは別概念として扱う。混同を避けるため`devices`テーブルの主キーはQuickDraft専用とし、offline sync用の`X-Device-ID`とは現時点で統合しない（統合は将来のADRで再検討）。

### 4. QuickDraft状態機械

`ACTIVE -> PROMOTED | EXPIRED | REVOKED`（DOC-05/指示書どおり）。

- `ACTIVE`: 作成直後、promote可能。
- `PROMOTED`: promote成功後、以後の変更・再promoteは`410`。
- `EXPIRED`: `expires_at`経過後、batch purgeまたは参照時rejectで判定。
- `REVOKED`: 明示的破棄（今回スコープでは実装するが、公開APIとしては将来課題。R2-2ではdevice所有者本人のみ許可）。

### 5. Idempotency状態機械

既存`IdempotencyRecord`（Gate #29）を**廃止せず拡張**する。理由: 汎用Idempotency機構を二重に持つと将来の全Mutation API統一の妨げになるため。

- migrationで`idempotency_records`へ追加: `device_id UUID NULL FK->devices.id`, `payload_hash bytea NOT NULL`, `status varchar NOT NULL DEFAULT 'COMPLETED'`（IN_PROGRESS/COMPLETED/FAILED）, `expires_at timestamptz NOT NULL`。
- `user_id`を`NULL`許容へ変更し、`CHECK (user_id IS NOT NULL OR device_id IS NOT NULL)`を追加（既存行は`user_id`のみ、新規device行は`device_id`のみ）。この`ALTER COLUMN user_id DROP NOT NULL`は制約緩和であり、既存データは失わないが「additiveのみ」ではない変更である（後述10節で訂正）。

**[R2-0改訂] 一意制約に`COALESCE(uuid_column, '')`は使わない。** UUID型の列に空文字列`''`をCOALESCEすると、PostgreSQLでは`invalid input syntax for type uuid`となり成立しない（前回ADR案の誤り）。代わりにPostgreSQLの**部分unique index（partial unique index）**を2本使う。

```sql
CREATE UNIQUE INDEX uq_idempotency_user
  ON idempotency_records (key, user_id, endpoint)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX uq_idempotency_device
  ON idempotency_records (key, device_id, endpoint)
  WHERE device_id IS NOT NULL;
```

- 状態遷移（2段階commitとする。理由は次項）:
  1. **Phase A（独立した短いtransaction、即commit）**: `INSERT ... status='IN_PROGRESS', payload_hash=...`。部分unique indexにより同一key/actor/endpointの同時多重INSERTは1件だけ成功する。
  2. **Phase B（別transaction）**: 実際のmutation（quick_draft作成 or promote変換）を実行する。
  3. **Phase C（Phase Bと同一or直後の短いtransaction）**: 成功時は当該recordを`status='COMPLETED'`＋`response_status`/`response_json`で更新、失敗時は`status='FAILED'`＋error内容で更新する。
- 同key・同payload_hashで`status='IN_PROGRESS'`中の再送は、Phase AのINSERTがunique違反となった時点でSELECTしてstatusを確認し、`409 OPERATION_IN_PROGRESS`を返す。
- 同key・異payload_hashは`409 IDEMPOTENCY_KEY_REUSED`。
- 同key・同payload_hashで`COMPLETED`は保存済みresponseをそのまま返す。
- `FAILED`のrecordは同一keyでの再試行を許可する（Phase Aで既存FAILED行を検出したら、同一トランザクションでその行を`IN_PROGRESS`へ再遷移させてから処理を続ける）。

**[R2-0改訂] なぜ単一transactionではないか**: 前回ADR案は「INSERT(IN_PROGRESS)〜mutation本体〜UPDATE(COMPLETED)」を1つのtransactionに収める記述だった。しかしPostgreSQLのREAD COMMITTEDでは他transactionは未commitの行を見えない。同時多重送信時、後続requestのINSERTは先行transactionの行lockにより**commitされるまでblockする**ため、「処理中なら即座に409 OPERATION_IN_PROGRESSを返す」という契約（DOC-06 §22.3）を満たせない（応答がmutation処理時間ぶん遅延し、DBコネクションも塞ぐ）。Phase Aを独立commitにすることで、後続requestは概ね即座にunique違反を検出し、blockせずに409を返せる。

### 6. Promote状態機械

- `ACTIVE`かつdevice token所有者一致 → 変換実行 → `PROMOTED`。
- 既に`PROMOTED`かつ同一`Idempotency-Key`・同`base_revision` → 同じ`promoted_plan_id`を201で再返却（replay）。
- 既に`PROMOTED`だが異なるrequest → `409`。
- `EXPIRED`/`REVOKED` → `410`。
- `target_plan_id`指定時、`base_revision`不一致 → `409 REVISION_CONFLICT`。
- TravelPlan/TravelDay/TravelEventへの変換は単一DBトランザクション（全成功 or 全ロールバック）。

### 7. Error code/status/content-type

- QuickDraft関連の新規エンドポイント2件のみ、DOC-06準拠の`application/problem+json`エラー封筒を新規導入する。
- 対応表: `400 INVALID_REQUEST` / `401 AUTH_REQUIRED` / `403 PERMISSION_DENIED` / `404 RESOURCE_NOT_FOUND` / `409 IDEMPOTENCY_KEY_REUSED|OPERATION_IN_PROGRESS|REVISION_CONFLICT` / `410 RESOURCE_GONE`（EXPIRED/REVOKED/既promote） / `413 FILE_TOO_LARGE`（events件数上限超過時に流用） / `429 RATE_LIMITED`。
- 既存エンドポイント（`{"error":{...}}`形式）は本Gateでは変更しない（影響範囲を限定するため、problem+json化は別Gateで全API統一）。

### 8. Encryption/retention/purge

**[R2-0改訂] token本体の扱い・暗号化方式を具体化する。**

- **Device token生成**: `secrets.token_urlsafe(32)`で生成（既存`backend/app/core/auth.py`の`_generate_refresh_secret`と同じ関数・同じ強度を再利用し、新方式を増やさない）。
- **Device token保存**: 平文は一切DBへ保存しない。`token_digest = SHA-256(token)`のみを保存する（既存`_hash_refresh_secret`と同じ方式を再利用）。レスポンスでは作成時に一度だけ平文tokenを返す。
- **Device token expiry**: `devices.expires_at`は作成から30日固定（スライド延長なし）。`last_seen_at`はrate limit/異常検知用の参考値としてのみ更新し、有効期限には影響しない。
- **Device token replay**: 全リクエストで`token_digest`照合＋`revoked_at IS NULL`＋`expires_at > now()`を確認する。一致しなければ`401 AUTH_REQUIRED`（存在しないtokenと失効tokenを区別する情報は返さない）。
- **`quick_drafts.payload_ciphertext`**: DOC-11 §6のenvelope encryption（DEK/KMS Key）を適用するfield encryption対象とする（INTERNAL相当のtitle/日付/eventsを含むため）。algorithm、key version、nonce、auth tagをciphertextに関連付ける（DOC-11 §6.3準拠）。
- **保持期間**: `quick_drafts`は30日固定。日次batch jobで`expires_at`経過かつ`status='ACTIVE'`を`EXPIRED`へ遷移、さらに7日後に物理delete（`promoted_plan_id`が設定された行はpurge対象から除外し、監査目的で90日保持）。
- `idempotency_records`の新規device行も`expires_at`（既定7日、`COMPLETED`/`FAILED`到達時点から起算）で同様purge。`IN_PROGRESS`のまま一定時間（既定15分）経過した行は、crash recoveryとしてbatch jobが`FAILED`へ強制遷移させ、再試行を可能にする（DOC-06 §22.3のstale in-progress timeoutに対応）。

### 9. Audit/metric

**[Gate R2-7改訂] 本節で述べていた監査イベントはR2-6完了時点まで未実装(`schemas.AuditLog`は定義済みだがDBテーブル・書き込み経路が存在しないゴーストスキーマ)だった。R2-7で`audit_logs`テーブル(migration `9f0906d65cdc`)と`app/services/audit_service.record_audit_event()`により実体化した。**

- 実装済み: ログイン成功/失敗(`login_success`/`login_failed`)、QuickDraft promote成功(`quickdraft_promoted`)、管理者によるユーザー操作(`admin_user_suspend`/`admin_user_unsuspend`/`admin_user_verify`/`admin_user_unverify`)を`audit_logs`へ永続化。`GET /api/v1/admin/audit-logs`(管理者専用、ページネーション対応)で参照可能。
- 監査ログ書き込みは独立DBセッションで行い、書き込み失敗時は例外を握りつぶしwarningログのみ残す(監査ログの欠落より本来の操作失敗の方が実害が大きいため)。
- token本体・パスワードは記録しない(`login_failed`のdetailsにはemailのみ、パスワードは含めない)。
- **未実装(次Gate以降のスコープ)**: `QuickDraftCreated`/`QuickDraftExpired`/`QuickDraftRevoked`/`QuickDraftIdempotencyConflict`の監査イベント化、および作成成功率・promote成功率等のmetricダッシュボード自体(現時点では`audit_logs`への生ログ蓄積とAPI参照のみ。集計・可視化は別途)。

### 10. Rollback/restore

**[R2-0改訂]「additiveのみ」という記述は不正確だったため訂正する。**

R2-1のmigrationは以下の2種類を含む。

1. **純粋additive**: 新規テーブル`devices`の作成、`idempotency_records`への`device_id`/`payload_hash`/`status`/`expires_at`列追加、部分unique index 2本の追加。
2. **制約緩和（非破壊だがadditiveではない）**: `idempotency_records.user_id`を`NOT NULL`→`NULL`許容へ変更する`ALTER COLUMN`。既存行のデータは失われず、既存行はすべて`user_id`が非NULLのまま残るため後方互換だが、スキーマ定義そのものの変更であることを明記する。

downgradeでは、(2)を`user_id`へ`NOT NULL`を戻す前に、`device_id IS NOT NULL AND user_id IS NULL`の行（=device発行のidempotency record）が存在しないことを確認する（存在すれば失敗させ、データ損失を伴うdowngradeを自動実行しない）。(1)は追加列・追加テーブル・追加indexを削除するだけで既存データへ影響しない。

- 本ADR自体（R2-0）はコード変更を伴わないため、rollbackは本ファイル・trace表の`git revert`のみで完結する。

### 11. E2E検証（Gate R2-6追記）

- 対象シナリオ: 匿名ゲスト開始 → QuickDraft作成(`POST /quick-drafts`) → promote(`POST /quick-drafts/{id}/promote`、`createQuickPlan()`内で作成に連続して自動実行) → `/planner/{id}`遷移確認 → **reload**による再取得後もplan/日程/予定の表示が保持されること(=DBへの実永続化の確認。クライアント側optimistic stateの検証ではないこと) → 一覧画面に戻っても表示が継続すること。
- 実行方式: `frontend/e2e/quickdraft-flow.spec.ts`（Playwright、chromium）。`frontend/playwright.config.ts`の`baseURL`は既定`http://localhost:4173`（`PLAYWRIGHT_BASE_URL`で上書き可）。
- 実行環境: omega-dev2上で`docker compose up -d`済みのフルスタック（backend: 8001 / frontend: 4173）に対して実行する。開発サンドボックス環境にはdockerが無いため、browser E2Eの実地実行はomega-dev2側でパッチスクリプト自身が行う。
- CI: `.github/workflows/ci.yml`の`e2e` job が `docker compose up -d --build` でpostgres/redis/backend/frontendを起動し、`frontend`/`backend` jobの成功後にblocking実行する。
- 未対象: accessibility試験、audit/metric基盤（監査イベント永続化・ダッシュボード）は本Gateのスコープ外。docs/trace/gate-r2-trace.mdのR2-5行に残存項目として明記済み。

### 12. Accessibility試験・監査ログ基盤（Gate R2-7追記）

- **Accessibility試験**: `frontend/e2e/a11y.spec.ts`（Playwright + `@axe-core/playwright`）で、ランディングページ("/")とゲストのプランナー画面("/planner")の2画面をWCAG 2.0/2.1 A・AA相当のルールセット(`wcag2a`/`wcag2aa`/`wcag21a`/`wcag21aa`)でスキャンする。violationsが1件でもあれば、ルールID・重要度・該当要素数・参考URLを列挙して失敗させる。動的なキーボード操作シナリオ(タブ順序、フォーカストラップ等)は本Gateのスコープ外。
- **Audit/metric基盤**: §9(改訂)参照。`audit_logs`テーブル新設(migration `9f0906d65cdc`、additive only)、`app/services/audit_service.py`、`GET /api/v1/admin/audit-logs`。
- この2件の完了により、docs/trace/gate-r2-trace.mdのR2-5行が「未達」としていた4項目(Playwright browser E2E・CIへのE2E blocking追加・accessibility試験・audit/metric基盤)が全て解消した。

## 却下した代替案

**Gate R2a**（既存TravelPlanへの仮`POST /api/v1/travel-plans/quick`）は採用しない。正式`quick_drafts`・anonymous device token・promoteフロー・problem+jsonを迂回し、後で破棄する二重実装になるため（2026-09-07監査報告書で不採用確定済み）。

## 影響範囲

- 新規: `devices`テーブル、`quick_drafts`テーブル、`POST /v1/quick-drafts`、`POST /v1/quick-drafts/{id}/promote`。
- 変更: `idempotency_records`（列追加、`user_id` NULL許容化）。
- 変更なし: 既存`TravelPlan`/`TravelDay`/`TravelEvent`スキーマ、既存guest（`users.user_type='guest'`）経路、既存Idempotency利用箇所（`plans.py`等）の挙動。

## 次のGate

R2-1（Domain/Migration Foundation）で本ADRの`devices`・`quick_drafts`・`idempotency_records`拡張をmigrationとして実装する。DB migrationのため、内容説明とユーザー承認を得てから実行する。
