# FR-059 旅程相談 API の原価上限(1旅行 50円)と利用者クラス別 Quota(正本)

> 文書ID: SPEC-FR059 / 版: **v5.1-p3**(policy version `2026-10-29.1`・会員の機能クラス `2026-10-31.1`) / 状態: APPROVED(利用者の明示の要件。再承認を求めない)・**サーバー側の守りは Gate FR059-B で実装(fake provider で検証。有料の provider は未接続)** /
> 改訂日: 2026-10-29  
> 出典: 資料室の `TravelCanvas_v5.1_仕様追補_旅程API原価上限と利用者クラス別Quota_2026-10-29.md`(以下「追補」)を、
> 決定・数値を変えずにリポジトリの正本へ移した。追補と違う所は §13 に全て挙げる(無断の差異を作らない)。  
> **正本の関係:** この範囲(外部 API の原価上限・利用者クラス・使用量の台帳)では、本書が資料室の DOC-02・DOC-04・DOC-05・
> DOC-06・DOC-07・DOC-09・DOC-11・DOC-13 の該当箇所より優先する(§12 が各文書への差分)。実装の状態は DOC-10(`fr-status.json`)
> の FR-059 が正本。

## 0. 要約

- TravelCanvas が旅行計画(`plan_id`)1つのために外部の**課金される** API へ出す要求の原価を、**全ての provider の合計で 50円以下**に
  抑える。50円は目安ではなく、provider へ要求を送る前にサーバーが強制する上限(hard cap)。
- 利用者クラス(Free・Trip Pass・Plus・Family/Group・Pro/B2B・Guest)ごとに、旅行の数・月の合計・呼び出しの回数を決める。
  クラスを上げても 1旅行 50円は増えない。
- **[Gate FR059-Tiers 2026-10-31]** 会員の機能クラス **Free / Trip / Journey / Explorer** を実装した(§3.2〜§3.5)。
  新しい Free は外部の AI・有料の検索を含まない。価格・販売・決済は FR-058 のまま未決定(この版では課金しない)。
- 有料の provider は、本書の Gate B(サーバー側の予約・確定・解放・クラス別 quota・価格台帳・監査・停止・手動の代替)が CI に合格して
  main に入るまで**つながない**。価格が分からない provider は呼ばない(fail closed)。
- 「旅行の予算」(宿・交通・食事など旅行そのものの費用。FR-027)と「この旅行の AI・外部検索の利用枠」(本書)を混ぜない。

## 1. 用語(DOC-13 への追加)

| 用語 | 定義 |
|---|---|
| 利用者クラス(UsageClass) | Free・Trip Pass・Plus・Family/Group・Pro/B2B・Guest。販売・機能のまとまり。認証の role(owner/editor/viewer/guest)とは別 |
| Entitlement | 対象(user・plan・organization)と機能(feature_key)に対する、期間・quota・出典つきの利用の許可。サーバーが強制する |
| 計画のまとまり(Planning session) | 1つの `plan_id` の中の AI 相談・候補の検索・旅程の生成。画面の再読み込みで枠は戻らない |
| 原価の予約(Cost reservation) | provider を呼ぶ前に、その操作の最大の見込み額を plan・月の枠から原子的に押さえる記録 |
| 確定した使用(Settled usage) | 成功・失敗の結果と見込み額を確定した記録。後から届く請求の明細で actual を照合する |
| 支払う人(Billable owner) | その旅行の外部 API の枠を使う人。初版は旅行の所有者(§4.2) |
| 価格の版(Price profile) | provider・操作ごとの単価・通貨・為替・税と請求差の係数・予備率の不変の版 |

## 2. 上限の値と計算(policy `2026-10-29.1`)

### 2.1 目標値

| 指標 | 値 |
|---|---:|
| 1旅行の最大の見込み額(税・予備率込み) | **50円** |
| 通常の目標 | 10円ほど、原則 30円以下 |
| 利用者への警告 | **40円(80%)** から |
| 運用の注意(alert) | 45円 |
| 呼び出しの停止 | `確定 + 予約中 + 今回の最大見込み > 上限` になる時、provider へ送る前に拒否。**ちょうど 50円は許可**(以下・`<=`) |
| 無料枠 | 実際の請求を下げるのに使ってよいが、上限の計算の前提にしない(無料枠が無い単価で計算する) |
| 単位 | `plan_id`。クラス・利用者・provider も記録する |

### 2.2 初期の価格の版(provider の公開単価、2026-10-29 確認。保証ではない)

円への換算: **1 USD = 180円 × 税・請求差 1.10 × 予備率 1.15**(= 1 USD あたり 227.7円)。金額は内部で Decimal(小数 4 桁)、
利用者への表示は円の切り上げ。浮動小数点で円を計算しない。

