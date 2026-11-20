# 製品固めゲート② 基準・現状表・課題台帳(2026-11-18)

> 基準: main `32c7db6ab12169dc05a9d5821d565f591714c0b4`(PR #127 のマージ)。計画書「TravelCanvas 製品固めゲート② 実旅行検証・使いやすさ改善計画 2026-11-18」と指示書に沿う。
> **これは実旅行の記録ではない。** 近場の日帰り・伊勢 1 泊 2 日は**未実施**(実施の記録は `docs/test/integrated-acceptance-scenarios.md` §8 の様式で別に残す)。
> 下の「根拠」が「コード」とあるものは、コードを読んで分かったこと。**迷い・使いにくさの原因はコードだけでは認定せず、実観察で確かめるまで仮説とする。**

## 1. 基準の記録(G2-00)

| 項目 | 値 | 確かめ方 |
|---|---|---|
| main の先頭 | `32c7db6`(`git rev-parse HEAD` が上の SHA。前回基準 `a2c419d` の後) | clone して確認 |
| open PR | 0 件 | GitHub REST(`pulls?state=open`) |
| CI #751(main) | e2e・frontend・dependency-audit・backend・secret-scan の 5 件とも success | GitHub REST(`commits/<sha>/check-runs`) |
| Alembic head | `d5e9f3a7b2c6`(単一。ローカルの試験 DB で `upgrade head` まで通った) | `alembic current` |
| FR | 60 件: VERIFIED 38 / INTEGRATED 22(うち(部分)16)/ RELEASED 0 | `docs/trace/fr-status.json` を数えた |
| omega-dev2 | **未確認**。`d5e9f3a7b2c6` 適用と 3 表の存在は利用者が確認済み(引き継ぎ資料)。`/ready` は `Connection reset`(起動中)で未確認 | 利用者の確認待ち: `curl -fsS http://127.0.0.1:8001/ready` で `migration_current` が true、`docker compose ps` で healthy |
| 実機・実 API・本番 | **未実施**(下の 5) | — |

## 2. 画面・経路の現状表(G2-02 の入口)

- 経路は `frontend/src/router/index.tsx`。ページの塊は 66、path の指定は 72(入れ子・別名・`*` を含む)。画面 ID と経路の対応は DOC-04 §19(SC-01〜50。試験が経路の実在を確かめる)。
- 計画書の「全 48 画面」は SC の数え方による。実装の塊の数とは違うので、表では経路で数える。

| 経路 | 画面 | 認証 | 帯(rail)で「今の画面」になる項目 | 画面 ID |
|---|---|---|---|---|
| `/` | LandingPage | 不要 | — | SC-01・02・33 |
| `/login` `/register` | Login/Register | 認証済みなら離れる | — | SC-03 |
| `/forgot-password` `/reset-password` `/verify-email` | AccountPages | 不要 | — | SC-03 |
| `/guest/upgrade` `/account-deleted` | GuestUpgrade / AccountDeleted | 要・不要 | — | SC-03 |
| `/dashboard` | Dashboard | 要 | ホーム | SC-04 |
| `/planner` `/planner/:planId` | Planner | 要 | 旅行/旅程 | SC-05・06・37 |
| `/planner/:planId/today` `alerts` `track` | Today / Alerts / LocationTrack | 要 | 旅の当日 | SC-07・24・43 |
| `/planner/:planId/spot/:areaId` `spot-areas` | SpotMode / SpotAreas | 要 | **該当なし(2.1)** | SC-49・50 |
| `/planner/:planId/kit` `kit/search` | TripKitRoute | 要 | 旅行箱 | SC-44・10 |
| `…/reservations` `imports` `documents` `preparation` `expenses` | 旅行箱の中 | 要 | 旅行箱 | SC-11〜13・21〜23 |
| `…/segments` `constraints` `draft` | 移動区間・制約・下書き | 要 | 旅程 | SC-14・15・46 |
| `…/route-options` | RouteOptions | 要 | 比較 | SC-14 |
| `…/candidates` `places/:placeId` | 候補箱・場所 | 要 | 発見 | SC-08・09 |
| `…/discussion` `booklet` `booklet/:exportId` `exports` `corrections` | 相談・しおり・出力・訂正 | 要 | 共有 | SC-19・20・25・26・29 |
| `/share/:planId` | Share | 要 | 共有 | SC-18・34 |
| `…/memories` `journey` `visits` `memory-replan` | 旅の記録 | 要 | 旅の記録と思い出 | SC-28・39〜42 |
| `…/calendar-import` `replans/:replanId` `sync` | 取込・再計画・同期の競合 | 要 | **該当なし(2.1)** | SC-13・24・27 |
| `…/branches` `branches/:branchId` | 案内だけ(廃止) | 不要 | — | SC-17 |
| `/trip-consult` | TripConsult | 要 | 旅行相談 | SC-45 |
| `/search` `/search/settings` `/search/spots` `/spots` `/spots/search` `/spots/register` | 検索・行きたい場所 | 要 | 発見 / 行きたい場所 | SC-08・10 |
| `/memories` `/atlas` | 思い出・Atlas | 要 | 旅の記録と思い出 | SC-28・41 |
| `/settings` `/settings/data` `/settings/billing` `/profile` `/notifications` `/optimization` | 設定ほか | 要 | — | SC-16・29・30・47 |
| `/organizations…` `/admin…` | 組織・管理 | 要(管理は管理者) | — | SC-31・32 |
| `/s/:token` `/b/:token` `/u/:token` `/journal/:token` | 公開・QR 投稿 | 不要 | — | SC-35・36・48・28 |
| `/design-system` `/404` `*` | 開発用・未発見 | 不要 | — | — |

### 2.1 帯の「今の画面」の判定が届かない経路(コード)
`frontend/src/components/shell/railItems.ts` の判定は、旅程=`''`・`/draft`・`/segments`・`/constraints`、当日=`/today`・`/alerts`・`/track`、旅行箱=`/kit`・`/reservations`・`/imports`・`/documents`・`/preparation`・`/expenses`、共有=`/discussion`・`/booklet`・`/exports`・`/corrections`、比較=`/route-options`。
`/spot/:areaId`・`/spot-areas`・`/calendar-import`・`/replans/:id`・`/sync` はどれにも入らないため、**この旅行のメニューで印が付かない**(コードの事実)。実際に迷うかは実観察で確かめる(G2-02-A)。

## 3. 課題台帳

区分: 問題 / 課題 / 改善 / 追加修正。根拠: コード=読んで確認 / 文書=文書の突き合わせ / 資料=利用者の資料 / 観察=実旅行(**今は 0 件**)。

| ID | 区分 | 重要度 | 内容・根拠 | 対応 | 関連 |
|---|---|---|---|---|---|
| G2-09-A | 問題 | P0 | DOC-10 の見出し・説明に「全59 FR」が残り、生成した表・集計は 60 件(文書)。fr-status・fr-requirements の説明、FR-TRACE・縦断シナリオ・fr-requirements の基準 commit も古い(`a2c419d`) | **この PR で修正**。生成元を直して `render_*.py --check` が一致。DOC-10 は v6.0-r61 | DOC-10・FR-TRACE・`test_gate_g1_doc10` |
| G2-09-B | 課題 | P1 | DOC-10 §0.1「基準 commit」は `d8bd1b7`(11/05)で、試験の実測値(pytest 1603 など)も同じ時点。`SECURITY-TRACE.md`・`gate-hardening-trace.md` の基準は `a2c419d` | 今回は直さない(**今の CI の実測値を、実行の記録から取って書き直す必要がある**。推測で書かない)。旅行後の小 PR | DOC-10・DOC-11 |
| G2-02-A | 課題 | P1(仮説) | 2.1 のとおり、スポットモード・エリア準備・取込・再計画・同期の競合で帯に印が付かない(コード)。旅行当日に「どこにいるか」で迷うかは未観察 | 旅行後。観察で確かめてから `railItems` の判定を足し、`router.test` に追加 | SC-49・50、FR-060 |
| G2-04-A | 課題 | P1 | 「周りを探す」は端末の現在地の座標をサーバーへ送り、`place_finder` が外部の場所の提供元に渡す(コード。保存はしない: `test_nearby_filters_by_radius_and_area_without_storing_location`)。画面は「別行動・みんなの印」に「位置は共有しません」と書くが、**周りを探すの横に「今いる場所を検索サービスへ送る」旨がない**(`SpotPanels.tsx`) | 旅行後に文言を足す(利用者の操作で送る点は変わらない)。位置の既定 ON はしない | FR-060、G2-08 |
| G2-04-B | 問題 | P0 | FR-060 の別行動の集合が位置を保存・送信しないこと: `SplitIn` は `extra=forbid` で集合の時刻・場所の名前・ひとことだけ、`SpotAreaSplit` に座標の列なし(コード・`test_split_off_and_rejoin_shares_only_the_promise`)。**実機・実通信では未確認** | コードと試験の範囲では**問題なし**。実機は旅行当日 §10 | FR-060 |
| G2-01-A | 改善 | P0 | 候補→旅程→当日→記録の連続性(ID・メモ・出典・再入力)。コードの横断はまだ(今回は経路と文書まで) | **未実施**。近場の日帰りで観察してから原因を追う | FR-007・008・029・037 |
| G2-05-A | 問題 | P0 | 圏外・再起動・復帰の同期の実機証拠 | **未実施**(iPhone・Android の実機) | FR-032・033・048 |
| G2-06-A | 課題 | P1 | 日本語/英語・現地語の地名・通貨・時差・出典の鮮度の監査 | **未実施** | — |
| G2-07-A | 改善 | P1 | 会員クラス・枠・解約後の扱い(FR-059・058)。価格・名称は仮説のまま | **未実施**。Stripe はテストモードのみ | FR-058・059 |
| G2-10-A | 追加修正 | P1 | provider の timeout・quota・古さ・圏外での表示 | **未実施** | FR-030 |
| G2-X-1 | 問題 | P1 | README は「MIT License - see LICENSE file」とあるが、**ルートに LICENSE が無い**(監査資料 2026-11-18 の指摘を、tree で確認した) | **利用者の判断が要る**(権利者・貢献者の同意でライセンスを決めるか、README の記述を直す)。コードは触らない | README |
| G2-X-2 | 課題 | P2 | `frontend/src/frontend_spot_integration.py`(1071 行・どこからも参照されない旧い統合の道具)が残っている | 旅行後に利用者の確認の上で整理 | — |

## 3.1 追加の実測・修正(2026-11-18 夜。いずれも PR 作成済み・未マージ)
| ID | 区分 | 重要度 | 内容・根拠 | 対応 | 関連 |
|---|---|---|---|---|---|
| G2-06-B | 問題 | P1 | 日の `timezone_id` が UTC 既定。日の追加・クイックドラフト昇格のどちらでも UTC になり、日本の 08:30 に「今日」が空、10:05 に「次まで535分」と 9 時間ずれる(コードを実行して確認) | PR #130: 端末/直前の日の時間帯を送る・PATCH day で変更(予定は壁時計のまま移し Undo 可)・旧UTCの日に案内。既存データの一括変更はしていない(提案のみ) | FR-049・今日モード |
| G2-05-B | 問題 | P1 | メモ送信キューが 401/403/429/5xx/通信失敗でも項目を捨てていた(黙って消失) | PR #130: 一時的な失敗では保持、捨てた時は「送れなかった N件」を表示 | FR-032・033 |
| G2-02-A(対応) | 課題 | P1 | 帯の「今の画面」の印が /alerts /track /spot/ /replans /sync 等で付かない | PR #129: 印の対象経路を追加(5 試験) | FR-051 |
| G2-08-A | 課題 | P1 | 検索画面が開いただけで現在地を取りに行っていた | PR #129: ボタンを押した時だけ取得(試験あり) | FR-060 |
| G2-04-A(対応) | 課題 | P1 | 「周りを探す」で座標が検索サービスへ渡ることの説明が無かった | PR #129: 探す前に「検索サービスへ送る・保存しない・メンバーへ送らない」を表示(試験あり) | FR-060 |
| G2-10-B | 問題 | P1 | 検索サービス失敗時も「何もない/0件」と同じ表示(`failed_providers` を UI が見ていない) | PR #131: 失敗と 0 件を区別して表示(試験あり)。実API失敗の再現は未実施 | FR-030 |
| G2-01-B | 課題 | P1 | 検索の「プランに追加」が place_id を持たない経路(PlannerPage の addScheduleItem) | **未対応**(候補作成→予定化の経路へ寄せる改修が必要) | FR-018 |
| G2-05-C | 課題 | P1 | 圏外パックの保存期限(7日)・鍵期限の警告が無い | **未対応**。運用回避策: 旅行前日にパックを保存する | FR-048 |
| G2-08-B | 課題 | P2 | 監査ログ details のマスキング試験が無い | **未対応** | FR-056 |
| G2-07-B | 課題 | P1 | 会員クラス名・価格に資料間の差(Trip Pass と Trip クラス等)。価格は仮説のまま・Stripe はテストのみ | **未確定**(利用者の判断待ち)。QR・書き出し・削除が枠超過/解約後も使えることの試験は未追加 | FR-058・059 |

## 4. 旅行前の方針
- 旅行前に直すのは P0 だけ。この PR は文書だけで、コード・DB・route の変更はない(UI/ナビの変更は旅行後)。
- omega-dev2 への反映・実データ移行・鍵・Stripe Live・位置の既定 ON・G-13 の自動計測は**していない**。

## 5. 証拠の区分(まだ無いもの)
- **実機**: iPhone Safari・Android Chrome・iPad(位置・地図・画面の大きさ・片手・200% 文字・読み上げ・屋外・固定帯の遮蔽)。
- **実 API**: 場所の検索・経路・時刻表・気象・休業の実通信(CI は模擬)。
- **運用**: omega-dev2 の `/ready`・healthy、本番の KMS・WAF・外部監視・復旧演習・侵入試験。
- **観察**: 近場の日帰り(11/21–22)・伊勢 1 泊 2 日(11/28–29)の記録(様式は縦断シナリオ §8)。

## 6. Gate② の判定(2026-11-18 時点。暫定)
- **総合テスト(開発環境での実旅行検証)の開始: 可。** 条件: omega-dev2 の `/ready` と healthy を確認し、app の SHA を `32c7db6` 以降で固定する。予約の原本(アプリ・紙)と公式の交通案内を必ず携行する。
- **Gate② の完了: 未。** 近場・伊勢の実施、迷い・再入力の改修後の再試験、実機・実 API の証拠がそろってから判定する。
- **残 P1 と回避策:** G2-02-A(帯の印が無い画面は、画面の中の「予定へ戻る」で戻る)、G2-04-A(周りを探すは、使う人が自分で押した時だけ現在地を送る)、G2-X-1(利用者の判断)。
- **本番公開は別ゲート**(KMS・WAF・外部監視・復旧・侵入試験・API 請求・規約・商標とライセンス)。


## 7. 2026-11-19 最新確認（PR #128 取込後・Gate②継続）

この追記は履歴を消さず、11/18時点の記録と区別する。確認基準は main `c8721a7270fe335affbfd3eae44b472e4fe6063c`（PR #128 が取り込まれた後）。PR一覧と Actions を再照合した。

| PR | 状態 | 確認 |
|---|---|---|
| #128 | mainへ取込済み | main CI #757 はスクリーンショット時点で queued。PR側 CI #756 は成功 |
| #129 | open / 未マージ | CI #753 成功。画面の現在位置表示・検索時のみ位置取得・位置送信先の説明 |
| #130 | open / 未マージ | 初回CI #754 はlint失敗(未使用importと長行)。是正後、head `42b0af04a1` の全6 check(e2e・backend・frontend・dependency-audit・secret-scan・GitGuardian)が成功(2026-11-19 確認) |
| #131 | open / 未マージ | CI #755 成功。provider失敗と検索0件の表示区別 |
| Gate②追加是正PR | #132 open / 未マージ、head `23fecbc7258e4b58fd0ebe2564574142e5fd418c` | 候補→正規Place→予定ID接続、オフライン期限案内/境界統一、監査ログdetailsマスキング試験、会員・料金の提案とコード状態の説明。CIは3段階で失敗→是正: (1) #759 frontend型検査(returnにundefined経路)→boolean統一、(2) head `4884f3e` frontendのvitestが失敗(候補採用失敗の試験がconsole.errorを捕まえていない。併せて、IndexedDB不可の環境でPlannerPageの期限読み取りが未処理のPromise拒否になる実欠陥を発見し、catchで「保存なし」扱いに)、(3) head `e1c88d2` backendのflake8(E501)失敗→行分割。最終head `8e40eb0` は e2e・backend・frontend・dependency-audit・secret-scan・GitGuardian が全て成功(2026-11-19 確認。台帳追記コミット後のCIは別途確認) |

### 7.1 会員クラスの現物照合（G2-07）

現行の `membership_tiers.py` は Free / Trip / Journey / Explorer を、有料provider・AIをどこまで使えるかの**内部原価/機能権限**として扱う。旅行内ロール(owner/editor/viewer/guest)、ゲスト認証、Family/Group、Pro/B2B、Trip Passとは別軸。FR-058の販売・決済は未実装で、Stripe test modeの状態を「課金が実装済み」と数えない。

- 現行内部枠: Trip は場所検索2・詳細1・写真1・経路4・地図1、Journey はTrip+AI、Explorer はJourney+Web検索。月原価枠は Trip/Journey 150円、Explorer 250円、各最大5旅行、1旅行hard cap 50円。
- 仕様の版・改訂履歴に旧クラス・旧quotaの説明も残るため、機械可読policy/profileと現行テストを照合してから表を更新する。正本の過去履歴を現仕様として誤読しない。
- 公開販売案は別紙 `docs/audit/2026-11-19_gate2_membership_and_code_closure.md`。名称候補(旅の芽/旅の道しるべ/旅の設計室/旅の探究室)、Pass・月・3か月・年、価格案を載せたが、すべて仮説。契約・価格・復帰猶予の決裁前は販売しない。
- Freeでも基本の旅行・予約/QRの閲覧・プライバシー・出力・削除を維持する案。解約後の保存猶予・返金・未使用PassはFR-058で決め、エンタイトルメントのテストを追加する。
- このターンで商用権限、価格、Stripe Live、G-13利用計測の設定は変更しない。

### 7.2 Gate②追加コード是正（未マージ）

| ID | 変更内容 | 検証状態 |
|---|---|---|
| G2-01-B | 検索候補から正規Placeを採用し、予定へ `place_id` を引き継ぐ。採用失敗時はリンク無しイベントを作らない | 単体試験追加。最終headのCI全job成功。実旅行での確認は未実施 |
| G2-05-C | Offline Pack/key期限を表示し、期限切れ警告から保存し直せる状態を案内。期限境界を `now >= expiresAt` に統一 | 単体試験追加。最終headのCI全job成功。実機(機内モード等)は未確認 |
| G2-08-B | 監査detailsを再帰マスキングし、Authorization/Bearer/JWT等の文字列も伏せる試験 | Bearerを先に伏せた後にAuthorizationラベルが上書きされないよう正規表現を修正。flake8のE501を是正し、短い語(`pin`)の部分一致による過剰マスキングを完全一致へ、トークン数量(`max_tokens`等の数値)は保持するよう調整。試験3件(ネスト/配列/非辞書/Unicodeキー/長大文字列/書込み不例外)。最終headのbackend全件成功 |
| G2-07-B | 内部quotaと公開課金を分けた販売案・未確定項目を文書化 | 文書追記。承認価格ではない |
| G2-01-C | 問題 | P1 | 候補採用API(`POST /search/candidates/{id}/adopt`)が冪等でなく、同じ候補の再送ごとにPlace・出典が増える(試験で再現)。予定作成の失敗後の再試行・連打で重複する | PR #134: 同じ候補(同じ本人)は先のPlaceを返す。DB移行なし。試験は修正前に失敗・修正後に成功 | FR-018 |
| G2-09-C | 訂正(解消) | P1 | **【2026-11-19 訂正】「FC-101〜180がDOC-02 v6.0に無い」は誤りだった。** v6.0 の §9.10 に規則表現(FC-(101+5k)〜FC-(105+5k)=FR-(043+k)の5観点、CAとGateは§3)で入っている。最初に FC 表(§9.1〜9.9)だけを見て、§9.10 を見落とした調査の誤り。v5.1 の80行と機械的に突き合わせ、16FRの名前・CA・Gate と5観点のSHALLが一致することを確認した | `docs/audit/2026-11-19_fc101-180_lineage.md`(80行の系譜表。`scripts/audit/gen_fc_lineage.py` で再生成)。要件の削除・統合はしていない。**FC単位の状態は台帳に無く、証拠は親FR単位**(G2-09-D は未了のまま) | 利用者の判断: 80行の表へ戻すか、規則表現のままにするか(情報は等価) |
| G2-09-D | 課題 | P1 | FC単位の照合が未実施。FC-001〜100のうち `docs/trace/` から参照されているのは32件、未参照68件(自動集計 2026-11-19)。未参照=未実装ではなく「FC単位の根拠が台帳に無い」の意味 | 未参照FC: FC-002, FC-003, FC-004, FC-005, FC-006, FC-007, FC-008, FC-009, FC-010, FC-011, FC-012, FC-014, FC-015, FC-016, FC-017, FC-018, FC-021, FC-022, FC-024, FC-026, FC-029, FC-031, FC-032, FC-033, FC-034, FC-035, FC-036, FC-037, FC-038, FC-039, FC-040, FC-041, FC-043, FC-044, FC-045, FC-046, FC-047, FC-048, FC-049, FC-050, FC-051, FC-052, FC-053, FC-054, FC-056, FC-057, FC-059, FC-060, FC-061, FC-063, FC-064, FC-075, FC-076, FC-077, FC-078, FC-079, FC-080, FC-081, FC-082, FC-083, FC-084, FC-085, FC-086, FC-093, FC-094, FC-095, FC-096, FC-100。FC単位の根拠付けは別Gate。FR単位の状態(DOC-10)を代用して合格と書かない | DOC-10・FR-TRACE | **【2026-11-19 追記】** 番号の言及を backend・frontend・scripts・docs で数え直した(FC-001〜100): コード/試験に FC 番号の言及があるのは19件、言及が docs だけのものが81件。**番号の言及は実装の証拠ではない**ため、「実装済み/未実装」の分類にはしない。意味での FC 別照合(100件+80件)は未了のまま。
| G2-10-C | 問題 | P1 | #131以外にも、提供元の失敗が「見つからない」と同じ表示の画面が残っていた(名前で検索 PlaceFinder・予定の住所→位置 NewEventForm・外部の写真 ExternalPhotoPicker)。全画面を調査 | PR #135: 3画面とも失敗を区別して表示。試験は PlaceFinder・外部写真に追加(NewEventForm は試験未追加)。実API失敗の再現は未実施 | FR-030 |
| ローカル検証(2026-11-19) | 証拠 | — | 自前のPostgres(UTF8・UTC・trust認証)でAlembic head `d5e9f3a7b2c6` まで移行し、#132のbackend全試験を実行: 1980成功・12skip・1失敗。失敗は `test_gate_g2_db_roles.py::test_apply_is_idempotent_and_changes_password` で、trust認証のため「旧パスワードで接続できなくなる」ことを確かめられない環境起因(CIの実DBでは成功)。これはCIの代替ではなく補助の証拠 | — | — |
| G2-07-C | 枠の使い切り・有料クラスの解約/期限切れ後も、旅行データ・予約番号・書き出し・退会が止まる経路が無いことの試験 | PR #133(試験のみ・5件)。予約番号の完全表示にある「1時間60回」は会員枠ではなく乱用防止のレート制限 |
| G2-07-D | Stripe手数料・税・ストア手数料の確認 | 会員資料 §5.1。国内カード3.6%は公式記載を確認。Billing/dispute等は第三者解説のみで未確認。消費税・特商法は未確認 |
| G2-X-2(調査) | `frontend/src/frontend_spot_integration.py` の全参照検索 | コード・CI・scripts・文書のどこからも参照なし(自身と台帳のみ)。`リポジトリの再構成`(056d722)で追加された一回限りの統合スクリプト。**削除はしていない**(削除PRは利用者の判断後) |

### 7.3 ゲート状態（この追記時点）

- 開発環境の机上/自動試験で先へ進める項目は継続する。実機旅行の記録を待たずに、会員枠・offline期限・監査ログ・候補ID・失敗系のテストと正本の整合を進める。
- 旅行を伴う位置/地図/通知/オフライン同期/操作の迷いは未実施のまま保留し、コード推測で「合格」にしない。
- #129〜131と追加PRはすべて未マージ。各PRの全CI成功と変更差分を確認した上で、mainへ取り込む判断をする。
- main CI #757 の成功はこの記録時点では未確認。最新runが完了したら再確認してSHA・実測件数を更新する。

## 7.3 2026-11-19 午後の追補(main `dac0b51` 時点)

| # | 内容 | 状態・根拠 |
|---|---|---|
| A-1 | PR #134 に**同時リクエストの競合対策**を追加(候補の行を `FOR UPDATE` で押さえて直列化。migration なし)。別接続で4並列に実行する試験を追加 | 修正前は Place が4件に増え(3回再現)、修正後は1件に収束(3回成功)。コミット `6279864`。**DB の一意制約は migration が要るため入れていない**(利用者の承認待ち)。実環境の並列負荷では未確認 |
| A-2 | PR #135 に NewEventForm の試験を追加(住所位置検索: 成功/0件/提供元障害/通信エラー/再試行/入力不正、場所情報: 障害/0件/成功) | 10件通過。コミット `ac5b608`。関連の frontend 818件も通過 |
| A-3 | **PR 同士の衝突**: #131 と #129(または #130)が `SpotModePage.test.tsx` の同じ場所を変更しており、**単独では main に衝突なく入るが、続けて入れると2本目で衝突する** | 重ねて検証した状態では衝突を両方のテストを残して解消。取り込み順は #129 → #130 → #131 の後に残りを推奨。2本目以降で衝突が出た時は、両方のテストを残す |
| A-4 | **全 PR(#129〜#131・#133〜#135)を最新 main に重ねた状態の検証**(ローカル) | frontend tsc・eslint 0エラー、vitest 264ファイル 1511件通過。backend compileall・flake8 0件、pytest 1989 通過・12 skip・失敗0(環境起因の `test_apply_is_idempotent_and_changes_password` 1件は信頼認証のため除外)。**CI での確認ではない** |
| A-5 | 試験用 DB を強制終了した pytest がデモデータごと汚した事故(私の操作)。DB を作り直して全件を取り直した | コードの不具合ではない。1回目の組み合わせ検証は破棄し、3回目(クリーンな DB)を採用 |
| A-6 | omega-dev2 は main `2c8707b` に反映済み(利用者の実行ログ: バックアップ `tc-20261119T020929Z`・DB head `d5e9f3a7b2c6`・health/ready/画面/CORS 200)。main は `dac0b51`(docs のみの差分 #137)に進んでいる | `dac0b51` の CI #770 は backend・frontend・secret-scan・dependency-audit が成功、e2e は実行中だった。**GCP VM は私からは接続できず未反映・未確認**(runbook §5 の手順を利用者が実行する) |


## 8. 2026-11-20 の追補(main `1aeab35` 時点。§7 までの記録は消さない)

基準: main `1aeab35d5f33f6c16851ef0d46fbe78f4f6921fa`(#150)。main の CI #802 は 5 件とも成功。詳細は追補 C(`2026-11-20_gate2_status_addendum_c.md`)・追補 D(`2026-11-20_gate2_status_addendum_d.md`)。

| ID | 区分 | 重要度 | 内容・根拠 | 対応 | 関連 |
|---|---|---|---|---|---|
| G2-11-A | 問題 | P1 | 招待の宛先を大文字小文字を区別して比べ、`Friend@Example.com` 宛の招待が本人に見えず承諾できなかった(試験で再現) | **main に取り込み済み**(#147。元 #148) | FC-061 |
| G2-11-B | 問題 | P1 | ログイン・登録の重複確認・メール変更などが大文字小文字を区別し、`taro@example.com` と打つとログインできず(401)、2 つ目のアカウントも作れた(試験で再現) | **main に取り込み済み**(#150)。保存の値は書き換えていない | 認証 |
| G2-11-C | 未実装の要件 | P2 | FC-042 予約の重複の候補(自動では消さない) | **main に取り込み済み**(#147。元 #149) | FC-042 |
| G2-11-D | 問題 | P1 | 日付で壊れる E2E: ダッシュボードの見出し(CI #793 で落ちた)・seedBaseline の旅行が 2026-11-21 固定(gate-g9 が 11-21 から落ちる)・spot-mode が 11-29 固定 | **main に取り込み済み**(#147・#150)。残りの未来の固定の日付 8 本は PR #152(未マージ) | CI |
| G2-11-E | 問題 | P1 | main CI #786 の赤: `tc_transfer` の誤った合言葉が約 1/256 で別の例外になる不安定な試験 | **main に取り込み済み**(#147。元 #142)。#797・#802 は緑 | 運用の道具 |
| G2-09-D(続き) | 課題 | P1 | FC-001〜100 を要求の文とコード・試験で照合: 実装あり 48・一部 37・未実装 12・要確認 2・判断待ち 1(FC-086) | 19 件は main に取り込み済み(#147)、残り 81 件は PR #153(未マージ)。未実装の 12 件は作るかを利用者が決める | DOC-02 |
| G2-ENV | 運用 | P0 | omega-dev2・GCP VM を `1aeab35` へ反映し、反映後に招待・ログイン・予約の重複の候補を実環境で確かめる | **未実施**(Claude の作業環境から入れない)。手順と記録の道具は PR #151(追補 D・`gate2_env_record.sh`)。両環境の最後に確認された版は `cd14e23` | 追補 D |

### 8.1 日付への依存の検査
backend 全件と frontend 単体を、時計を +45 日・+400 日にずらして流し、日付で落ちる試験は無かった(backend の 3 件は時計をずらした時の副作用で、普通の時計では通る)。E2E は手元で流せず、コードを読んで固定の日付を直した(上の G2-11-D)。

### 8.2 ゲートの状態(この追記の時点)
- 自動の試験と CI の範囲で進められる項目は、上のとおり main に入った。
- **環境(omega-dev2・GCP VM)への `1aeab35` の反映と、実環境での確認は未実施。** 実機・実 API・実旅行の証拠は増えていない。**Gate② は完了ではない。**
- 判断待ち(変わらず): FC-086・候補の採用の一意制約(T2。重複確認の SQL は記録の道具に入れた)・LICENSE・未使用ファイルの削除・会員の名称と価格・Stripe Live・未実装の FC 12 件。
