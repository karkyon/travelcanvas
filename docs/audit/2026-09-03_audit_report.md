# TravelCanvas 最新コード・仕様適合性・進捗監査レポート

**監査日:** 2026-09-03  
**対象リポジトリ:** `karkyon/travelcanvas`  
**監査基準HEAD:** `e01e2daa0a0ad1a1c51848e4d6cb5236d833d168`（Gate #26）  
**仕様正本:** v4.0文書群、MAP詳細仕様 v4.1、会話履歴、Gate #7/#22/#26 HANDOFF  
**注記:** APIキーが必要なGoogle Maps、OpenAI、Google Vision等の実サービス試験は今回の合否判定から分離した。

## 1. 結論

**設計した最終仕様どおりに完全開発されている状態ではない。** 現在のコードは、登録ユーザー向けの旅行プランCRUD、JSON旅程編集、スポットCRUD・お気に入り・訪問済み、簡易検索、単純な距離順最適化、所有者用共有設定、最小通知、基本管理画面までを持つ「基礎MVP」である。一方、v4.0が定義する「旅の実行OS」の中核である、予約・チケット・文書一元化、MAP中心操作、実交通を使う制約検証、説明可能最適化、共同編集・合意、当日再計画、安全なオフライン、しおり/PDF、データ保護・監査は大半が未実装である。

| 評価軸 | 判定 | 概算完成度 | 根拠 |
|---|---:|---:|---|
| 現在の基礎MVP（認証・プラン・スポット中心） | 部分成立 | 60〜70% | build/type-check成功。主要CRUDは存在。ただしテスト、共有、検索、セキュリティに重大不足 |
| v4.0最終機能仕様（FR-001〜042） | 大幅未達 | **約12%** | 42親機能中、完全VERIFIEDは0。部分実装が約13、残りは仕様のみまたは断片 |
| MAP中核仕様 v4.1 | 未達 | **約5%** | `MapView.tsx`は存在するが実画面から未接続。5モード、同期、挿入計算なし |
| セキュリティ・プライバシー仕様 | 重大未達 | **約15%** | 基本JWT・所有者チェックはあるが、session rotation、field ACL、監査、暗号化、削除、共有token保護なし |
| 品質保証・リリース準備 | 未達 | **約10%** | 型・buildは成功。一方lint 175 errors、テスト11/24失敗、backend自動テスト不在、E2E/運用証拠なし |

> 完成度はコード量ではなく、仕様→DB→API→UI→正常/異常系試験→権限/運用証拠の縦切り成立度で判定した。APIキー待ちだけを理由に未達とした項目はない。

## 2. 監査で確認した事実

| 項目 | 結果 |
|---|---|
| Git履歴 | 43 commits。2026-08-31以降にGate #6〜#26を短期間で連続実装 |
| 管理対象ファイル | 190 files |
| DBモデル | 11 tables相当（User、Session、Travel、TravelPlan、ShareLink、Collaborator、Notification、OptimizationResult、Spot、Favorite、Visit） |
| Alembic | 4 revisions（UUID baseline、visit、share/collaborator、notification） |
| 実API | 約40 route decorators。仕様APIの大半は不存在 |
| Frontend type-check | `npm run type-check` 成功（0件） |
| Frontend production build | `npm run build` 成功（1765 modules） |
| Frontend lint | **失敗: 175 errors / 17 warnings** |
| Frontend tests | **失敗: 13 passed / 11 failed / 24 total、非同期例外1件** |
| Backend tests | `backend/tests`自体が不存在。CIはimport smokeのみ |
| Backend独立実行 | 依存導入を環境制約で完遂できず未実施。HANDOFF記載の実PostgreSQL試験は履歴資料として扱い、今回の独立再現証拠とはしていない |
| CI | frontendはVite buildのみblocking。lintはcontinue-on-error。backendはimportのみ。pytest/E2E/security/migration testなし |

