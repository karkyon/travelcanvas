# TravelCanvas Owner 作業手順 — Gate② 受入(2026-11-26)

> Claude Code ができない作業(サーバーへの接続・実機・実 API・実旅行・事業の判断)を、Owner が迷わず安全に行うための手順。
> **成功していない作業を成功と書かない。** 未実施・blocked・失敗はそのまま記録する。
> この文書の SHA は例。**実行する日に、下の §1 の手順で対象の SHA を取り直す。**

## 0. いつ始めるか(今の状態)

| 項目 | 状態(2026-11-26) |
|---|---|
| GitHub Actions | **2026-11-30 まで使わない**(個人アカウントの Actions の予算 $0 で止まっている。Owner の判断で予算は増やさない) |
| Claude の作業 | ブランチ `claude/lucid-johnson-paosud` に修正を積んでいる(未マージ。同時の操作の 500・数のずれ・上限・監査など)。手元で backend の全件を確かめている |
| main | `a648021`(11-26 の時点。CI は 5 件とも成功済み) |
| 次に main が変わる時 | 12/1 以降、CI が動くのを確かめてから、Claude がブランチを PR にして CI を通し、マージする |

**おすすめ:** O-1(環境の反映)は、Claude が「12/1 以降のマージの後の main の CI が全件成功した」と知らせてから行う。
今の main `a648021` へ先に反映してもよいが、その後もう一度反映が要る(Claude のブランチの修正が入るため)。
**CI が止まっている間に、main へのマージ・デプロイを Owner が手で行わない。**

## 1. 対象の SHA の決め方(毎回)

1. Claude から「CI が全件成功した main の 40 桁の SHA」を受け取る。
2. ブラウザで `https://github.com/karkyon/travelcanvas/commits/main` を開き、いちばん上の commit の SHA が同じで、緑のチェック(全件成功)であることを確かめる。
3. サーバーの上で `git fetch origin main && git rev-parse origin/main` の出力が同じ 40 桁であることを確かめる。**どれか 1 つでも違えば止めて Claude に知らせる。**

## 2. O-1: omega-dev2・GCP VM を対象の main にそろえる

**なぜ Owner か:** SSH・Tailscale・VM の認証と、バックアップの運用は Owner の権限。Claude は接続できない。

**前提・止める条件**

- §1 で対象の SHA が 3 か所で一致している。
- `git status --short --branch` に未コミットの変更が出たら止める(消さない・reset しない)。
- バックアップ・migration・health/ready のどれかで止まったら、出力を保存してそこで止める(やり直し・手の修復をしない)。

### 2.1 omega-dev2(先に)

```bash
cd ~/projects/travelcanvas
git status --short --branch
git fetch origin main
git rev-parse origin/main
bash <(git show origin/main:scripts/ops/gate2_env_record.sh)
```

`git rev-parse origin/main` が §1 の SHA と同じことを確かめてから:

```bash
cd ~/projects/travelcanvas
TC_BRANCH=main bash <(git show origin/main:scripts/ops/local_dev_apply.sh)
```

`TC_BRANCH=main` を外さない(スクリプトの既定は `dev/plan-b`)。反映の後:

```bash
cd ~/projects/travelcanvas
bash scripts/ops/gate2_env_record.sh
```

### 2.2 GCP VM(omega-dev2 が正常になった後)

```bash
cd ~/projects/travelcanvas
git status --short --branch
git fetch origin main
git rev-parse origin/main
bash <(git show origin/main:scripts/ops/gate2_env_record.sh)
```

対象の SHA を変数に入れてから反映する(手で打ち間違えないため。§1 の SHA と同じことを目で確かめる):

```bash
cd ~/projects/travelcanvas
TARGET=$(git rev-parse origin/main); echo "$TARGET"
```

```bash
bash scripts/ops/gcp_vm.sh deploy "$TARGET"
```

```bash
bash scripts/ops/gcp_vm.sh check
```

```bash
bash scripts/ops/gate2_env_record.sh
```

### 2.3 期待する結果

- `head` と `origin_main` が対象の SHA。`tracked_changes=0`。
- `current` と `heads` が同じ(`expected_head` の値と同じ。migration が増えていれば Claude が知らせる)。
- backend・frontend・postgres・redis が running / healthy。`health=200`・`ready=200`。
- 画面がログインまで開く。
- T2 の重複・メールの大文字小文字の重複・正規化していない招待の件数(数だけ。中身は写さない)。

