# Gate BookletPatterns・Receipt — しおりの 12 パターンとレシートの読み取り

正本: 利用者の指示(2026-11-05 18:34)。

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 1 | 12 パターンを Web と印刷で生成 | IMPLEMENTED | `pages/booklet/{BookletView,BookletCover,bookletThemes,booklet.css}`・`booklet.THEMES`・migration `e6b3d9a1c7f2` | `e2e/booklet-patterns.spec.ts` |
| 2 | タイトル・日程・エリア・地図・大日程・日別の行程を必須に | IMPLEMENTED | `REQUIRED_SECTIONS`・`buildOverview`・`buildTimeline`・`BookletMap` | `e2e/booklet-patterns.spec.ts`・`bookletModel.test.ts` |
| 3 | 共有の設定で内容が変わる | IMPLEMENTED | `redact_booklet`・`BookletPage` の隠された章の扱い | `test_gate_p4_booklet.py` |
| 4 | レシートの自動読み取り | IMPLEMENTED | `receipt_extract.py`・`api/v1/receipts.py`・`ReceiptScanDialog` | `test_gate_receipt.py` |

実機(omega-dev2)・実物のレシート・実の OpenAI・本物の字体と地図の画像は未確認。ADR-booklet-patterns.md・ADR-receipt-extract.md。

## Gate WishPlaces

| # | 要件 | 状態 | 実装 | 試験 |
|---|---|---|---|---|
| 5 | SC-47 行きたい場所(題名・一覧・追加・編集・削除) | IMPLEMENTED | `pages/SpotListPage.tsx`・`api/v1/spots.py` | `e2e/booklet-patterns.spec.ts`・`test_gate_wish_places.py` |
| 6 | 手入力・検索・写真・声・SNS・URL で場所を入れる | IMPLEMENTED | `PlaceFinder`・`api/v1/spot_intake.py`・`url_place.py` | 同上 |
| 7 | 旅程の操作の列からしおりを作成 | IMPLEMENTED | `PlannerPage` | `e2e/booklet-patterns.spec.ts` |
