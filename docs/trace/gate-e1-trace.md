# Gate E1 予約・チケット・取込・共有・複製の browser E2E トレーサビリティ表

- 対象: FR-010 予約管理、FR-011 予約取込、FR-012 QR・チケット、FR-021/044/045 共有リンク(合言葉・失効)、FR-047 旅程の複製(DOC-02)
- Gate: E1(画面・E2E・不具合修正。backend・DB・migration の変更なし)
- 前提: Gate O2(`d4ca2b9`)適用後
- 目的: INTEGRATED だが E2E が無かった(または一部だけだった)FR を、実ブラウザの試験で確かめ、VERIFIED 判定(V1)へ進める材料を揃える

凡例: `IMPLEMENTED` / `PARTIAL` / `NOT STARTED`。
試験は `frontend/e2e/reservations.spec.ts`・`frontend/e2e/share-clone.spec.ts`(E)、`frontend/src/...`(F)。

## 1. E2E で確かめたこと

| # | 要件 | FR | 状態 | 証拠 |
|---|---|---|---|---|
| 1 | 予約を画面から登録できる(種類・事業者・予約番号・PIN・名義・開始日時) | FR-010 | IMPLEMENTED | E `予約: 予約番号は伏せて一覧し…` |
| 2 | 一覧・詳細では予約番号を伏せる(全体は出さない) | FR-010、DOC-11 | IMPLEMENTED | E 同上(body に全体が無いこと) |
| 3 | 「表示する」を押した時だけ予約番号・PIN を開示し、隠せる(開示は監査ログに残る: R3-8) | FR-010 | IMPLEMENTED | E 同上(reveal 応答 200) |
| 4 | チケットを登録でき、データは押した時だけ表示する | FR-012 | IMPLEMENTED | E 同上 |
| 5 | 参加者(氏名・座席)を登録できる | FR-010 | IMPLEMENTED | E 同上 |
| 6 | 再読込後も残り、伏せた状態に戻る | FR-010/012 | IMPLEMENTED | E 同上 |
| 7 | 予約を削除できる | FR-010 | IMPLEMENTED | E 同上 |
| 8 | 取込は同意してからジョブを作る(同意前は作成不可) | FR-011、B-015 | IMPLEMENTED | E `予約取込: 同意して…` |
| 9 | 候補を1項目ずつ登録・承認し、確定すると予約ができる(予約番号は伏せる) | FR-011 | IMPLEMENTED | E 同上 |
| 10 | 合言葉つき共有リンクを発行できる | FR-021/045 | IMPLEMENTED | E `共有リンク: 合言葉つきで…` |
| 11 | 共有 URL の QR を端末内で作り、トークンを外部へ送らない | FR-045、DOC-11 | IMPLEMENTED | E 同上(通信の記録)、F `LocalQrCode.test.tsx` |
| 12 | 未ログインで開くと合言葉を求める。誤りは拒否し、正しければ閲覧できる | FR-044/045 | IMPLEMENTED | E 同上、F `e1share.test.ts` |
| 13 | 公開閲覧に予約(事業者名・予約番号)が出ない | FR-045 | IMPLEMENTED | E 同上 |
| 14 | 失効した URL は「無効」になる(合言葉の入力欄も出さない) | FR-021 | IMPLEMENTED | E 同上 |
| 15 | 旅程を複製すると日程・予定が写り、予約は写らない。元は変わらない | FR-047 | IMPLEMENTED | E `旅程の複製: …` |
| 16 | 上記すべての画面で axe-core(WCAG 2.1 AA)違反0 | NFR(a11y) | IMPLEMENTED | E(`support/axe.ts`) |
| 17 | 予約・チケットのオフライン表示、バーコード描画 | FR-012 | NOT STARTED | 対象外(K1・以降) |
| 18 | メール・OCR による自動抽出 | FR-011 | NOT STARTED | 外部 provider 未接続 |
| 19 | 共有の閲覧側(Guest Travel View)の詳しい表示・複製 | FR-044 | PARTIAL | 閲覧と合言葉・失効のみ |