| 操作(operation) | 1旅行の上限 | 単価(無料枠なし) | 上限まで使った時の USD |
|---|---:|---|---:|
| `ai.generate`(AI の呼び出し。入力 10,000 token・出力 2,000 token まで) | 5回 | 入力 $0.10/M、出力 $0.50/M | $0.0100 |
| `ai.web_search`(検索 1回の結果は入力 8,000 token まで予算化) | 2回 | $10/1,000回 + 入力 token | $0.0216 |
| `places.search`(Nearby/Text) | 3回 | $35/1,000回 | $0.1050 |
| `places.details` | 2回 | $20/1,000回 | $0.0400 |
| `places.photo` | 2回 | $7/1,000回 | $0.0140 |
| `routes.element`(Routes・Route Matrix の課金単位) | 4単位 | $5/1,000単位 | $0.0200 |
| `map.load`(Dynamic Map) | 1回 | $7/1,000回 | $0.0070 |
| **合計** | | | **$0.2176** |

検算: `$0.2176 × 180 × 1.10 × 1.15 = 49.55円 ≤ 50円`(全ての上限を同時に使っても 50円以内)。価格の版を変える時は、同じ計算を
試験(`test_price_profile_fits_cap`)で再び確かめ、50円を越える版は有効にしない。field mask などで単価の高い SKU になる要求は送らない。

#### 2.2.1 公開の単価の再確認(2026-10-31、Gate FR059-D11。価格の版は変えない)

価格の版 `2026-10-29.1` の単価が、今の公開の単価**以上**(= 見込みが実際より高めで、50円の枠が甘くならない)かを確かめた。
単価は保証ではなく、provider が変える。接続(adapter)の Gate の前に、もう一度この表を確かめる。

| 操作 | 版の単価 | 2026-10-31 の公開の単価 | 判定 | 出典 |
|---|---|---|---|---|
| `ai.generate` | 入力 $0.10/M・出力 $0.50/M | 例: gpt-5-nano 入力 $0.05/M・出力 $0.40/M | 版のほうが高い(安全側)。**使う model は未決定**。推論の token は出力として課金されるため、出力の上限 2,000 token に推論も含めて制限する | developers.openai.com/api/docs/models/gpt-5-nano |
| `ai.web_search` | $10/1,000回 + 入力 token | $10/1,000回、検索で得た内容の token は model の単価で課金 | 同じ | developers.openai.com/api/docs/pricing(2026-10-26 に第三者が読んだ記録で確認。公式のページはこちらから直接は読めなかった) |
| `places.search` | $35/1,000回 | Nearby Search Pro・Text Search Pro $32/1,000回 | 版のほうが高い。Enterprise の項目(評価・営業時間など)を field mask に入れると高い SKU になるため、版を変えずに入れない | developers.google.com/maps/billing-and-pricing/pricing |
| `places.details` | $20/1,000回 | Essentials $5・Pro $17・Enterprise $20 | 同じ(Enterprise で計算) | 同上 |
| `places.photo` | $7/1,000回 | Place Details Photos $7 | 同じ | 同上 |
| `routes.element` | $5/1,000単位 | Compute Routes / Route Matrix Essentials $5、Pro $10 | Essentials だけ。交通を考える経路(Pro)は単価が2倍のため、版を変えずに使わない | 同上 |
| `map.load` | $7/1,000回 | Dynamic Maps $7 | 同じ。ただし今のアプリの画面は Google Maps を読み込まない | 同上 |

無料の月の枠(Essentials 10,000・Pro 5,000・Enterprise 1,000)は、上の規則どおり上限の計算の前提にしない。

### 2.3 呼び出しの規則

- 1文字ごとの自動の検索・裏での繰り返し・自動の再試行による二重の課金をしない。呼び出しは利用者の明示の操作(「候補を作る」
  「この方面を調べる」「旅程を作る」「もう一度探す」)だけに結びつける。
- 同じ操作の再送は `Idempotency-Key` で同じ予約を返し、provider へ二度送らない。
- provider の障害の再試行は**1回まで**(同じ予約の中。二重の課金の可能性がある時は再送しない)。
- token・検索の回数・地点の数・写真の数・route の要素の数は、要求の前に上限を確かめる。結果の続きを操作なしに取りに行かない。
- 無料の provider(Wikimedia Commons・SNS の oEmbed・OpenStreetMap の Nominatim/Overpass)・ローカルの処理も使用の記録を残す
  (将来の有料の provider への切り替えで制御が抜けないように)。無料の終わりに自動で有料へ切り替えない。
- 単価・通貨・SKU・換算の係数が分からない時は呼ばない(`503 COST_PROFILE_UNAVAILABLE`)。結果の token 数を制限・計測できない
  機能(制限の無い Web 検索など)は 50円の枠に入れられないので使わない。
- provider の契約が許す範囲でだけ結果を再利用する(Google Maps Platform などキャッシュを制限する規約に反して保存しない)。

## 3. 利用者クラス別の設定

