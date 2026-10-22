# Gate F45 トレース(FR-045 / CA-003 安全な共有ポリシー: 項目単位の共有の規則)

基準: Gate C3。migration `d5a3b7c9e1f2`(`plan_share_links.policy` JSONB, NULL 可)。B = backend
`tests/test_gate_f45_share_policy.py`(既存の `tests/test_share.py`・`test_gate41_guest_share_view.py` も通る)、
U = vitest(`services/api/f45sharePolicy.test.ts`・`pages/SharePage.f45.test.tsx`・契約 fixture)、E = `frontend/e2e/share-policy.spec.ts`
(既存の `share-clone.spec.ts` も通る)。規則の正本は `backend/app/services/share_policy.py`。

## 分類と既定(DOC-11 の PUBLIC/INTERNAL/CONFIDENTIAL/RESTRICTED を共有リンクに適用)

| 分類 | 項目 | 既定 |
|---|---|---|
| PUBLIC | 旅行名・目的地・期間・予定名・予定の種類 | 常に見せる |
| INTERNAL | 旅行の説明・日程の見出し・予定の時刻 | 標準で見せる(選んで外せる) |
| CONFIDENTIAL | 予定の住所(文字列)・予定のメモ・予約の概要(種類・施設名・日時・状態) | 見せない。1つずつ選び、確認(acknowledge_confidential=true)が無いと 422 |
| RESTRICTED | 予約番号・PIN・チケット/QR・文書・連絡先と予約者名・正確な位置/GPS・支払い/費用 | どの設定でも見せない(指定すると 422 field_restricted。出力候補に無い) |

まとめて選ぶ: 最小限(PUBLIC のみ)・標準(=INTERNAL)・すべて(機密を除く。=INTERNAL)。既存のリンク(policy NULL)は標準=本Gate以前と同じ表示。

## FR-045 / CA-003(DOC-15「分類を共有時にも強制」「すべて共有の一括操作でも機密項目を暗黙公開しない」「共有・Reveal・ダウンロード・印刷を監査」)、
CA-002「表示項目選択」「所有者が共有プレビューで公開内容を事前確認できる」、FC-062「field policy」

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 共有リンクごとに見せる項目を選ぶ | IMPLEMENTED | 作成 `POST /travel-plans/{id}/share`・変更 `PUT …/share/{share_id}` が `fields`/`preset` を受け取り保存。一覧に `fields`。B・U・E |
| 2 | 分類の強制(RESTRICTED は共有不可) | IMPLEMENTED | 指定は 422、公開投影はホワイトリストで RESTRICTED を出力候補に持たない。予約の概要を許可しても予約番号(伏せた形も)・予約者名・電話・金額・緯度経度が応答に無いことを本文で検査。B |
| 3 | 一括操作でも機密を暗黙に公開しない | IMPLEMENTED | preset=all は INTERNAL だけ。機密は確認が無いと backend が 422、画面は確認するまで発行ボタンを押せない。機密を外すと確認も外れる。B・U・E |
| 4 | 許可されていない項目はキーごと出さない | IMPLEMENTED | 住所・メモはキー自体が無い。説明・見出し・時刻は null。B |
| 5 | 共有前プレビュー(発行前・発行後) | IMPLEMENTED | `POST /travel-plans/{id}/share-preview`・`GET …/share/{share_id}/preview`(所有者のみ)。公開閲覧と同じ投影(`build_public_view`)で、見せない情報の件数(内容は返さない)を添える。以前の「共有前プレビューを開く」は実際の URL を開いて使用回数を1回使っていた→画面内の確認に置き換え。使用回数・最終閲覧を変えないことを B・E(上限1回のリンクが確認後も開ける)で確認 |
| 6 | 所有者以外は使えない | IMPLEMENTED | プレビューは owner 以外 403/404。B |
| 7 | 監査(共有の発行・変更・失効・削除) | IMPLEMENTED | `share_link_created/updated/revoked/deleted`。details は項目名・権限・合言葉/期限の有無・回数上限・変えた設定の名前だけ(トークン・合言葉・プランの内容を残さない。B で検査)。閲覧は従来どおり ShareAccessLog |
| 8 | 公開閲覧の画面 | IMPLEMENTED | `components/share/SharedPlanView`(公開閲覧とプレビューで共通)。住所・メモ・予約の概要は届いた時だけ表示、見出しが無ければ日付。axe 違反0。U・E |
| 9 | URL共有・同行者共有・公開画像・PDF ごとに別の Policy | PARTIAL | URL 共有は本Gate。PDF・画像(しおり)は FR-035 の出力ごとの選択(予約番号・住所・電話・参加者、既定で除外)が既にある。同行者(メンバー)は役割(閲覧者/編集者)で制御し、項目単位の規則は未対応 ※ **SUPERSEDED BY Gate G2(同行者向けの項目の規則 app/services/member_policy.py。gate-g2-trace.md #G2-45)** |
| 10 | QR/バーコードの Reveal に再認証 | NOT IN SCOPE | 共有リンクでは QR を見せない(RESTRICTED)。本人の Reveal は既存の reveal API |

→ INTEGRATED(E2E有)。#9 は同行者向けの項目単位の規則が残る(PARTIAL)。