### 2.4 記録欄

| 項目 | omega-dev2 | GCP VM |
|---|---|---|
| 対象の SHA(§1 の 3 か所が一致) | 未記入 | 未記入 |
| 反映前の head / 作業ツリーは clean か | 未記入 | 未記入 |
| 反映後の head | 未記入 | 未記入 |
| バックアップの ID / 確かめた結果 | 未記入 | 未記入 |
| alembic current = heads | 未記入 | 未記入 |
| 4 つのサービスの health | 未記入 | 未記入 |
| /health・/ready・checks | 未記入 | 未記入 |
| 画面・CORS | 未記入 | 未記入 |
| T2 の重複・大文字小文字の重複・未正規化の招待(件数) | 未記入 | 未記入 |
| 記録のファイルの保存先(非公開) | 未記入 | 未記入 |

### 2.5 絶対にしない操作

`git reset --hard`・`docker compose down -v`・DB の volume の削除・手の SQL・migration の downgrade・バックアップ無しの続行・
失敗した deploy のやり直し・本番・Cloud Run・Stripe Live の操作。秘密の値・パスワード・実在のメール・予約番号・旅券・正確な位置を
チャット・PR・Issue に貼らない。

## 3. O-2: Google のサーバー用キーの「有効性を確認」(O-1 の後)

**なぜ Owner か:** 管理者のアカウントと本物の鍵が要る。

1. 反映した環境の管理画面を開く。
2. Google のサーバー用キーの「有効性を確認」を押す(**鍵を貼る・変える・作り直す作業ではない**)。
3. 記録: 環境 / 日時(JST) / 成功・失敗 / 失敗ならエラーの分類(画面の文)。鍵の文字列・請求の情報は書かない。
4. 失敗しても鍵の権限・課金の設定を変えずに、分類を Claude に渡す。

## 4. O-3: ブラウザの手の確認 C-1〜C-31(O-1 の後)

**なぜ Owner か:** 本当のログインと、複数の会員での操作が要る。

- 手順・期待値の正本は main の `docs/test/gate2_manual_verification.md`(反映した SHA の版を開く)。
- 使うデータ: 試験だけの会員・自分のメールの別名・架空の予約番号・ホテル・レシート。実在の他人のメール・本物の旅券・決済情報は入れない。
  SNS に投稿しない。後片付けは画面から(DB を手で直さない)。

| 試験 | 環境の SHA | 日時(JST) | 結果(成功/失敗/blocked/未実施) | 症状・証拠の保存先(非公開) |
|---|---|---|---|---|
| C-1〜C-31(1 行ずつ) | | | 未実施 | |

## 5. O-4: 実機 D-1〜D-12(O-1 の後)

**なぜ Owner か:** iPhone/Safari・Android/Chrome・iPad の実機、位置・通知・読み上げ(VoiceOver/TalkBack)が要る。

- 手順は `docs/test/gate2_manual_verification.md` の D 票。
- 歩きながら・運転しながら操作しない。SNS のリールはファイルを作って読み込みの確認まで(投稿しない)。
- 文字だけの拡大(端末の文字の大きさの設定)で画面がどう見えるかも D-8 で記録する(画面の文字は px が多く、文字だけの拡大では大きくならないことが分かっている。
  直すかは下の §8 の判断票 T11)。

| 試験 | 端末・OS・ブラウザの版 | 環境の SHA | 結果 | 症状・証拠の保存先 |
|---|---|---|---|---|
| D-1〜D-12(1 行ずつ) | | | 未実施 | |

## 6. O-5: 実 API A-1〜A-4(鍵・契約・予算の上限を確かめた後)

**なぜ Owner か:** 本物の鍵・提供元の契約・費用の上限は Owner のもの。

- 開発環境に設定済みの提供元だけ。鍵・契約・課金の上限を事前に確かめられない提供元は実行せず `未実施(鍵/費用の条件を未確認)`。
- 実 API の失敗を CI の模擬の結果で補わない。請求の額・回数はアカウント名・鍵を除いて書く。

| 試験 | 提供元 | 予算の上限を確かめた | 結果・出典・取った時刻 | 実費(または未確認) |
|---|---|---|---|---|
| A-1〜A-4 | | | 未実施 | |

## 7. O-6: 実旅行 R-1 / R-2