| クラス | 旅程相談の API | 1旅行の上限 | 月の上限 | 旅行の数/月 | 規則 |
|---|---|---:|---:|---:|---|
| Guest / Anonymous | 外部 AI・有料 provider を呼ばない(手入力・共有の閲覧) | 0円 | 0円 | 0 | 公開・ゲストの閲覧から呼び出しを起こさない |
| Free | 月 1旅行まで | 50円 | 50円 | 1 | AI 5回・Web 検索 2回と §2.2 の全体の上限 |
| Trip Pass | 購入した1旅行に適用 | 50円 | (その旅行だけ) | 対象の1旅行 | Pass を旅行へ1度だけ割り当てる。期限・返金・再割り当ては決済の仕様(FR-058)に従う |
| Plus | 月 5旅行まで | 50円 | 250円 | 5 | 旅行ごと 50円と月の合計を同時に適用 |
| Family / Group | 家族・グループの共同の旅行 | 50円/旅行 | 支払う人の月の枠 | 支払う人の枠 | **人数で枠を増やさない**。全員の呼び出しを同じ旅行の台帳に集める |
| Pro / B2B | 契約の機能・組織の枠 | 既定 50円 | 契約で決める(既定 0 = 契約の付与まで呼ばない) | 契約 | 50円を越える旅行の枠は、契約・組織の管理者の設定・二者の承認・監査が全て揃う時だけ別の版で許す |
| Admin / Support | 割り当てられたクラスと同じ | 50円 | 割り当てと同じ | 割り当てと同じ | サポートの権限だけで枠を増やさない。試験は fake provider |

Family / Group の月の上限・旅行の数は追補に数値が無いため、初版は **Plus と同じ 250円・5旅行**とする(§13 の差異 D3)。

> **2026-10-31 以降の Free は §3.2 の Free(AI なし・有料の検索なし)。** 上の表の Free の行(AI 5回・月1旅行)は policy
> `2026-10-29.1` の記録で、migration `a1d3f5b7c9e2` で retired にした(行は残す。以前の予約の確定は版で引く)。

### 3.2 会員の機能クラス Free / Trip / Journey / Explorer(policy `2026-10-31.1`、Gate FR059-Tiers)

利用者の指示(2026-10-31「4クラス実装・本日テスト一括指示」)で、提案の4段階を実装した。`jaurny` は誤記で `journey`。
4つのクラスは**外部の有料 API・AI をどこまで使うかの段階**で、旅行の日数(日帰り・長期)の種類ではない(日数は旅行のデータ)。
`trip` は1回の旅、`journey` は一連の旅程・過程、`explorer` は探索する人。旅行の中の権限(owner/editor/viewer/guest)・認証の
ゲスト・Family/Group の共同利用・Pro/B2B の契約・Trip Pass とは別の Entitlement(`trip_planning.class.<free|trip|journey|explorer>`)。

| クラス | 日本語の副題 | 含む有料の操作(この外はサーバーが provider の前で 403 `tier_feature_not_included`) | 1旅行 | 月の上限 | 旅行/月 |
|---|---|---|---:|---:|---:|
| **Free** | 自分でつくる | なし(手入力・保存・無料の地図と検索だけ。0円) | 50円(使わない) | なし | なし |
| **Trip** | 行先を見つける | 場所の検索・詳細・写真・経路・地図。**AI なし** | 50円 | 150円 | 5 |
| **Journey** | 計画を一緒に考える | Trip + AI の案の作成(制限つき)。**Web 検索なし** | 50円 | 150円 | 5 |
| **Explorer** | 比較して深掘りする | Journey + AI の Web 検索(追加の調査) | 50円 | 250円 | 5 |

機械が読む正本は `backend/app/services/membership_tiers.py`(含む操作・回数・機能の表・移行の表)と `usage_policy_profiles` の
版 `2026-10-31.1`。両者の一致は `backend/tests/test_gate_fr059_tiers.py::test_policy_profiles_match_machine_readable_policy` が
確かめる。**価格は設定しない**(FR-058)。付与は管理者の二者の承認、または開発環境だけの試験の切り替え(§3.5)。

### 3.3 回数の上限と検算(価格の版の単価は §2.2 と同じ。円 = USD × 180 × 1.10 × 1.15 = 227.7)

| feature | Free | Trip | Journey | Explorer | 1回の額(円) |
|---|---:|---:|---:|---:|---:|
| `ai_calls_per_plan`(10,000 / 2,000 token まで) | 0 | 0 | 3 | 5 | 0.4554 |
| `web_searches_per_plan` | 0 | 0 | 0 | 2 | 2.4592 |
| `places_searches_per_plan` | 0 | 2 | 2 | 3 | 7.9695 |
| `place_details_per_plan` | 0 | 1 | 1 | 2 | 4.5540 |
| `photos_per_plan` | 0 | 1 | 1 | 2 | 1.5939 |
| `route_elements_per_plan` | 0 | 4 | 4 | 4 | 1.1385 |
| `dynamic_map_loads_per_plan` | 0 | 1 | 1 | 1 | 1.5939 |
| **全ての上限を同時に使った額** | **0円** | **28.23円** | **29.60円** | **49.55円** | |
| 月の旅行の数 × その額 | — | 141.2円 ≤ 150円 | 148.0円 ≤ 150円 | 247.7円 ≤ 250円 | |