## 3. 最重要の逸脱・違反・過大評価

| ID | 重大度 | 発見事項 | 仕様との不一致・影響 | 根拠 |
|---|---|---|---|---|
| A-001 | Critical | 共有リンクに閲覧実体がない | tokenでプランを取得する公開API/画面がなく、生成URL `/share/{token}` は実routerの `/share/:planId` に入り、認証と所有者用管理画面を要求する。共有機能として成立しない | `share.py`, `router/index.tsx`, `SharePage.tsx` |
| A-002 | Critical | collaboratorが権限として使われない | 招待はpending DB行を作るだけ。受諾APIなし。TravelPlan CRUDはownerのみで、viewer/editorは閲覧・編集不能。共同編集ではない | `travel.py`, `share.py`, `PlanCollaborator` |
| A-003 | Critical | 最適化が仕様の説明可能・制約付き最適化ではない | 最近傍法＋大圏距離＋固定25km/hのみ。営業時間、予約時刻、交通、ロック、参加者、予算、base revision、diff/Undoなし | `ai.py`, FR-014〜018, MAP v4.1 |
| A-004 | Critical | MAP中核が画面に接続されていない | APIキー以前に`MapView`のconsumerがない。PLAN/OPTIMIZE/LIVE/TRACK/MEMORYの5モードや地図→候補→日程挿入が不存在 | `MapView.tsx`とimport検索 |
| A-005 | High | API正本から逸脱 | 仕様は`/plans`、実装は`/travel-plans`。共通response/error/header、Idempotency-Key、ETag/If-Matchも未実装 | API設計 v4.0、`travel.py`, `api.ts` |
| A-006 | High | DB正本から大幅逸脱 | 仕様テーブル群の大半が不存在。日・event・予約等を巨大`itinerary JSON`へ格納し、「巨大JSONにしない」設計判断に反する | DB設計 v4.0、基本設計 1.3、`models.py` |
| A-007 | High | 金額型違反 | 仕様はDecimal/minor unit＋ISO currency。実装は`Float`でbudget/costを保持し通貨列がない | `models.py`, `travel_plan.py` |
| A-008 | High | 認証・session仕様未達 | access tokenをlocalStorageへ保存。refresh/logout/logout-all/device/session/MFA/email verify/reset/lockなし。password変更後の他session失効なし | `auth.py`, `authStore.ts`, API/SEC仕様 |
| A-009 | High | 未実装APIをfrontendが公開 | notification settings、privacy settings、delete account、export dataのclient methodはあるがbackend routeなし。呼べば404 | `api.ts` lines 1187〜1295、backend routes |
| A-010 | High | テスト状態をHANDOFFが反映していない | HANDOFFは「E2Eで動作」と総括するが、repoの自動テストはButton 1ファイルのみで11失敗。backend testなし | `Button.test.tsx`, CI, 実行結果 |
| A-011 | High | 固定pathの定義順バグが残る | `/spots/categories/list`と`/spots/test/ping`が`/{spot_id}`より後、`/travel-plans/test/ping`が`/{plan_id}`より後。UUID変換422となる可能性が高い | `spots.py`, `travel.py` |
| A-012 | High | 検索が正規backend/provenanceに統合されない | frontendからWikipedia/Nominatim/Overpassへ直接アクセスし、障害時はmock生成。結果に正規source/freshness/conflict/auditがない | `webSearchService.ts`, `api.ts` |
| A-013 | High | 本番で偽データを返し得る | 検索・画像・音声・旧optimization serviceにmock fallback/random値が大量残存。利用者にmockであることを強制表示する保証なし | `webSearchService.ts`, `ai_search.py`, `image_recognition.py`, `optimization.py` |
| A-014 | High | 権限基盤が死コード | `permissions.py`はAPIから未使用でTODOも残る。各APIがowner判定を個別実装し、role×field ACLが存在しない | import検索、`permissions.py` |
| A-015 | High | 楽観ロック・変更履歴・Undoがない | 同時編集と最適化適用がlast-write-wins。optimization applyは現在itineraryを無条件上書きする | `ai.py`, `travel.py`, FC-013/058/063 |
| A-016 | Medium | DnD完成表現が過大 | 同日基本操作はあるが、日跨ぎAPI、snap、keyboard移動がTODO | `useDragDrop.tsx` |
| A-017 | Medium | PWA/offlineは殻 | manifest/SW/Storage queue断片はあるが、暗号化pack、権限失効、同期、競合解決なし | public SW群、`Storage.ts` |
| A-018 | Medium | 重複・亡霊資産が残る | `Travel`と`TravelPlan`、複数schema、`.2`設定ファイル、`frontend/src/package.json`、旧services/componentsが混在 | repository tree |
| A-019 | Medium | 管理画面は「管理・監査」仕様の一部だけ | 統計・user active切替のみ。support grant、mask、audit/security events、目的・期限付き操作なし | `admin.py`, FR-040/FC-096 |
| A-020 | Medium | 運用仕様未証明 | backup scriptはあるがrestore試験、SLO、metrics/alert/runbook、DR、容量・負荷試験なし | scripts, CI, NFR |

