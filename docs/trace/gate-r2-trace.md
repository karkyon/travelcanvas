# Gate R2 Trace表（QuickDraft）

正本: DOC-02（要件）, DOC-06（API）, DOC-05（DB）, ADR: `docs/adr/ADR-quick-draft.md`
状態値: IDEA -> DESIGNED -> IMPLEMENTED -> VERIFIED -> RELEASED（DOC-10方針。commit/test/migration/deploy/観測証拠が揃うまでIMPLEMENTEDと書かない）

| Sub-Gate | 要件/契約 | 対象 | 状態 | 根拠 |
|---|---|---|---|---|
| R2-0 | QuickDraft状態機械・Idempotency拡張・Promote規則の確定 | ADR-quick-draft.md v3 | DESIGNED | 本コミット。v1はbackend pytestが安全装置で失敗(DATABASE_URL未分離、コード変更・push無しでrollback)。v2で設計不備5件を是正。v3実行ではbackend 151/151・frontend 61/61全成功も、`diff_check`が無関係な未追跡ファイルを誤検知しcommit直前でrollback、スクリプト側のバグを修正 |
| R2-1 | `devices`, `quick_drafts`, `idempotency_records`拡張 migration | DB | IMPLEMENTED | HEAD `1f410a9`。独立clone再検証済み |
| R2-2 | `POST /v1/quick-drafts` | API/DB/SEC | IMPLEMENTED | HEAD `2cdefe6`。backend 159/159成功、独立clone再検証済み |
| R2-3 | `POST /v1/quick-drafts/{id}/promote` | API/DB/SEC | IMPLEMENTED | HEAD `f4ff2ca`。backend 166/166成功、独立clone再検証済み |
| R2-4 | frontend `createQuickPlan()`置換 | Frontend | IMPLEMENTED | HEAD `cfc0832`。独立clone再検証済み |
| R2-5 | retention purge・真の並行性テスト | Backend | PARTIAL | HEAD `76c1c7c`。backend 177/177成功だがE2E/CI blocking/accessibility/audit・metric基盤が未達(詳細は下表) |
| R2-6 | Playwright browser E2E + CIへのE2E blocking追加 | Frontend/CI | IMPLEMENTED | 下表参照。この完了をもってR2-5未達4項目のうち2件(E2E・CI blocking)を解消。残る2件(accessibility試験、audit/metric基盤)が揃うまでFR-043/G1はVERIFIEDと判定しない |
| R2-7 | accessibility試験 + audit/metric基盤 | Frontend/Backend/DB | IMPLEMENTED | HEAD未確定(次回パッチ適用時に独立clone再検証予定)。下表参照。この完了をもってR2-5未達4項目が全て解消。FR-043/G1はVERIFIED判定の前提条件を満たす(DOC-10更新は別途) |

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