Trip・Journey は §2.1 の「原則 30円以下」に収め、Explorer は以前の全体の上限(49.55円)と同じ。月の上限は「月の旅行の数を全て
上限まで使っても越えない」額にした(数値の無い枠を作らない。変える時は新しい版と同じ PR で本書を直す)。

### 3.4 共通の規則(全てのクラス)

- 1旅行の有料の原価は **50円まで**(上のクラスでも越えない)。40円(80%)で利用者の警告、45円(90%)で運用の知らせ、
  確定 + 予約中 + 今回の見込みが 50円を越える要求は provider へ送る前に断る(ちょうど 50円は許可)。
- 無料の提供元(OpenStreetMap・Wikipedia など)は 0円の送信の回数として別に記録する(D11)。無料から有料へ自動で切り替えない。
- クラスに含まない操作は**口座も予約も作らずに**断る(`tier_feature_not_included`、本文に `included_from`・`fallbacks`)。
  手での編集・保存した候補・公式サイトの確認で続けられると案内する。
- 解決の順: Guest → 旅行の Trip Pass → Pro の契約 > **Explorer > Journey > Trip** > Plus > Family > Free(既定)。
  同じ feature の quota を足し合わせない。共同編集の人の呼び出しも所有者(支払う人)のクラス・旅行の台帳で数える。
- 機能の表(画面・運用コンソールの「会員クラス」)のうち、サーバーが断るのは有料の API・AI の操作。保存の数・オフライン・
  書き出しの △ は**既存の機能の上限のまま**(クラス別の制限は未実装と表に書く)。予約・決済・会員の販売は全てのクラスで —(FR-058)。

### 3.5 旧クラスからの移行・付与・試験の切り替え

| 現行の概念 | 新しいモデルでの扱い |
|---|---|
| Guest / Anonymous | 認証・一時利用の主体として維持(0円)。Free とは別。新しいクラスを付けても Guest |
| Free(2026-10-29.1: AI 5回・月1旅行) | 新しい Free(AI なし・有料の検索なし)。付与の無い会員は全員これ。以前の版の記録は版のまま |
| Trip Pass | 旅行への割り当てとして維持(その旅行だけ以前の枠)。販売は FR-058 まで無効 |
| Plus | 付与は残し、以前の枠のまま。Journey・Explorer へは**一律に変えない**(管理者が新しいクラスを付けた時だけ) |
| Family / Group | 支払う人の枠として維持。人数で API の枠を増やさない |
| Pro / B2B | 契約の付与として維持。契約の枠が無い間は 0円(fail closed)。Explorer へ自動で変えない |
| Admin / Support | 権限の役割。管理者であることは有料の機能を使う根拠にしない |
| owner / editor / viewer / guest | 旅行の中のデータの権限。クラスと別に両方を確かめる |

- 正式な付与: `POST /admin/entitlements`(`trip_planning.class.trip|journey|explorer`)→ 別の管理者が承認(二者の承認・理由・監査)。
- 開発環境の試験: `POST /admin/ops/test-tier`(管理者 + 多要素認証・理由が必須・**24時間で切れる**・監査 `ops_test_tier_switched`・
  以前の試験の付与だけを取り消す・本番/staging は 403 `test_tier_disabled`)。正式な付与は消さない(優先される時はそう表示)。
- 運用コンソール `GET /admin/ops/tiers`: クラスの比較(価格の版から読む最大の見込み額・50円以内か)・機能の表・移行の表・閾値。
- Fake の家族旅行の試験 `POST /admin/ops/test-runs/family-fake` は `tier` を選べる(既定 Explorer)。外部への送信 0回。
- rollback: migration `a1d3f5b7c9e2` の downgrade で 2026-10-31.1 の行を消し、以前の Free を active に戻す(付与・記録は消さない)。

### 3.1 feature key(quota は整数。単位と期間は key で固定)

| feature_key | 単位 | 初期値 |
|---|---|---|
| `trip_planning.class.<free|trip|journey|explorer|trip_pass|plus|family|pro>` | クラスの付与(quota なし) | — |
| `trip_planning.plans_per_month` | 旅行/月 | Free 1・Plus 5・Family 5・Pro 契約 |
| `trip_planning.cost_jpy_per_plan` | 円/旅行 | 50 |
| `trip_planning.cost_jpy_per_month` | 円/月 | Free 50・Plus 250・Family 250・Pro 契約 |
| `trip_planning.ai_calls_per_plan` | 回/旅行 | 5 |
| `trip_planning.ai_input_tokens_per_call` | token/回 | 10,000 |
| `trip_planning.ai_output_tokens_per_call` | token/回 | 2,000 |
| `trip_planning.web_searches_per_plan` | 回/旅行 | 2 |
| `trip_planning.places_searches_per_plan` | 回/旅行 | 3 |
| `trip_planning.place_details_per_plan` | 件/旅行 | 2 |
| `trip_planning.photos_per_plan` | 回/旅行 | 2 |
| `trip_planning.route_elements_per_plan` | 単位/旅行 | 4 |
| `trip_planning.dynamic_map_loads_per_plan` | 回/旅行 | 1 |

