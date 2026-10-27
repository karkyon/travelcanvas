# ADR: デザインの決まり(design tokens)と面(surface)の4種類(UX-1)

- 状態: 採用(Gate G9)
- 関連: 再監査報告書 §8「Cinematic Travel Workspace」、DOC-08 §2(Tailwind CSS + tokens)、DOC-10 UX品質Gate
- トレーサビリティ: `docs/trace/gate-g8-trace.md` の G9 の節、`docs/ux/UX-0_baseline.md`

## 1. 背景

画面ごとに Tailwind の色(gray-400 など)を直に書いており、コントラストの不足(axe の color-contrast)が画面を足すたびに
見つかっていた。見た目を一段上げる改修(UX-2 以降: 旅行の表紙・すりガラスの面・地図を背景にした当日の画面)の前に、
値を1か所に決め、読みやすさを機械で確かめられるようにする。

## 2. 決定

- 正本は `frontend/src/styles/tokens.ts`。同じ値を `tokens.css` の CSS 変数(`--tc-*`)に置き、試験
  (`tokens.test.ts`)で一致を確かめる。Tailwind からは `@theme inline` で `tc-*` の名前で使える。
- 色は Ink(文字)・Cloud(地)・Sand(温かい地)・Mist(冷たい地)と、旅行ごとの強調色1色。状態(成功・注意・危険・情報)は
  装飾の色と分け、必ず文字やアイコンと一緒に使う。決めた文字と地の組み合わせ(`TEXT_PAIRS`)は全て WCAG 2.1 AA
  (本文 4.5:1、フォーカスの枠 3:1)を満たすことを試験で確かめる。
- 旅行の表紙から取った強調色は `safeAccent()` で白い地の上で 4.5:1 以上になるまで暗くする(形が違えば既定の色)。
- 面は **glass・solid・quiet・critical の4つだけ**(`components/design/Surface.tsx`)。glass(すりガラス)は見出しの帯・
  旅行の切り替え・NOW/NEXT・浮かぶ操作だけに使い、フォーム・表・チケット・警告・長文は solid。glass の上に glass を
  重ねない(CSS で中の glass を solid にする)。
- すりガラスを使えない環境(backdrop-filter 未対応・透明を減らす設定・強制の色)では不透明の面に落とす。動きは
  150〜220ms で状態の変化を伝えるだけ。動きを減らす設定では止める。
- 暗い見た目は `data-theme="dark"` の中だけ(UX-8 で全体へ広げるまで、今の画面には当てない)。
- 一覧は `/design-system`(Storybook の代わり。ログイン不要・利用者のデータを含まない)。E2E で明るい・暗いの両方に
  axe をかける。

## 3. 採らなかった案

| 案 | 理由 |
|---|---|
| Storybook を入れる | 依存と CI の時間が増える。部品の数が少ないうちは1画面の一覧と E2E の axe で足りる |
| 今の画面の色を一度に置き換える | 見た目の変化が大きく、壊れた所を見分けられない。UX-0 の記録と比べながら UX-6 で順に置き換える |
| 暗い見た目を今すぐ全体に当てる | 今の画面は Tailwind の色を直に使っており、暗い地で読めない所が残る |

## 4. 未実装・制約

- 既存の Card・Button などは今の見た目のまま(UX-6 で置き換える)。
- 表紙の写真からの色の抽出は UX-2(旅行の表紙)で行う。
