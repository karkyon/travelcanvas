# Claude向け TravelCanvas Gate #27以降 監査是正・連続実装指示

以下をClaude Codeへそのまま渡すこと。

---

あなたは `karkyon/travelcanvas` の継続開発担当です。まずGitHubの最新`main`を自分でcloneし、ユーザーへgrepやファイル抽出を依頼せず、コード・履歴・仕様資料を自分で調査してください。

## 0. 最初に読む正本

1. `TravelCanvas_最新コード_仕様適合性_進捗監査レポート_2026-09-03.md`
2. `10_全機能仕様_トレーサビリティ_実装状況台帳_v4.0.md`
3. `02_要件定義書_v4.0.md`
4. `03_基本設計書_システム構成_v4.0.md`
5. `05_DB設計書_v4.0.md`
6. `06_API設計書_v4.0.md`
7. `11_セキュリティ_プライバシー_データ保護詳細仕様_v4.0.md`
8. `14_MAP中核機能_詳細仕様_v4.1.md`
9. `TravelCanvas_Gate26継続_ハンドオフ資料_2026-09-03.md`

仕様間に衝突があれば、v4.0/v4.1の正本と監査レポートを優先し、勝手に意味を縮小しないこと。HANDOFFの「完了」は参考情報であり、コードと試験証拠で再判定すること。

## 1. 基準点の固定

開始時に必ず次を実行・記録する。

```bash
git clone https://github.com/karkyon/travelcanvas.git
cd travelcanvas
git rev-parse HEAD
git status --short
git log -10 --oneline
```

監査時HEADは `e01e2daa0a0ad1a1c51848e4d6cb5236d833d168`。これより進んでいる場合は最新差分を読み、監査指摘が既に直っているか確認してから計画を更新する。古いHEADへ戻してはならない。

## 2. 絶対原則

- APIキーが必要な実サービス試験は後回しでよい。ただし、adapter、schema、fixture、権限、失敗時挙動、キー注入設計は先に実装する。
- ファイル、class、route、buttonが存在するだけで完成扱いしない。
- 完成条件は `UI → API → DB → reload` に加え、他user拒否、失敗系、競合、migration up/down/up、自動テストまで通ること。
- mock/random/fake successを本番経路で黙って返さない。fixtureはtest/dev限定かつ画面に明示する。
- 新規APIはtyped Pydantic schemaを使用し、`dict = Body(...)`を増やさない。
- 新規DBは仕様の正規モデルに従う。`TravelPlan.itinerary`巨大JSONへ新しい概念を追加し続けない。
- 金額はFloatを増やさず、Decimal/minor unit＋ISO currencyを採用する。
- 共有・閲覧・編集はownerだけのチェックで済ませず、canonical policyでrole×resource×fieldを評価する。
- 最適化適用、並替、更新はbase revision/ETag/idempotencyを持つ。無条件上書きを増やさない。
- マイグレーションは意図した差分だけを確認し、既存データ移行とrollbackを設計する。
- 1 Gate 1目的を維持しつつ、検証が通る範囲で複数Gateを連続して進めてよい。
- 各Gate後にGitHubを再取得し、pushされたHEADと変更内容を自分で確認する。

## 3. 着手前の再現テスト

```bash
cd frontend
npm ci
npm run type-check
npm run build
npm run lint
npm test -- --run
```

期待値は、type-check/build成功、lint失敗（監査時175 errors/17 warnings）、test失敗（13 passed/11 failed）である。差があれば記録する。

backendは専用venvと一時PostgreSQLを用意し、少なくとも以下を実行する。

```bash
python -m alembic upgrade head
python -m alembic downgrade -1
python -m alembic upgrade head
python -c "from app.main import app; print(app.title)"
```

既存データを含むユーザー環境で破壊的操作をしない。試験DBだけを使う。

## 4. Gate #27 — 品質基準と偽完成の是正

### 必須作業

1. 監査レポートを`docs/audit/`へ格納し、`10_全機能仕様...台帳`へ実HEADの状態を反映する。
2. frontendのButton testを現実装の仕様に合わせて修正するか、実装側の回帰ならButtonを修正し、24/24を通す。非同期例外を残さない。
3. `npm run lint`の175 errorsを分類し、最低限「実行コード」のerrorを0にする。生成/legacy/dead codeは削除または明示除外し、無差別なeslint disableは禁止。
4. CIへ`npm run type-check`と`npm test -- --run`をblockingで追加する。
5. backendへpytest基盤を追加し、auth/plan/spot/share/notification/optimizationの最小縦切りを実PostgreSQLで試験する。
6. `/spots/categories/list`, `/spots/test/ping`, `/travel-plans/test/ping`の固定path順序を直し、422にならないroute testを追加する。
7. frontendにだけ存在する以下のAPIを「実装するかUI/clientから外すか」決め、偽導線をゼロにする。
   - `/settings/notifications`
   - `/settings/privacy`
   - `/auth/delete-account`
   - `/account/export`
8. `/optimization`の固定「開発中」画面を、プラン選択へ誘導する実画面または安全なredirectにする。

### Gate #27完了条件

- type-check/build/lint/testがすべて成功。
- backend pytestがCIでblocking。
- OpenAPI routesとfrontend clientの不存在endpoint差分が0。
- テスト件数・成功件数・commit SHAを報告。

## 5. Gate #28 — 認証・セッション安全化

### 実装範囲