上限の値は要求の本文から受け取らない。サーバーの policy(`usage_policy_profiles`)と有効な entitlement から決める。

## 4. クラスの決め方・支払う人(サーバーが唯一の権威)

### 4.1 クラスの解決

1. 呼び出した人がゲスト(`user_type=guest`)なら Guest(0円)。旅行の所有者がゲストの時も Guest。
2. 旅行に有効な `trip_planning.class.trip_pass`(subject=plan)があれば Trip Pass(その旅行だけ。月の枠を使わない)。
3. それ以外は、支払う人の有効な `trip_planning.class.*`(subject=user)のうち最も有利な1つ(Pro > Plus > Family > Free)。
   付与が無い会員は Free。**同じ feature の quota を足し合わせない**。どれを使ったかは予約・使用の記録に固定する。
4. `user_type` や画面の値は quota の根拠にしない。`GET /entitlements` の応答を書き換えても、変更の操作はサーバーで断られる。

### 4.2 支払う人と権限

- 初版の支払う人は**旅行の所有者**(`travel_plans.user_id`)。「指定した支払う人」は決済(FR-058)と一緒に足す(§13 の差異 D4)。
- 共同編集の人が呼び出しても、所有者の枠・その旅行の台帳を使う。メンバーの枠を足して旅行の上限を増やさない。
- 権限(editor 以上)と entitlement を別々に確かめる。権限だけでは枠を得ない。閲覧の人・共有の閲覧・ゲストは呼び出せない。

## 5. 1つの操作の流れ

1. 認証・旅行への権限(editor 以上)・個人情報の規則を確かめる。
2. クラス(§4)と、旅行の口座・月の口座の残りを読む(期限の切れた予約は先に解放する)。
3. 価格の版から、その操作の**最大の見込み額**を計算する(単価・token の上限・件数)。分からなければ `503 COST_PROFILE_UNAVAILABLE`。
4. 月の口座 → 旅行の口座の順に行を `SELECT … FOR UPDATE` で押さえ、次を全て満たす時だけ予約を作る(同時の要求は1つずつ):
   - `旅行の確定 + 旅行の予約中 + 今回 <= 旅行の上限`(`429 PLAN_COST_LIMIT_REACHED`)
   - `月の確定 + 月の予約中 + 今回 <= 月の上限`(`429 MONTHLY_QUOTA_EXCEEDED`)
   - 旅行を今月はじめて使う時、`今月の旅行の数 < 旅行の数の上限`(`429 MONTHLY_PLAN_QUOTA_EXCEEDED`)
   - 回数・token・件数の quota に残りがある(`429 FEATURE_QUOTA_EXCEEDED`)
5. 予約を commit してから provider を呼ぶ(ネットワークの待ちの間に行を押さえない)。
6. 成功・失敗・時間切れ・一部の応答を使用の記録にし、予約を**確定**(実際の単位で計算した額。最大見込みを越えない)か**解放**する。
   確定・解放は冪等(同じ予約を二度確定しない)。期限(既定 10分)を過ぎた予約は解放する。
7. 後から届く請求の明細は actual として足す(差が 1円または 10% の大きい方を越えたら alert し、その provider を止める)。
   使用の記録に、入力の文章・旅程の全文・検索の結果・API の鍵を残さない。

## 6. 画面

- 旅程相談(`/trip-consult`)・旅程の下書き(`/planner/{id}/draft`)・旅程の画面に「この旅行の AI・外部検索の利用枠 **0円 / 50円**」を
  旅行の予算とは別に出す。円の切り上げ。「旅行の費用には足しません」と添える。
- 80%(40円)からは「残りが少ない」と、次の操作の最大額と残りを操作の前に出す。
- 止まった時は、何が止まったか・作った案と予定は残っていること・手で続ける方法(手で編集・保存した候補・公式サイトの確認)を同じ所に出す。
- provider がつながっていない間は「外部の有料の提供元は未接続(0円)」と出す。値を作らない。
- provider の名前・内部の単価は全員には見せない(枠の金額と、主な呼び出しの種類だけ)。
- 管理の画面: 利用者・旅行のクラス・付与の出典・期間・policy の版、旅行・月の予約/確定/残り、拒否の数、provider 別の内訳、
  上書きの申請者・承認者・理由・期限。上限の引き上げ(クラスの付与・契約の例外)は**再認証(管理者の MFA の確認)・理由・二者の承認**
  (申請した管理者と別の管理者が承認)が要る。サポートの担当は利用者の枠を直接増やせない。

## 7. データ(DOC-05 への追加。migration は Gate B)