## 4. 機能別進捗・実装状況（FR-001〜042）

状態は `SPECIFIED / SCAFFOLDED / IMPLEMENTED / INTEGRATED / VERIFIED` を使用する。**VERIFIEDは0件**である。

| FR | 機能 | 現状 | 完成度 | 実装根拠 | 主な不足・逸脱 | 次Gate |
|---|---|---|---:|---|---|---|
| FR-001 | ゲスト旅行開始 | SCAFFOLDED | 5% | guest enum/token helper断片 | `/auth/guest`、guest DB、UI、回復E2Eなし | G27 |
| FR-002 | ゲスト昇格 | SPECIFIED | 0% | schema/helper断片のみ | upgrade API、所有権移行、token失効なし | G27 |
| FR-003 | 認証・セッション | IMPLEMENTED | 45% | register/login/me/password、JWT | refresh/logout/session/device/MFA/verify/reset/lockなし、localStorage token | G28 |
| FR-004 | 旅行プランCRUD | INTEGRATED候補 | 65% | CRUD API＋Planner UI＋DB | `/plans`契約不一致、soft delete/restore/revisionなし | G29 |
| FR-005 | 日程・イベント管理 | IMPLEMENTED | 40% | itinerary JSON、DayView、保存 | 正規days/events API/DB、一括、依存、複数日、Undoなし | G29 |
| FR-006 | NOW/NEXT | SCAFFOLDED | 12% | DayViewの次event表示断片 | timezone/query model/offline/current tripなし | G36 |
| FR-007 | 候補箱 | SCAFFOLDED | 20% | search→planner追加、お気に入り | candidate/source DB、優先度、統合、提案理由なし | G31 |
| FR-008 | 場所一元管理 | IMPLEMENTED | 25% | Spot CRUD、座標、画像URL | entrance/hours/source/freshness/verify/ACLなし | G31 |
| FR-009 | 横断検索 | IMPLEMENTED候補 | 18% | frontend web search | backend統合、情報ハブ検索、provenance、command paletteなし | G31 |
| FR-010 | 予約管理 | SCAFFOLDED | 5% | itinerary中の任意JSONに格納可能 | reservation model/API/UI/secret revealなし | G34 |
| FR-011 | 予約取込 | SPECIFIED | 0% | service名・schema断片 | upload/import/extract/review/jobなし | G35 |
| FR-012 | QR・チケット | SPECIFIED | 0% | 仕様のみ | DB/API/UI/offline/field ACLなし | G35 |
| FR-013 | 文書ウォレット | SPECIFIED | 0% | upload volumeのみ | document/object scan/version/linkなし | G35 |
| FR-014 | 移動区間 | SCAFFOLDED | 8% | event座標間距離計算 | segment/leg/transport/provider/bufferなし | G32 |
| FR-015 | 経路比較 | SPECIFIED | 0% | なし | compare API/route candidatesなし | G32 |
| FR-016 | 制約 | SCAFFOLDED | 5% | optimization request型の一部 | constraint DB/UI/evaluatorなし | G32 |
| FR-017 | 実行可能性 | SPECIFIED | 0% | なし | validation run/issues、hard constraintなし | G32 |
| FR-018 | 説明可能最適化 | IMPLEMENTED候補 | 25% | nearest-neighbor、結果保存/apply | 実交通/制約/revision/diff/Undo/reproduce/fairnessなし | G33 |
| FR-019 | What-if | SPECIFIED | 0% | なし | branch/compare/applyなし | G42+
| FR-020 | 共同編集 | SCAFFOLDED | 3% | collaborator DB行のみ | access、accept、edit、presence、revision、WebSocketなし | G30 |
| FR-021 | 共有・権限 | IMPLEMENTED候補 | 18% | owner用link CRUD/invite CRUD | token閲覧不能、passcode/回数/field policy/auditなし | G30 |
| FR-022 | 合意形成 | SPECIFIED | 0% | なし | vote/concern/consensusなし | G42+
| FR-023 | 秘匿制約 | SPECIFIED | 0% | なし | private constraint/aggregate privacyなし | G42+
| FR-024 | コメント・通知 | IMPLEMENTED候補 | 12% | invite通知、list/read | commentなし、イベント拡張/設定/配送/秘匿なし | G37 |
| FR-025 | 持ち物 | SPECIFIED | 0% | なし | packing model/API/UIなし | G40 |
| FR-026 | レディネス | SPECIFIED | 0% | なし | task/owner/due/read modelなし | G40 |
| FR-027 | 予算・費用 | SCAFFOLDED | 7% | plan.budget/event.cost断片 | Float、通貨/expense/version/receiptなし | G41 |
| FR-028 | 立替・精算 | SPECIFIED | 0% | なし | share/settlement/refundなし | G42+
| FR-029 | 当日モード | SCAFFOLDED | 7% | next event UI断片 | execution projection、delay、checklist、secure revealなし | G36 |
| FR-030 | 外部状況 | SPECIFIED | 0% | なし | weather/transport/closure alertなし | G38 |
| FR-031 | 安全な再計画 | SPECIFIED | 0% | なし | impact/diff/approval/replanなし | G38 |
| FR-032 | Offline Pack | SCAFFOLDED | 5% | PWA/SW断片 | pack生成・暗号化・選択・失効なし | G39 |
| FR-033 | Offline同期 | SCAFFOLDED | 3% | local queue class断片 | server sync/idempotency/conflict/tombstoneなし | G39 |
| FR-034 | しおり生成 | SPECIFIED | 0% | なし | theme/editor/exportなし | G40 |
| FR-035 | 安全な印刷・公開 | SPECIFIED | 0% | なし | PDF/field policy/leak scan/revokeなし | G40 |
| FR-036 | Calendar/Map IO | SCAFFOLDED | 3% | orphan MapView | ICS/KML/GPX/import/exportなし | G42+
| FR-037 | 写真・旅行記 | SPECIFIED | 0% | Spot画像URLのみ | media/memory/consent/redactionなし | G42+
| FR-038 | 位置軌跡 | SPECIFIED | 0% | browser geolocation utility | opt-in track/share/retention/exportなし | G42+
| FR-039 | 輸出・削除 | SCAFFOLDED | 2% | frontend client methodのみ | backend、manifest、全派生削除、証拠なし | G28/G42+
| FR-040 | 管理・監査 | IMPLEMENTED候補 | 15% | stats/users/suspend＋admin UI | audit/security events、support session、mask、scopeなし | G42+
| FR-041 | 組織・B2B | SPECIFIED | 0% | なし | tenant/org/template/policyなし | G42+
| FR-042 | API・埋込 | SPECIFIED | 0% | internal APIのみ | client scopes/webhook/public API/versioningなし | G42+

