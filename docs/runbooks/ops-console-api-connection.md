# 運用コンソールと外部 API の接続の手順(Gate OpsCMS)

対象: 開発の環境の管理者だけ。**この手順の実行(契約・鍵の作成・API の有効化・実の API の呼び出し)は利用者の判断と操作が要る。**
アプリは鍵の値を画面・応答・ログ・監査に出さない(設定があるかどうかだけを `/admin/ops` に出す)。

## 1. 今の状態(この Gate の時点)

| 項目 | 状態 |
|---|---|
| 運用コンソール `/admin/ops` | 実装済み(管理者 + 多要素認証)。概要・API・契約と接続・原価の台帳・Cloud 環境・Fake の試験・秘密情報と権限 |
| 有料の提供元(OpenAI・Maps JavaScript・Places (New)・Routes) | **未接続**。`cost_guard.register_provider` に登録が無いので、アプリは送らない(fail closed) |
| 1旅行 50円の上限 | サーバーが provider へ送る前に予約して守る(FR-059)。Fake の試験で 49.55円で止まり、50円を越えないことを確認 |
| Cloud Billing の請求額・予算・有効な API・Secret Manager の版 | アプリから読んでいない(画面は「未取得」)。Cloud Console で確認する |
| Cloud Run・DB・Redis(GCP) | このリポジトリの workflow は backend の image の push まで。接続の値が無いまま deploy して「稼働」と扱わない |

## 1.5 鍵の登録(運用コンソール)

`/admin/ops` → 秘密情報・権限 → 「鍵を登録する」。鍵は貼り付けて「暗号化して保存」。サーバーの ENCRYPTION_KEY で暗号化して
`provider_secrets` に入れ、画面・応答・ログ・監査には末尾4文字と版だけを出す。使う順は「この画面で登録した有効な版 → .env の値」。
入れ替えは新しい版を登録(前の版は自動で入れ替え済み)。漏えいの疑いの時は「登録を無効にする」(.env の値があればそれへ戻る)。
ENCRYPTION_KEY を入れ替える時は `tcops.py keys rekey` が鍵の暗号文も掛け直す。GCP の Cloud Run では Secret Manager を使ってもよい(.env と同じ扱い)。

## 2. 接続の順番(提供元ごと。各段で課金の状態を確かめる)

1. **契約・請求先**: OpenAI は ChatGPT の契約と API の課金が別。OpenAI Platform の組織・プロジェクト・支出の上限を決める。
   Google は Cloud の請求先と予算(予算は通知で、課金を止める上限ではない)。
2. **必要な API だけ有効にする**: 使わない API は有効にしない。Places は Field Mask と SKU を固定、Routes は要素の数を予算に入れる。
3. **制限付きの鍵**: ブラウザ用(HTTP referrer・Maps JavaScript API だけ)とサーバー用を分ける。
4. **Secret Manager**: サーバー用の鍵は Secret Manager に入れ、Cloud Run の実行のアカウントだけに accessor を付ける。鍵のファイルを作らない(WIF のまま)。
5. **価格の版**: `usage_policy_profiles` の価格(USD 単価・為替・税・余裕)が実の単価と合うかを確かめる。変える時は新しい版(既存の版は変えない)。
6. **提供元の Gate**: provider の adapter(単位の計測・停止・最大の token/件数・再試行 1回まで)を実装し、`register_provider` で登録する。
   このコンソールの「送信」が「送信できる」になるのは、登録・鍵・価格の版が揃い、止めていない時だけ。
7. **1回だけの少額の確認**: 見込みの額と残りの枠を確かめてから1回ずつ。結果を台帳と請求の明細で照合する(`cost_guard.reconcile`)。

## 3. 止める・戻す

- `/admin/ops` → API・契約と接続 → 「止める」(理由が要る。監査 `ops_provider_suspended`)。全ての worker で送らなくなる(共有の印)。
- 原因を確かめてから「戻す」(監査 `ops_provider_resumed`)。
- 請求の照合で差が出た時・見込みを越えた確定があった時は、アプリが自動で止める(FR-059)。

## 4. 鍵の入れ替え

新しい版を作る → 接続の確認(1回) → Cloud Run の参照する版を切り替え → 古い版を無効。平文を管理の画面で再表示しない。

## 5. Fake の家族旅行の試験

`/admin/ops` → テスト実行。枚方発・大人4人・自家用車・1泊2日・片道3時間以内・宿泊費4人で6〜8万円の条件で、
試験用の利用者と旅行を作り、Fake の提供元に原価の予約→確定を上限まで繰り返す(外へは送らない)。本番・staging では実行しない。
確かめること: 合計が 50円を越えない・40円で利用者の警告・45円で運用の知らせの段・断る理由が provider の前・同じ Idempotency-Key で二重に数えない。
旅行の予算(FR-027)と API の原価(FR-059)は別に数える。
