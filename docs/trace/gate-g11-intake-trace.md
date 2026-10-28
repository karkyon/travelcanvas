# Gate G11-Intake トレース(G11 の段階5: 行き先が未定の旅行相談)

対象: `docs/ux/G11_UIUX全範囲_実装仕様.md` §2.5・§3.5、UIX-M15〜M19・UIX-M11、2026-10-29 の統合ハンドオフ §3・§4(範囲 B)。
migration なし。設定を1つ足した(`TRIP_INTENT_GEOCODER`)。DOC-10 の状態は変えない(FR-044・FR-004・FR-007 を使う入口の追加)。
決定は `docs/adr/ADR-trip-intake.md`。

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。試験: BE = `backend/tests/test_gate_g11_intake.py`、
FE = `frontend/src/pages/consult/Consult.test.tsx`、E2E = `frontend/e2e/gate-g11-intake.spec.ts`。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 入口: 行き先が未定の相談と、Quick Plan(旅行を作る)の両方 | IMPLEMENTED | `pages/DashboardPage.tsx`・`PlannerPage.tsx`・`router/index.tsx`、E2E |
| 2 | 希望を伝える: 自由文・基本の項目(用途の説明)・任意の開閉・要約の追従・「まだ旅行も予約も作りません」 | IMPLEMENTED | `pages/consult/TripConsultPage.tsx`、FE、E2E |
| 3 | 文章の読み取り(決まった規則)。行ごとの出典(あなたの入力/文章から読み取り · 未確認/未指定)・文章の該当。AI 未接続と明示 | IMPLEMENTED | `services/trip_intent.py`、`api/v1/trip_intents.py`、BE `test_extract_*`、FE、E2E |
| 4 | 確かめた行だけを条件に使う。片道の時間・宿泊費の問い(radio)、日付未定の扱い。個人的な理由を保存しない | IMPLEMENTED | `consultModel.intentOf`、BE `test_draft_validation_and_ownership`、FE |
| 5 | 方面の比較: 地図(位置の出典)と一覧、3件+他の候補、未照会を値にしない、点数なし、直線距離の下限の判定、選ぶだけでは旅程にしない、方面を足す・外す・比較に残す | IMPLEMENTED | `AreasStep.tsx`・`AreaMap.tsx`、BE `test_areas_*`・`test_limit_check_lower_bound_only`・`test_nominatim_geocode_maps_statuses`、FE、E2E |
| 6 | 方面の詳細: 6つのカテゴリ・半径で探す(出典・取得時刻)、選ぶ、URL は出典としてだけ、PLAN CHECKLIST、何も選んでいない時の説明 | IMPLEMENTED | `AreaDetailStep.tsx`、`search_provider.CATEGORY_TAGS`(sightseeing・quiet)、FE、E2E |
| 7 | 下書き: 選んだ方面の候補だけ・他人の検索結果は使えない・URL の追跡の query を除く・日程は作らない | IMPLEMENTED | BE `test_draft_commit_flow`・`test_draft_validation_and_ownership` |
| 8 | 下書きの画面: 未確定の表示・日のタブ・全日程・移動の区間の行・並べ替え(触る・キーボード 44px)・読み上げ・元に戻す・確認の一覧 | IMPLEMENTED | `TripDraftPage.tsx`、`consultModel.moveSlot`、FE、E2E |
| 9 | 日付と IANA の時刻帯で旅程にする(1つの変更・元に戻すと下書きに戻る・二度はできない) | IMPLEMENTED | BE `test_draft_commit_flow`、E2E |
| 10 | 360px・1440px、明暗で axe 違反 0、横にはみ出さない | IMPLEMENTED | E2E |
| 11 | 道路の経路・運転時間・高速料金、宿の在庫・料金、混み具合、方面の自動の提案、AI の読み取り | NOT STARTED | 提供元が未接続(ADR §3)。画面は「未照会」「未接続」と示す |
| 12 | 家族での投票 | NOT STARTED | FR-007 の gaps(候補への投票) |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| backend | pytest 1,273 合格・2 飛ばし(新規 `test_gate_g11_intake.py` 11件)。flake8 0、mypy 0(基準 0)、alembic 往復一致。migration なし(head `b8d4f6a0c3e5`) |
| frontend | vitest 894 合格・標準エラー 0 行、tsc 0、lint 0、build、最初に読む JS 427.83 kB(上限 430 kB)、npm audit 合格 |
| E2E(全件) | **89 合格・失敗 0・再試行 0**(新規 `gate-g11-intake.spec.ts` 2件)。外部(地名の照会・近くの検索・地図の画像)だけ `page.route` で差し替え |
| E2E で見つけて直した不具合 | 旅程にした後に旅行の情報(`GET /travel-plans/{id}`)が 500(開始・終了の日を現地の 0時で持ったため、日付の型の検査に落ちた)。作成の画面と同じ UTC の 0時へ直し、BE の試験に足した |
| 怪しさの点数(Gate S6)の推移 | 全件の E2E の間、接続元の15分の点数は最大 60(遮断は 150)。G11-Style の PR の CI(pull_request の run 40783537644)で member-policy から後が 429 で連鎖して落ちたが、同じ tree の push の run 40783532270 とこの全件では再現しない(記録として残す) |
| その他 | secret-scan、DOC-10 の検査(変更なし)、trace の索引・エラーの一覧(4件追加)最新 |