## 5. Gate #6〜#26の再評価

| Gate群 | 実際に達成したこと | 再評価 | 注意 |
|---|---|---|---|
| #6〜#10 | CRUD基盤、型エラー解消、環境URL、bcrypt、token接続 | 有効な基盤改善 | 型0件は機能完成を意味しない |
| #11〜#18 | Planner/spot/検索追加導線・編集削除 | 部分実装として有効 | 日程はJSON一括保存、DnDや正規event APIは未完成 |
| #19〜#22 | visit、preferences、password、検索設定 | 有効な縦切り | password変更後session失効等は仕様未達 |
| #23 | 距離順最適化 | **名称が過大** | 「AI最適化」「説明可能最適化」ではなく簡易heuristic |
| #24 | 基本admin | 部分実装 | FR-040の管理・監査完成ではない |
| #25 | share管理データ | **機能成立の主経路が欠落** | link消費・collaborator accessがないため共有完了ではない |
| #26 | invite通知/read | 部分実装 | 通知センター全体・通知設定・配送ではない |

## 6. コード・設計整合性の詳細

### 6.1 DB

- `Travel`と`TravelPlan`が併存し、OptimizationResultのFKは`travels`だが、実最適化対象は`travel_plans`。そのため`travel_id=NULL`にしてJSONへ`plan_id`を埋める回避実装になっている。
- `TravelPlan.itinerary JSON`へdays/eventsを一括保存しており、正規化、参照整合性、変更履歴、部分権限、並行編集、検索投影が成立しない。
- favorite/visitにDBレベルの複合unique constraintがなく、APIチェックだけでは競合時重複を防げない。
- share tokenは平文保存であり、ハッシュ保存、使用回数、passcode、revoked_at、last_access等がない。

