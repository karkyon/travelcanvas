# Gate Q1 トレース(写真の撮影情報の除去・V2 の CI の e2e の不安定の修正)

基準: main `de643b5`(Gate V2)。migration なし。B = backend `tests/test_gate_q1_photo_metadata.py`、U = vitest、E = E2E。

## 写真の撮影情報(FR-051 CA-009「写真EXIFも同じ公開Policyで除去」、DOC-14 §12「EXIFは公開成果物から既定除去」)

V2 で見つけた欠点: 写真の記録(P12)は上げたファイルをそのまま保存・配信しており、撮影位置(GPS)・機種・撮影日時が残っていた。

| # | 要件 | 状態 | 証拠 |
|---|---|---|---|
| 1 | 保存の時に EXIF・XMP・IPTC・コメント(JPEG)、eXIf・tEXt・iTXt・zTXt・tIME(PNG)、EXIF・XMP(WebP)を除く | IMPLEMENTED | `app/services/image_metadata.py`。B(GPS・機種・XMP 入りの本物の画像) |
| 2 | 画質を落とさない | IMPLEMENTED | 構造の該当部分だけを切り取る(JPEG の画像データは同じバイト列)。B(画素が同じ) |
| 3 | 向き(Orientation)を保つ | IMPLEMENTED | 1 以外なら画素に反映してから除く(この時だけ再圧縮 品質92)。B |
| 4 | Q1 より前に保存した写真 | IMPLEMENTED | 配信(GET /memories/{id}/media)の時にも除く。B |
| 5 | 除けないファイル | IMPLEMENTED | 構造を読めず撮影情報の印がある写真は受け付けない・表示しない(422 metadata_unremovable)。印が無ければそのまま |
| 6 | 保存した大きさ・ハッシュ | IMPLEMENTED | 除いた後のファイルのもの。B |

## V2 の CI の e2e が1回目に落ちた2件(再実行で合格した「不安定」)

### 1. zz-security-challenge: 会員登録の後にダッシュボードへ移らない(100秒の時間切れ)

- 原因(製品の不具合): 画面は計算の確認(428)を1回だけ解いて送り直していた。問題を出した後、送り直すまでに接続元の点数が上がると
  (遅い CI では解く間に同じ接続元の別の要求が出る)、サーバーは「問題が易しすぎる」(too_easy)と新しい問題を返す。画面はそこで諦め、
  登録が失敗になっていた(点数が少し高い本物の利用者でも起こりうる)。解く間に問題の期限(120秒)が切れた時も同じ。
- 修正: 新しい問題が返ったら、合計3回まで解き直す(`services/api/core.ts` MAX_CHALLENGE_ATTEMPTS)。同じ問題が返った時は解き直さない。
  試験の下準備の `e2e/support/challenge.ts` も同じ。U `core.challenge.test.ts`(解き直して通る・3回で止まる・同じ問題で止まる)。
- 再現: zz の会員登録で、解を付けた送り直しの直前に試験から点数を30上げる(必ず too_easy になる)。直す前の画面のビルドで CI と同じ
  「waitForURL 100秒の時間切れ」で落ち、直した後は 428 → 428 → 200 で通ることを確かめた。

### 2. booklet-image: axe のコントラスト違反(「画像を保存」のボタン)

- 原因(試験): ボタンの色の切り替え(transition 200ms)の途中で axe が判定した。E1 で共通の `support/axe.ts` に入れた待ち合わせ
  (settleForAxe: マウスを外し、アニメーションの終わりを待つ)を、自前で AxeBuilder を使う 22 本の spec が通っていなかった。
- 修正: 22 本(24 か所)の判定の直前に settleForAxe を入れた。漏れを vitest `src/e2eAxeGuard.test.ts` で検出する。
- 再現: アニメーションを 1/10 の速さにすると、待ち合わせが無い判定は CI と同じ要素・同じ違反で落ち、入れると通ることを確かめた。