## 2. E2E を書いて見つけ、直した不具合

| # | 不具合 | 影響 | 修正 | 試験 |
|---|---|---|---|---|
| 1 | 合言葉つき共有リンクを開くと /login へ飛ばされる(合言葉の入力欄が一度も出ない) | FR-045 の合言葉が実質使えない | `resolvePublicShare` は共通エラー処理(401 をログイン切れとしてトークンを捨て /login へ移動)を通さない(`skipGlobalErrorHandler`) | E 12、F `e1share.test.ts`。修正を外すと E が失敗することを確認 |
| 2 | 共有 URL(秘密のトークン入り)を QR 作成のため外部サービス(api.qrserver.com)へ送っていた | トークンが第三者とそのアクセスログに渡る | `qrcode` 1.5.4 で端末内に SVG を作る `components/share/LocalQrCode.tsx` | E 11、F |
| 3 | 共通部品 `Input` の label が入力欄に結び付いていない(htmlFor なし) | 読み上げで何の欄か分からない。label のクリックで欄へ移らない | `useId`+`htmlFor`、エラー・補足文を `aria-describedby`、エラーは `role="alert"`・`aria-invalid` | F `Input.test.tsx` |
| 4 | 予約・取込・プラン一覧のカードが `<div onClick>` でキーボードから開けない | キーボード・支援技術の利用者が詳細を開けない | ボタンにして Tab・Enter で開ける。プラン一覧は名前付きの一覧項目にし、「開く・複製・削除」のボタン名にプラン名を入れる | E 3、9、15 |
| 5 | 見出し・ラベルの無い入力欄、同じ名前の「追加」ボタンが複数 | 読み上げで区別できない | 各欄に label/aria-label、ボタン名を「チケットを登録」「参加者を追加」「候補を追加」等に | E 4、5、9 |
| 6 | 文字のコントラスト不足(gray-400、blue-500/green-500 の白文字 等) | WCAG 2.1 AA 違反 | gray-600/700、blue-600、green-700 等へ | E 16 |
| 7 | エラー表示が読み上げられない | 失敗に気づけない | `role="alert"` | E 12 |

## 3. E2E 基盤の変更(QuickDraft の回数制限)

| # | 問題 | 対処 |
|---|---|---|
| 1 | 各 spec が「新しいプラン」ダイアログ(QuickDraft の作成+昇格、同じ IP から1時間20回まで)でプランを作っており、E2E を1時間以内に2回流すと約20件がプラン画面への遷移待ちでタイムアウトした(E1 v2 の omega-dev2 実行で20件失敗) | `frontend/e2e/support/guestPlan.ts` の `startGuestPlanViaApi`(ゲスト開始+`POST /travel-plans/`)に一本化。19 spec の作成処理を置き換え、名前・引数・戻り値は維持。ダイアログ自体は `quickdraft-flow.spec.ts` で確かめる。1回の E2E で QuickDraft を使うのは2回だけになった |
| 2 | 失敗時に 429 かどうかが出力から分からない | 補助がゲスト開始・プラン作成の状態コードと本文をエラーに含める |
| 3 | 速い環境で axe が色の切り替え途中を判定する(E1 v1 の予約詳細) | `support/axe.ts` の `settleForAxe`(ホバーを外し、有限のアニメーションの終了まで最大5秒待つ)。違反時は要素の HTML と理由(コントラスト比など)を `[axe-node]` 行で出す |
| 4 | backend の回数制限はプロセス内のメモリにあり、E2E の前に残っていると上限に当たる | パッチは E2E の前に backend を作り直す(回数がリセットされる) |

## 4. 対象外・残り

- 予約の取消期限通知・支払、チケットのバーコード描画・オフライン表示(FR-012)、自動抽出(FR-011)
- 共有の項目単位の policy エンジン(FR-045)、所有者の移譲(FR-021)
- 回数制限をプロセス間で共有する仕組み(セキュリティ整理 SEC-12。別 Gate)
