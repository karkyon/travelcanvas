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