| 表 | 主な列 | 目的・制約 |
|---|---|---|
| `entitlements` | `subject_type(user/plan/organization)`・`subject_id`・`feature_key`・`status(active/pending/revoked)`・`quota`・`starts_at`・`ends_at`・`source(default/admin/contract/trip_pass/subscription)`・`reason`・`requested_by`・`approved_by`・`approved_at` | クラスの付与と quota の上書き。pending は承認まで効かない。`requested_by ≠ approved_by` |
| `usage_policy_profiles` | `profile_key`・`version`・`currency`・`plan_cap_jpy`・`monthly_cap_jpy`・`plans_per_month`・`feature_quotas`・`fx_rate`・`tax_factor`・`safety_factor`・`provider_price_snapshot`・`status`・`effective_at` | 版ごとに不変。変更は新しい版。unique(profile_key, version) |
| `usage_budget_accounts` | `scope_type(plan/user/organization)`・`scope_id`・`period_key`(旅行は `plan`、月は `YYYY-MM`)・`policy_version`・`profile_key`・`cap_jpy`・`reserved_jpy`・`settled_jpy`・`plans_used`・`counted_month`(旅行を月の数に入れた月)・`counts`・`revision` | 残りを原子的に管理。unique(scope_type, scope_id, period_key)。`reserved_jpy`・`settled_jpy` は 0 以上(CHECK) |
| `provider_usage_reservations` | `idempotency_key`・`user_id`・`billable_owner_user_id`・`plan_id`・`organization_id`・`provider`・`operation`・`units`・`counts`・`max_cost_jpy`・`status(reserved/settled/released)`・`profile_key`・`policy_version`・`plan_account_id`・`monthly_account_id`・`expires_at`・`finished_at` | unique(user_id, idempotency_key)。二重の予約を防ぐ |
| `provider_usage_events` | `reservation_id`・`user_id`・`plan_id`・`organization_id`・`class_snapshot`・`provider`・`model`・`sku`・`operation`・`input_tokens`・`output_tokens`・`request_count`・`matrix_elements`・`raw_cost`・`raw_currency`・`fx_rate`・`tax_factor`・`estimated_cost_jpy`・`actual_cost_jpy`・`price_version`・`result_code`・`occurred_at` | 原価・失敗・照合の最小の情報。入力の文章・鍵は保存しない |

金額の列は `NUMERIC(12,4)`。利用者の削除では `user_id`・`billable_owner_user_id` を NULL にし(会計の整合は残す)、旅行の削除では
`plan_id` を NULL にする(口座の `scope_id` は旅行への外部キーを持たない)。既存の BILL-02(`usage_counters`。アップロードの量など)は
別の上限としてそのまま残す。

## 8. API(DOC-06 への追加。全て `/api/v1`)

| Method / Path | 用途 | 成功 | 主なエラー |
|---|---|---|---|
| `GET /entitlements` | 自分のクラス・policy の版・feature・quota・今月の使用・リセットの日 | 200 | 401 |
| `GET /plans/{id}/planning-usage` | 旅行の上限・確定・予約中・残り、月の残り、回数の残り、警告・停止の理由、provider の接続の状態 | 200 | 401/403/404 |
| `POST /plans/{id}/planning-actions/estimate` | 操作の最大の見込み額(provider を呼ばない) | 200 `{action, max_cost_jpy, remaining_after_jpy, allowed, reason}` | 403/404/422 |
| `GET /admin/entitlements`・`POST /admin/entitlements`・`POST /admin/entitlements/{id}/approve`・`POST /admin/entitlements/{id}/revoke` | クラスの付与・quota の例外(二者の承認) | 200/201 | 403/409/422 |
| `GET /admin/planning-usage?plan_id=` | 旅行の口座・予約・使用の内訳(provider 別) | 200 | 403 |
| 外部の有料 provider を使う操作 | 中で 予約 → 呼び出し → 確定/解放 | 応答に `usage{plan_used_jpy, plan_remaining_jpy, policy_version}` | 429 `PLAN_COST_LIMIT_REACHED`・`MONTHLY_QUOTA_EXCEEDED`・`MONTHLY_PLAN_QUOTA_EXCEEDED`・`FEATURE_QUOTA_EXCEEDED`、403 `GUEST_PROVIDER_FORBIDDEN`、503 `COST_PROFILE_UNAVAILABLE` |

追補の `planning-actions:estimate` は、FastAPI の経路の書き方に合わせて `planning-actions/estimate` とした(§13 の差異 D5)。
金額は `"12.0000"` の文字列 + `currency: "JPY"`、表示用に `*_yen_ceil`(整数)を添える。上限・クラス・provider は要求から受け取らない。
429 には `fallbacks: ["USE_SAVED_CANDIDATES", "CONTINUE_MANUALLY"]`、月の上限の時は `Retry-After`(翌月の始まりまでの秒)を付ける。

## 9. 運用(DOC-07 への追加)

- 集計: user・plan・organization・provider・model・SKU・policy の版。
- 指標: `provider_usage_estimated_jpy`・`provider_usage_actual_jpy`・`provider_usage_reserved_jpy`・`provider_usage_denied_total`・
  `provider_usage_retry_total`・`provider_quota_remaining`・`provider_cost_reconciliation_delta_jpy`。