### 6.2 API

- 仕様の共通envelopeと実装の生JSONが混在し、frontendがメソッドごとに手動wrapperを作っている。
- Pydantic schemaを使わず`dict = Body(...)`で受ける新規APIが多く、OpenAPI契約・validationが弱い。
- `/health`はprefix外、その他は`/api/v1`で、API設計書のcanonical pathとの対応台帳が更新されていない。
- rate limiter、permissions、rich service群は存在してもrouterから未利用のものが多い。

### 6.3 Frontend

- production build/type-checkは成功しており、Gate #7の成果は確認できた。
- ただしlint 192 problems、唯一のcomponent testが11失敗。CIがlintを意図的に非blockingにしている。
- `MapView`, `ImageSearch`, `VoiceSearch`, `SpotSearch`等の孤立/重複が残る。
- `/optimization` indexは「開発中」。ProfilePageは284 bytesの薄い実装。
- API tokenをlocalStorageに保持し、XSS時の窃取リスクが仕様のsession/cookie方針と不整合。

### 6.4 セキュリティ

- positive: secretsのconfig default必須化、bcrypt hash、ownerチェック、admin API server-side guardは存在。
- negative: login rate limit未接続、audit log未接続、refresh familyなし、session失効なし、共有field ACLなし、機密分類/暗号化/revealなし、privacy/export/deleteなし。
- exceptionで`str(e)`をclientへ返す箇所があり、内部情報漏洩の可能性がある。
- CORS defaultやDEBUG defaultが開発値で、production設定検証がない。

## 7. 推奨する次の実装順（APIキー不要を優先）

