# Gate C3 トレース(FR-009 情報内検索・コマンドパレット)

基準: Gate C2。migration なし。B = backend `tests/test_gate_c3_search.py`、U = vitest(`services/api/c3search.test.ts`・
`components/CommandPalette.test.tsx`)、E = `frontend/e2e/search.spec.ts`。API `GET /plans/{id}/search`・`GET /search/everything`。

## FR-009(DOC-02「店名、住所、予約番号末尾、参加者、日付、タグ、文書名から旅行全体を横断検索。権限のない秘密値は検索候補・件数にも
漏らさない。今日・予約・チケット・ホテル・緊急の固定フィルタ」、DOC-04 SC-10・§12)

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 店名・住所・参加者・日付・文書名で横断検索 | IMPLEMENTED | 日程・予定・場所(別名・住所・電話)・候補・予約(提供元)・チケット・文書(復号したファイル名)・費用・メンバー・記録。B・E |
| 2 | 日付の語(今日・明日・M/D・YYYY-MM-DD・M月D日) | IMPLEMENTED | B |
| 3 | 予約番号の末尾 | IMPLEMENTED | 「予約」に絞った時だけ、末尾の HMAC 索引で照合。結果は伏せた番号だけ(****5678)、「予約番号の末尾に一致」と示し一致箇所を強調しない(§12.2)。絞らない時は当たらない。B・E |
| 4 | 権限のない秘密値を結果・件数に出さない | IMPLEMENTED | 他の人の機密の文書・他の人の非公開の記録は名前で探しても件数0、分類ごと出さない。予約番号・PIN・名義・チケットの中身を応答に含めない。参加していない旅行は 403/404・横断で0件。B・E |
| 5 | 固定フィルタ(今日・予約・チケット・ホテル・緊急) | IMPLEMENTED | 今日=各日のタイムゾーンでの今日、ホテル=宿泊の予定・予約・場所、緊急=保険・旅券・病院などの文書・予定・場所。B・E |
| 6 | コマンドパレット(SC-10 入力と同時にカテゴリ表示、§2.2 全体検索) | IMPLEMENTED | Ctrl+K / ⌘K、止まってから250ms、↑↓・Enter・Esc、この旅行/すべての旅行、combobox + listbox、axe 違反0。U・E |
| 7 | 移動先の安全 | IMPLEMENTED | 画面の中の経路(/planner/{uuid}/…)以外を decoder が拒否(javascript:・外部 URL)。U |
| 8 | 検索語を残さない・回数制限 | IMPLEMENTED | 監査・ログに検索語を残さない(B でログを検査)、利用者ごと1分60回 |
| 9 | タグ | NOT APPLICABLE | タグの機能が無い |
| 10 | コマンド(`>予定を追加` 等、§12.1) | NOT STARTED | 検索だけ |

→ INTEGRATED(E2E有)。