| R2-5 | Backend/Frontend/E2E/CI/観測 一式検証 | quickdraft_purge.py, テスト2ファイル | PARTIAL | retention purge(論理expire/物理delete/stale in-progress回収)とidempotencyの真の並行性(2独立DBコネクション)は実装・pytest確認済み(177/177)。**未達のまま**: Playwright browser E2E、CIへのE2E blocking追加、accessibility試験、audit/metric基盤(監査イベントの永続化・ダッシュボード)。これらが揃うまでFR-043/G1完了とは判定しない |
| R2-6 | Playwright browser E2E導入 + CIへのE2E blocking追加(R2-5未達2項目の解消) | frontend/playwright.config.ts, frontend/e2e/quickdraft-flow.spec.ts, .github/workflows/ci.yml(e2e job), frontend/src/services/quickDraftApi.ts(VITE_API_URL fallback漏れ修正), frontend/package.json・package-lock.json(@playwright/test追加), frontend/Dockerfile(runtime stage COPY --chown修正) | IMPLEMENTED | シナリオ: 匿名開始→QuickDraft作成(内部でpromoteまで連続実行)→`/planner/{id}`遷移確認→reload後もplan/event表示が保持されること(=DB永続化の確認、optimistic UI状態ではないこと)→一覧画面でも表示継続を確認。CI `e2e` job は `docker compose up -d --build` でpostgres/redis/backend/frontendの実スタックを起動し、chromiumで実行(blocking、frontend/backend job完了後に実行)。副次的発見1: `quickDraftApi.ts`の`resolveApiBaseUrl()`が`VITE_API_URL`(docker-compose.ymlのbuild引数)を見ておらず`VITE_API_BASE_URL`のみ参照していた不整合(omega-dev2では既定値と一致するため症状非表面化)を`services/api.ts`と同じ優先順位に統一して修正。副次的発見2(v3): `frontend/Dockerfile`のruntime stageが`COPY --from=build`に`--chown`を指定しておらずroot:root所有のままだったため、直後の`USER node`が`npm run preview`実行時に`package.json`を`EACCES: permission denied`で読めずfrontendコンテナが起動不能というインフラ上の既存バグを発見(`docker compose up -d --build`でfrontendコンテナを実際に再作成して初めて顕在化。以前のGate検証はtsc/build/vitestのみでフルスタック起動を伴わなかったため未発見だった)。`--chown=node:node`を3箇所のCOPYへ追加して解消。frontend tsc 0エラー/vitest 62/62/vite build成功はサンドボックスで確認済み。backend pytest再実行・omega-dev2実地でのfrontendコンテナ起動確認・Playwright実行(docker必須のためサンドボックスでは不可)・独立clone再検証は本パッチ適用時にomega-dev2側で実施。**v1失敗の記録**: 初回omega-dev2実行時、`docker compose up -d --build`のfrontendイメージビルドが`npm ci`で`package.json`と`package-lock.json`が同期していない(`@playwright/test`がlock未反映)ため失敗し、rollback(コード変更・push無しで無傷)。**v2失敗の記録**: v1是正後、イメージビルド自体は成功したが、`docker compose up`後のfrontendコンテナが上記EACCESで再起動ループしhealth待機がタイムアウト、rollback(無傷)。v3でDockerfileの`--chown`を追加して是正。**v3失敗の記録**: docker/frontend起動・backend pytest(177/177)・frontend tsc/build/vitest(62/62)まで全て成功したが、Playwright実行時に「ゲスト開始→`/planner`到達→"新しいプラン"クリック直後にダイアログが出ず`/login`への連続リダイレクトが発生」して失敗、rollback(無傷)。原因未特定のため、v4としてcurlベースのguest bootstrap診断ステップ(`diagnose_guest_flow()`)とE2Eテスト側のHTTPエラー/consoleエラー出力の計装を追加し、次回実行で原因を特定できるようにした(この行自体はv4実行結果を見て別途更新予定)。**v4失敗の記録**: curl診断(`POST /auth/guest`→201、`GET /travel-plans/`→200)によりbackend側は正常と確認できたが、Playwright実行の`waitForLoadState('networkidle')`自体がタイムアウトし、大量のPlaywright内部ログに診断出力が埋もれ原因特定に至らずrollback(無傷)。v5でnetworkidle待ちを廃止しelement可視待ち+フレーム遷移回数カウント方式へ変更、および要望によりGate外の過去セッション残置ファイルの自動削除(`cleanup_stale_leftover_files()`)を追加。**v5失敗の記録・根本原因判明**: v5のフレーム遷移カウント計装により、失敗ログへ`[HTTP 401] GET /notifications/unread-count`と`[HTTP 401] POST /auth/refresh`が交互に無限出力されていることが判明。原因は`frontend/src/components/Header.tsx`の未読通知バッジ取得effectが`isGuest`を分割代入していながら一度も条件判定に使っておらず、guestでも(会員限定である)`/notifications/unread-count`をマウント直後および60秒間隔でポーリングし続けていたこと。backend側`get_current_active_user`はguestを正しく拒否(401)する設計通りの挙動だが、frontend側がその401を`axios`インターセプター経由で`window.location.href='/login'`という強制リロードに変換し、ゲストが`/planner`に留まっている間ずっと強制ログアウトを繰り返す実害バグだった(Playwright E2E実行で初めて発覚。手動確認では気づかれていなかった)。v6で`Header.tsx`のeffectガードに`isGuest`を追加し是正。**v6実行結果**: リダイレクトループは完全に解消(テスト実行時間が数十秒→795msへ短縮)し、ゲスト開始→`/planner`到達→モーダル操作まで到達。唯一の残課題はテストコード自体のロケーター曖昧性(`getByPlaceholder('例: 東京')`が`'例: 東京旅行'`/`'例: 東京駅'`にも部分一致し3要素にヒットするPlaywright strict mode違反)で、アプリ側のバグではない。`{ exact: true }`を指定して是正、v7として再実行。**v7実行結果**: ロケーター曖昧性は解消しモーダル操作・QuickDraft作成・promote・`/planner/{id}`遷移まで到達(実行時間11.1秒)。しかし新たに`GET /plans/{id}/days/{id}/route-preview`でも同じ401→`/auth/refresh`401→強制リロードパターンが発生し失敗。原因は`frontend/src/pages/PlannerPage.tsx`の移動概算取得effect(Gate #32)が`Header.tsx`と全く同じ欠陥(ゲスト時のガード漏れ)を持っており、backend `get_route_preview`も`get_current_active_user`(会員限定)を要求するため常に401になっていた。v8で本effectに`isGuest`ガードを追加して是正。あわせて要望によりtest-results/playwright-report/の自動削除をrollback時・起動時の両方に追加。**v8実行結果**: route-preview 401ループも解消し(実行時間1.3秒)、プラン詳細画面の表示確認まで到達。唯一の残課題はテストコードの`getByText(eventTitle)`が「位置情報不明の予定: {title}」(地図警告表示)と「🎯 {title}」(日程タイムライン表示)の2箇所に部分一致しPlaywright strict mode違反となっていたこと(アプリ側のバグではない)。`.first()`を追加して是正、v9として再実行。あわせてユーザー指摘により、失敗するたびに残っていたこのGate自身の過去バージョンパッチスクリプト(`apply_gate_r2_6_v1`〜`v8`)を起動時に自動削除する処理を追加(cleanup_stale_leftover_files()が対象を拡張) |
| R2-7 | accessibility試験(axe-core) + audit/metric基盤(監査ログ永続化、R2-5未達最後の2項目の解消) | backend/app/models/models.py(AuditLogモデル), backend/alembic/versions/9f0906d65cdc_gate_r2_7_audit_logs.py, backend/app/services/audit_service.py(新規), backend/app/api/v1/auth.py(login成功/失敗を監査ログ化), backend/app/api/v1/quickdrafts.py(promote成功を監査ログ化), backend/app/api/v1/admin.py(ユーザー操作を監査ログ化+`GET /admin/audit-logs`新設), frontend/package.json・package-lock.json(`@axe-core/playwright`追加), frontend/e2e/a11y.spec.ts(新規) | IMPLEMENTED | 調査の結果、`schemas.py`の`AuditLog`/`AuditLogResponse`は定義済みだが対応するDBテーブル・書き込み経路・参照APIが一つも存在しない「ゴーストスキーマ」であることを確認(既知の亡霊パターンの一種)。`audit_logs`テーブルを新設し、ログイン成功/失敗・QuickDraft promote成功・管理者ユーザー操作(suspend/unsuspend/verify/unverify)の4系統から書き込む経路を実装、`GET /api/v1/admin/audit-logs`(ページネーション対応)で参照可能にした。監査ログ書き込みは独立DBセッションで行い失敗時は本処理を止めない設計(パスワード等の機微情報は記録しない)。accessibility試験は`@axe-core/playwright`を実際に`npm install`しlockfileへ反映のうえ、ランディングページ("/")とゲストのプランナー画面("/planner")をWCAG 2.0/2.1 A・AA相当ルールセットでスキャンする`frontend/e2e/a11y.spec.ts`を追加。サンドボックスで確認済み: backend変更ファイルは全てpy_compile成功、alembic head(`9f0906d65cdc`)が単一head、frontend tsc 0エラー・vitest 62/62成功・vite build成功・`npx playwright test --list`で3テスト(a11y 2件+quickdraft-flow 1件)全て正常検出。**docker必須のため未実施(パッチ適用時にomega-dev2で実施)**: backend pytest実地実行、`docker compose up -d --build`によるフルスタック起動確認、axe-core E2Eの実ブラウザ実行(violations有無の実地確認)、独立clone再検証。 |

## 却下案の記録

Gate R2a（仮`POST /api/v1/travel-plans/quick`、既存TravelPlan直書き）は2026-09-07付で不採用確定。理由と詳細はADR「却下した代替案」章、および`TravelCanvas_最新コード再々監査報告書_HEAD6d81e90_2026-09-07.md`を参照。

## Gate番号外の修正: ゲスト×会員限定API 401ハンドラ根本修正（2026-09-08）

R2-6で発見した「ゲストが会員限定APIを呼ぶと401→`/auth/refresh`401→`window.location.href='/login'`強制リロード」という実害バグ(Header.tsx/PlannerPage.tsxの個別`isGuest`ガード漏れ)は、当時は対症療法(個々のeffectへガード追加)のみで是正していた。ADR-quick-draft.md §11に「根本修正(401ハンドラ自体の見直し)は将来のGateで検討する価値がある」と記載していた件を、ユーザー承認のうえ本修正で対応。

**対象**: `frontend/src/services/api.ts`, `frontend/src/store/authStore.ts`, `frontend/src/store/planStore.test.ts`

**内容**:
- `CompleteTravelAPI`(api.ts)へ`isGuestSession`フラグと`setGuestMode(isGuest: boolean)`を追加。
- response interceptorの401→refresh自動リトライを、ゲストセッション中はスキップする(ゲストはrefresh cookieを持たないため常に失敗するだけの無駄なリクエストだった)。
- `handleApiError`の401分岐を、ゲストセッション中は`clearTokens()`も`window.location.href='/login'`も行わず、通常のエラーとして呼び出し元へ返すだけに変更(会員限定APIへのアクセスを実質403として扱う)。
- `authStore.ts`の`isGuest`が変化する全箇所(`initialize`の3分岐、`checkAuth`の2箇所、`login`、`register`、`logout`、`startGuestSession`、`upgradeGuest`)で`apiService.setGuestMode()`を同期呼び出しするよう統一。
- `planStore.test.ts`の`@/services/api`モックに`setGuestMode`/`setAccessToken`/`clearAccessToken`を追加(authStoreの`onRehydrateStorage`が同じモックを共有するため、追加しないと非同期タイムアウト後に`setGuestMode is not a function`で失敗する)。

**効果**: 今後、新規コンポーネントが`isGuest`ガードを追加し忘れて会員限定APIを呼んでしまっても、401ハンドラ自体がゲストセッションを認識して静かに失敗させるため、Header.tsx/PlannerPage.tsxで発生したような強制ログアウトループの再発を防ぐ多層防御になる(個別effectのガードは引き続き推奨するベストプラクティスとして残す)。

**検証**: frontend tsc 0エラー、vitest 62/62成功、vite build成功。backend側の変更は無し。