- ログ: request_id・plan_id・policy の版・操作・provider・SKU・見込み・実際・結果だけ(入力・個人情報・token の本文・鍵を出さない)。
- 40円で利用者への警告、45円で運用の alert、50円を越える見込みは拒否。請求の明細との照合は日次(差が大きい provider は止める)。
- 価格の変更は新しい版を作り、§2.2 の検算を試験で通してから有効にする。
- 鍵は環境・用途ごとに分ける。開発・CI は fake provider。実際の鍵の試験は予算・期限・責任者を決めた専用の project で行う。
  鍵を他のアプリ・手の試験と共有する間は、50円以内の実請求を保証すると表示しない。
- クラウドの予算の通知だけを上限の強制とみなさない(アプリの中の予約と quota が必須)。

## 10. セキュリティ・プライバシー(DOC-11 への追加)

- 鍵は Secret Manager か追跡しない設定に置き、画面の bundle・使用の記録・ログ・issue・CI の成果物に出さない。
- 旅券・予約番号・連絡先・健康の情報は標準の AI 旅程相談へ送らない(RESTRICTED の項目は除くか、明示の同意で伏せる)。
- グループの旅行では、誰が呼び出し・どの旅行の枠を使うかを示し、支払う人の枠を越えて課金しない。
- 枠を上げる権限と旅程を見る権限を分ける。共有先・ゲストは内部の単価・請求を見ない。
- 価格・利用条件・データの保持を示せない provider には本番のデータを渡さない。

## 11. 受入条件・Gate(DOC-09・DOC-10 への追加)

| ID | 内容 | 初期の状態 |
|---|---|---|
| FR-059 | 旅程相談の 1旅行 50円の原価上限・原子的な予約・超えた時の代替・利用者クラス別 quota | SPECIFIED(Gate A) |
| FC-181 | クラス別の entitlement の解決・月の quota | SPECIFIED |
| FC-182 | 旅行単位の見込み・予約・確定・解放と冪等 | SPECIFIED |
| FC-183 | provider・model・SKU・token・route の要素ごとの使用の台帳 | SPECIFIED |
| FC-184 | 50円に達した時の停止・手動の代替・データの保持(画面) | SPECIFIED |
| FC-185 | 管理の画面のクラス・上書き・費用の監査 | SPECIFIED |

**FR-058 との関係:** FR-058(Entitlement・料金)は「価格・支払い(決済)」の製品判断を待つ FR で、状態は SPECIFIED のまま。
原価上限は利用者が既に決めた要件で、有料の provider をつなぐ前に必ず要るため、FR-058 の中に入れると状態が決済の判断に縛られる。
そこで**新しい FR-059**として独立させ、FR-058 の gaps から FR-059 を参照する(追補 §10.1 の「FR-058 extension」の範囲のうち、
クラスの解決・quota の強制・使用の台帳は FR-059 で実装し、購入・返金・請求は FR-058 に残す)。

Gate の順(DOC-09): **Gate A**(本書・DOC-10 の登録。docs だけ)→ **Gate B**(サーバー側の原価の守り。fake provider で全ての受入条件)
→ limit を強制した staging での実際の provider の確認 → 有料の provider の接続(MAP-P・AI)。G11-Media 等の既存の Gate へ暗黙に足さない。

受入条件(Gate B の試験):

1. Guest・Free・Trip Pass・Plus・Family/Group・Pro/B2B のクラスの表の試験が通る。
2. `user_type` を変えても・`GET /entitlements` の応答を書き換えても、サーバーは quota を増やさない。
3. 同じ旅行に複数のメンバーが同時に呼んでも、50円を越える呼び出しを出さない(予約は原子的で二重に使わない)。
4. 残り 12円に最大見込み 15円の操作は provider の前で断られ、例の 429 を返す。ちょうど 50円は許可される。
5. token・Web 検索・Places の検索/詳細/写真・route の要素・地図の読み込みの上限を越える要求は provider の前で断られる。
6. provider の時間切れ・再試行(1回まで)・同じ Idempotency-Key・一部の応答・単価の不明・SKU の変更・失敗の後の解放で、残りが負にならない。
7. Plus は 6つ目の旅行を断り、月が変わると再開する。Free は2つ目の旅行、Trip Pass は割り当てていない旅行・2つ目の旅行を断る。
8. Family/Group で4人でも旅行の枠は 50円(200円にならない)。月の枠は支払う人に集まる。
9. 40円の警告・50円の到達・未接続・保存した候補と手の編集で続けられることを画面で確かめる(E2E)。
10. 使用の記録に入力の文章・旅程の全文・鍵・予約の情報・秘匿の予算が無い(SEC の試験)。
11. 無料枠の有無に関わらず同じ 1旅行の上限を満たす価格の試験(§2.2 の検算)。
12. 実際の請求が見込みを上回った時の差の alert と provider の停止。

## 12. 各正本への差分(資料室の文書は本書を参照する)