- **R-1 近場の日帰り:** 相談 → 候補 → 旅程 → 準備 → NOW/NEXT → 変更・プラン B → 支出 → 訪問・記録。
  入れ直し・画面を探した・次に何をするか迷った場面をメモする。
- **R-2 伊勢などの泊まりの旅行:** R-1 に加えて、複数の日・同行者との共有と別行動・移動・不安定な通信・予定の変更。
- 運転中・歩行中に操作しない。予約の原本と公式の交通案内を持つ(アプリだけに頼らない)。旅券・決済・予約番号・他人の個人情報は入れない。
  位置の記録は試す時だけ明示的に ON にし、後で OFF と削除を確かめる。

| 旅行 | 環境の SHA | 日時・場所(大まかに) | つまずいた場面・入れ直し | 結果・改善の希望 |
|---|---|---|---|---|
| R-1 / R-2 | | | 未実施 | |

## 8. O-7: Owner の判断票

判断が済むまで Claude は安全な既定(公開・Live・計測を有効にしない)のまま。詳しい選択肢は `docs/audit/2026-11-19_gate2_decision_tickets.md`。

| 票 | 判断すること | 選択肢 | 推奨(Claude の案) | 影響 | 決めないと止まるもの |
|---|---|---|---|---|---|
| T3 | LICENSE | MIT・README を「未定」に直す・別のライセンス(権利者名・年) | README を未定に直す(公開前に決める) | 公開・外部への配布 | 公開 |
| T5 | 会員の名称・機能の差・価格・期間 | 月・年・1 旅行・短期 | 未承認のまま(コードの枠は内部の区分だけ) | 販売の画面・規約 | 販売 |
| T6 | Stripe Live・税・返金・特定商取引法 | test mode を続ける・Live の準備の条件と確認者を決める | test mode を続ける | 本当の決済 | 販売 |
| T7 | 利用の計測 | 入れない・同意つきで最小限(目的・出来事・保存期間・撤回・削除) | 入れない(既定 OFF) | 改善の材料 | 無し(後でよい) |
| T8 | 旅行の「状態」と「段階」の画面の言葉 | 別に出す・まとめる・言葉を変える | 今のまま | 画面の分かりやすさ | 無し |
| T9 | 取り込みの「未確認」 | 共通の状態に足す・取り込みの画面だけ | 取り込みの画面だけ(今のまま) | 予約の一覧 | 無し |
| T10 | 退会で消せなかったファイル | A 表に残し定期にやり直す・B 保存先を定期に走査・C 今のまま(運用者が手で) | A(本番の保存先が決まってから) | ほかの人の旅行の記録の写真が読める形で残りうる(C の時) | 本番 |
| T11 | 文字だけの拡大に画面を合わせるか | 文字の大きさを rem に移す(744 か所)・今のまま(画面の拡大で WCAG 1.4.4 は満たす) | D-8 の実機の結果を見て決める | 大きな文字の設定の人の読みやすさ | 無し |
| 未実装 FC | FC-011 繰り返しの予定・FC-044 Wallet・FC-076 運行情報の履歴 | 実装する・しない・時期 | 011 は需要を見て。044・076 は将来(076 は提供元の契約が前提) | 機能の範囲 | 無し |

| 票 | Owner の選択 | 日付 | 法務などの確認者 | 保留の理由 |
|---|---|---|---|---|
| T3・T5〜T11・未実装 FC(1 行ずつ) | | | | |

## 9. Claude へ返す形(1 回にまとめる。秘密の値・個人情報を除く)

```text
対象の main SHA:
omega-dev2: 前の SHA / 後の SHA / バックアップの ID / DB の revision / health・ready:
GCP VM: 前の SHA / 後の SHA / バックアップの ID / DB の revision / health・ready:
Google のキーの確認: 成功 / 失敗(分類) / 未実施(理由)
手の確認: C・D・A・R の番号ごとに 成功 / 失敗 / blocked / 未実施
Owner の判断: 票ごとの選択・保留の理由
共有できる安全な証拠の保存先:
```

Claude は受け取ったら、秘密の値・メール・個人情報が無いことを確かめ、`docs/audit/2026-11-20_gate2_status_addendum_d.md` に
「Owner のログによる実績」として記録し、失敗は再現・修正・同じ試験のやり直しまで進める。**自分が接続していない環境を実測済みと書かない。**