| 順位 | Gate | 目的 | 完了条件 |
|---:|---|---|---|
| 1 | G27 | 監査基準固定と偽完成の是正 | 本レポートをrepo docsへ反映、Feature ID台帳更新、CI testをblocking化、既知404/422解消 |
| 2 | G28 | 認証/session安全化 | refresh rotation、logout/all、session一覧/失効、password変更時失効、rate limit、token保管方針 |
| 3 | G29 | Plan/Day/Event正規化 | canonical `/plans`、days/events tables/API、revision/ETag、idempotency、JSON移行・rollback |
| 4 | G30 | 共有を本当に成立させる | token resolve画面/API、期限・失効・hash、invite accept、member role、owner/editor/viewer権限試験 |
| 5 | G31 | 候補・Place・検索正規化 | candidate/place/source model、backend provider adapter、mock明示禁止、重複・freshness |
| 6 | G32 | MAPと移動・検証の土台 | APIキーなしでもOpenStreetMap等を決めず、map adapter、segment/constraint/validation、地図UI接続 |
| 7 | G33 | 最適化の再設計 | base revision、lock、route/constraint corpus、diff、apply/undo、再現情報 |
| 8 | G34〜35 | 予約・チケット・文書 | reservation正規DB、secret field、upload scan、OCR review、QR offline |
| 9 | G36〜39 | 当日・alert・replan・offline | NOW/NEXT query、stale表示、safe replan、encrypted pack、two-device conflict |
| 10 | G40〜41 | しおり/PDF・準備・費用 | field policy付き出力、packing/readiness、Decimal money/expense |

## 8. APIキー依存で後回しにしてよいもの

| 項目 | 今回後回し可 | ただし今できること |
|---|---|---|
| Google Maps表示 | 可 | Map adapter、UI接続、fake provider、contract test、キー注入設計 |
| Google Places/Routes実データ | 可 | provider interface、cache/source/freshness、fixture contract |
| OpenAI自然文検索 | 可 | prompt境界、redaction、schema、fixture、manual fallback |
| Vision/OCR | 可 | upload、MIME/malware、review workflow、保持・consent |
| SMTP/email | 可 | invite token/accept、outbox、template、status。実配送だけ保留 |

**後回し不可:** 共有tokenの消費経路、role enforcement、revision、schema migration、テスト、mockの明示、秘密値設計。これらはAPIキー不要であり、中核品質に直結する。

## 9. 最終判定

現状は「完全実装」でも「v4.0のG0〜G2完了」でもない。**G0基礎縦切りの途中に、将来機能の薄い断片が横並びで追加された状態**と判定する。Gate #6〜#26の個々の修正には有効なものが多いが、Gate番号とコミットメッセージが製品仕様上の完成を示すかのように扱われ、トレーサビリティ台帳の厳格な`VERIFIED`条件が運用されていない。

次工程では新機能を横に増やすより先に、G27〜G30で「実際に使える縦切り」「権限」「契約」「自動試験」を確立する必要がある。その後、TravelCanvas固有価値であるMAP→候補→日程→移動→検証→説明付き最適化へ進むのが最短である。

## 10. 監査対象資料

- `AI旅行プランナーアプリ開発_会話履歴.txt`
- `README_資料体系_読解ガイド_v4.0.md`
- `01_企画書_プロダクトビジョン書_v4.0.md`
- `02_要件定義書_v4.0.md`
- `03_基本設計書_システム構成_v4.0.md`
- `04_外部機能仕様書_画面仕様_v4.0.md`
- `05_DB設計書_v4.0.md`
- `06_API設計書_v4.0.md`
- `07_開発環境_運用環境仕様書_v4.0.md`
- `08_開発スタック定義書_v4.0.md`
- `10_全機能仕様_トレーサビリティ_実装状況台帳_v4.0.md`
- `11_セキュリティ_プライバシー_データ保護詳細仕様_v4.0.md`
- `13_用語集_データ辞書_イベントカタログ_v4.0.md`
- `14_MAP中核機能_詳細仕様_v4.1.md`
- `DOC04-A_超精密ワイヤーフレーム_v4.0.html`
- `DOC04-A_MAP中心_超精密ワイヤーフレーム_v4.1.html`
- Gate #7/#22/#26 HANDOFF