- refresh token rotationとreuse検知
- logout、logout-all、session/device一覧、指定session失効
- password変更後の他session失効（利用者選択または仕様既定）
- login/register/password resetへのrate limit
- email verify、forgot/resetのtoken lifecycle。実メール送信はoutbox/fixtureまででよい
- account delete/exportの安全なworkflow土台
- frontend token保存方式を再設計。少なくともrefresh tokenをlocalStorageへ置かない
- error responseから内部例外文字列を除去し、request IDで追跡

### 試験

- refresh単回使用、reuse時family revoke
- logout後拒否、logout-all後全session拒否
- inactive user拒否
- password変更後の旧token挙動
- 他userのsession ID失効拒否
- rate limit正常/境界

## 6. Gate #29 — Plan/Day/Event正規化

API設計書のcanonical `/plans`を正本とする。既存`/travel-plans`は即削除せず、移行期間・deprecationを設計する。

### DB

- `travel_days`
- `travel_events`
- `event_links`
- `plan_versions`
- `change_sets`
- `change_items`
- plan revision

### 必須事項

- 既存`itinerary JSON`から正規テーブルへのbackfill
- dual-writeを長期化させず、read正本を明確化
- ETag/If-Matchまたは同等revision guard
- Idempotency-Key
- reorder、cross-day move、edit/delete、Undo
- timezoneはUTC＋IANA＋local表示情報
- migration up/down/upと既存fixture移行試験

## 7. Gate #30 — 共有・招待・権限を実際に成立させる

現状のGate #25はowner用設定CRUDまでであり、共有機能は完成していない。最優先で次を実装する。

### 共有リンク

- tokenはDBへ平文保存しない（hash＋必要なprefix等）
- resolve endpointと公開閲覧画面
- expires/revoked/max-use/passcode/field policy
- URL/Referer/logへtokenを残さない
- ownerが即時失効可能
- `/share/{token}`と`/share/:planId`の衝突を解消し、管理画面と公開画面を別routeにする

### 招待・member

- invite token、accept/decline、対象account確認
- pending collaboratorを正式memberへ遷移
- owner/editor/viewer（将来voter）をcanonical policyで判定
- collaboratorが許可されたplanをlist/read/editできる
- owner移譲は別Gateでもよいがschemaを阻害しない
- SMTP実配送は保留可。outbox行とtest transportで状態遷移を検証

### Security tests

- 他user IDOR
- viewer write拒否
- editorのmember/security変更拒否
- expired/revoked/exhausted token拒否
- response/DOM/cacheから秘密field除外
- collaborator削除直後のaccess拒否

## 8. Gate #31 — Candidate/Place/Search正規化

- `candidates`, `places`, `source_records`, `field_sources`, `opening_hours`の最小正規モデル
- frontend直アクセスの検索providerをbackend adapterへ集約
- source URL/provider/retrieved_at/freshness/stateを保持
- mock/random fallbackを本番で禁止
- duplicate候補は自動削除せず比較提示
- search結果→candidate→eventの遷移とsource継承
- APIキーなしfixtureでcontract/integration test

## 9. Gate #32〜#33 — MAP/移動/検証/最適化

### Gate #32

- `MapView`をPlannerへ実接続
- provider非依存adapter
- PLAN MAPの候補・日程・route layer
- map→candidate、candidate→day slot、day間移動
- segment/route option/constraint/validation models
- APIキーなしfixture route provider

### Gate #33

- 最近傍だけを「AI最適化」と呼ばない。名称を正確化する
- hard constraints（予約、営業時間、lock、最終交通、buffer）
- base revision、solver/algorithm version、seed、weights、input snapshot
- before/after diff、理由、警告、apply、Undo
- apply直前にrevision不一致なら409で拒否
- 正常系だけでなく「最適解なし」「provider stale」「途中共同編集」を試験

## 10. 以降の順序

1. G34 予約正規化・secret reveal
2. G35 文書取込・OCR review・ticket/QR
3. G36 NOW/NEXT・Today
4. G37 通知イベント・設定・秘匿
5. G38 alert/impact/safe replan
6. G39 encrypted offline pack/sync/conflict
7. G40 しおり/PDF/packing/readiness
8. G41 Decimal money/expense/settlement
9. G42+ What-if、合意、旅行記、位置、B2B、public API

## 11. パッチ納品方式

ユーザー環境で1コマンド実行できるPythonパッチ方式を継続する場合、Gate #26 HANDOFFの安全パターンを踏襲する。

- EXPECTED_HEAD一致
- tracked worktree clean確認（ユーザー変更を消さない）
- 既存ファイルpreimage SHA-256、新規file collision確認
- 一時コピーへ適用して全検証
- migration差分目視＋up/down/up
- 全成功後のみcommit/push
- 失敗時完全rollback
- 成功後パッチ自身削除

ただし、パッチの成功は製品機能の成功ではない。必ず実際のroute/UI/DB/権限試験を完了条件にする。

## 12. 各Gateの報告書式

```markdown
## Gate #N 結果
- Before HEAD:
- After HEAD:
- Feature IDs:
- 変更ファイル:
- Migration:
- API契約:
- UI導線:
- 正常系試験:
- 失敗系試験:
- 権限試験:
- type-check/build/lint/test:
- APIキー依存で保留した項目:
- 既知の制約:
- 次Gate:
```

「実装済み」「E2E完了」と書く場合は、具体的なtest ID、結果、DB反映、reload、他user拒否の証拠を同じ報告に載せること。証拠がなければ`SCAFFOLDED`または`IMPLEMENTED候補`と表現する。

## 13. 今すぐ開始する作業

まずGate #27を完遂する。APIキーの提供を待って停止してはならない。Gate #27が全てgreenになったらGate #28へ進み、同一セッションで安全に進められる限りGate #30まで連続実装する。各Gateごとにcommitを分け、後戻り可能にする。

---