| 正本 | 本書で変わる所 |
|---|---|
| DOC-02 要件定義 | FR-058 の範囲を「価格・決済」に絞り、FR-059 を追加(§0・§3・§11) |
| DOC-04 / DOC04-A 画面 | 旅程相談・下書き・旅程の利用枠の表示、80% の警告、停止と手動の代替、管理の画面(§6) |
| DOC-05 DB | §7 の5つの表、feature key、保持と削除 |
| DOC-06 API | §8 の API・エラーの code・冪等 |
| DOC-07 運用 | §9 の指標・alert・照合・価格の版・鍵の分離 |
| DOC-09 展開 | §11 の Gate の順(fake provider → staging → 有料 provider) |
| DOC-10 台帳 | FR-059 の登録(r27)、FR-058 の gaps |
| DOC-11 Security/Privacy | §10 |
| DOC-12 変更履歴 | 本書の版 v5.1-p1 を記録(資料室) |
| DOC-13 用語 | §1 |

既存の資料との重なり: DOC-07 §28 の一般的な Cost Guardrail(クラウドの費用の監視)は残し、旅行単位の上限は本書が正本。DOC-05 の
`entitlements` の設計は本書 §7 の列で実装する(`requested_by`・`approved_by`・`reason` を追加)。DOC-06 の `GET /v1/entitlements` は
本書 §8 の応答に拡張する。既存の BILL-02(G5 の `usage_counters`)は本書と別の上限。

## 13. 追補との差異(全て)

| # | 追補 | 本書 | 理由 |
|---|---|---|---|
| D1 | 状態「仕様決定案・承認後実装」 | APPROVED | 利用者が 50円の上限とクラス別の適用を明示した(2026-10-29) |
| D2 | `usage_budget_accounts` の `period_start/end` | `period_key`(`plan` / `YYYY-MM`) | 旅行の口座は期間が無く、unique 制約を NULL なしで作るため |
| D3 | Family/Group の月の枠の数値が無い | 初版 250円・5旅行(Plus と同じ) | 数値が無いと fail closed で使えない。変える時は policy の新しい版 |
| D4 | 支払う人に「明示した payer」を含む | 初版は旅行の所有者だけ | 支払う人の指定は決済(FR-058)と一緒に決める |
| D5 | `POST …/planning-actions:estimate` | `POST …/planning-actions/estimate` | 経路の書き方の統一 |
| D6 | Pro/B2B の月の枠は「契約で定義」 | 契約の付与が無い間は 0円(呼ばない) | 数値の無い枠は fail closed |
| D7 | 追補 §2.1 の「GPT-6 Luna 相当」 | 操作 `ai.generate` の単価として保持(モデル名は provider の版に書く) | provider に依存しない |
| D8 | Trip Pass は「未割当 plan を拒否」 | 割り当てていない旅行は、その利用者自身のクラス(会員は Free)で判定する | 会員は全員 Free を持つため。Pass の枠は割り当てた旅行にだけ使われる(試験 `test_trip_pass_only_for_assigned_plan`) |
| D9 | 月の口座の scope に organization | 初版は支払う人(利用者)の月の口座。組織でまとめる枠は FR-041・FR-058 と一緒に足す | 組織の契約・請求が未実装 |
| D10 | エラーの code は大文字(`PLAN_COST_LIMIT_REACHED` 等) | 小文字(`plan_cost_limit_reached` 等) | エラーの一覧(`docs/spec/error-catalog.md`)の生成の規則に合わせる |
| D11 | 無料の provider・ローカルの処理も使用を記録 | **Gate FR059-D11(2026-10-31)**: 無料の provider(Nominatim・Overpass・Wikipedia・Wikimedia Commons・oEmbed)へ外へ送った回数を `provider_usage_events` に 0円・価格の版 `free` で記録する(`app/services/free_usage.py`)。言葉・URL・座標・結果は残さない。旅行が分かる時は plan_id、相談の入口(旅行の前)は利用者だけ。記録の失敗で機能を止めない。運用コンソールの概要は「無料の提供元への送信」として有料の見込みと分けて出す | SNS の oEmbed の題名から地名を照合する Nominatim の呼び出し(`social.py` の中)は、oEmbed の1回に含めて別には数えない。ローカルの処理(画像の縮小など)は記録しない |
| D12 | — | 旅行を月の数に入れるのは、その月の最初の予約の時(失敗して解放しても戻さない) | 1回の失敗で何度も数え直す攻撃を防ぐ。数えた月は `counted_month` |
| D13 | — | 月の区切りは UTC(BILL-02 と同じ)。画面には次のリセットの日を UTC と書く | 既存の使用量と同じ |
| D15 | 提案(6.3・6.4)「4クラスは提案止まり」 | **実装した(Gate FR059-Tiers、2026-10-31)**。価格・販売・決済は持たない | 利用者が 2026-10-31 に実装を指示した(§3.2〜§3.5) |
| D14 | — | provider の停止(見込みの超過・照合の差)は Redis の印で全ての worker・運用のコマンドが共有する(回数制限と同じ名前空間)。Redis に届かない間はその process の中の印で止め、届いた時に Redis へ送る(止めた印を失わない)。戻すのは運用者の `tcops.py security provider-resume`(理由が必須・全 worker に伝えられない時は戻さない) | 有料の provider をつなぐ前に入れた(Gate FR059-C)。以前(FR059-B)は process の中の印だけで、止めた worker 以外は呼び続けた |
