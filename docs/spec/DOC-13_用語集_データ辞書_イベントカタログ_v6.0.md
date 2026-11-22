# 13 用語集 データ辞書 イベントカタログ v6.0(正本)

> 文書ID: DOC-13 / 版: **v6.0** / 状態: APPROVED FOR IMPLEMENTATION(利用者の指示 2026-11-17 で v6.0 へ改訂。main への取り込みで発効)<br>
> **正本の場所: このファイル。** 旧版 v5.1(資料室 `13_用語集_データ辞書_イベントカタログ_v5.1.md`、2026-09-03 発効)は保管。<br>
> 共通正本: 要件ID=DOC-02、画面ID=DOC-04、データ=DOC-05、API=DOC-06、Security=DOC-11、語彙=DOC-13(所在は `docs/spec/CANONICAL-SOURCES.md`)

**目的:** 企画、UI、API、DB、運用で同じ言葉を異なる意味に使う事故を防ぐ。

## 0. v6.0 の改訂点

| # | 変更 |
|---|---|
| 1 | 実装で使っている言葉を追加: 日ごとの案(プランB)・今の案・控えの案・切り替え・合流点(§17)、旅行箱・旅帖・旅帖ライブ・出発の合図・寄り道の候補(§18)、利用枠・原価上限・会員のクラス(§19) |
| 2 | 移動手段の値と表示の名前(§15)、当日の移動時間の出どころ(§16)、地図の線の言葉(§16) |
| 3 | **エラーの code の正本は `docs/spec/error-catalog.md`(コードから生成)** とし、§11 の名前空間は設計の方針として残す(実装の code は小文字の snake_case) |
| 4 | 「ブランチ」(What-if)は廃止の語。日ごとの案へ置き換え(DOC-02 v6.0 FR-019) |
| 5 | 「足跡」は位置の記録の線だけに使う(予定の地点を結んだ線を足跡と呼ばない) |

v5.1 の §1〜§14 は削らずに引き継ぎ、変わった所に「**v6.0:**」で書き足した。

## 1. プロダクト用語

| 用語 | 厳密な意味 | 混同禁止 |
|---|---|---|
| TravelCanvas | 本システム全体 | 個別旅行Plan |
| 旅行プラン / Plan | 一回の旅行を束ねるaggregate | AI生成候補だけ |
| 旅行日 / Day | Planの現地暦日ビュー | 24時間固定区間 |
| イベント / Event | 滞在、食事、予約、集合等の予定単位 | 移動区間そのもの |
| 候補 / Candidate | 未確定の場所・活動・案 | 確定Event |
| 場所 / Place | 正規化された施設・地点 | 住所文字列だけ |
| 入口 / Entrance | Placeへ入る実用地点・改札・集合 | Place中心座標 |
| 予約 / Reservation | 外部事業者との確定・候補契約情報 | Eventのメモ |
| チケット / Ticket | 入場・乗車等の権利表現 | 予約全体 |
| 文書 / Document | PDF、画像、確認書、領収書等の原本 | 抽出済みfield |
| 移動区間 / Segment | Event/Place間を接続する計画移動 | 経路候補Route |
| 経路候補 / Route Option | Providerまたは手動による移動案 | 採用済Segment |
| Leg | Route内の個別徒歩・鉄道・バス等 | 旅行全体の一日 |
| 制約 / Constraint | 成立条件・好みを機械判定可能にしたもの | コメントだけ |
| ハード制約 | 違反できない条件 | 重みの大きい希望 |
| ソフト制約 | 違反にペナルティを与える希望 | 必須予約 |
| ロック | 最適化・再計画で変更禁止のfield/entity | 編集権限禁止全般 |
| 実行可能性 | 旅程が制約と情報に照らし成立する度合い | 楽しさの単一score |
| 最適化 | 複数目的と制約から候補を算出する処理 | AI作文 |
| 再計画 / Replan | 状況変化を起点に代替change setを作ること | 自動上書き |
| ~~ブランチ~~ | **v6.0 で廃止の語。** 日ごとの案(§17)を使う | — |
| NOW | 現在進行中または直近状態のEvent | 現在地 |
| NEXT | 次に行動すべきEvent/Segment | 単なる次の配列要素 |
| 旅行情報ハブ | Plan内の予約・場所・文書等を横断するUI(**v6.0:** 画面の名前は「旅行箱」) | 汎用ファイル一覧 |
| Travel Pack | 端末向け暗号化offline snapshot | Service Worker cache全体 |
| レディネス | 出発準備の重大未完了を含む状態 | 単純完了率 |
| 旅行記 | 計画・実績・写真から利用者が編集公開する記録 | 自動公開 |

## 2. Identity・権限用語

| 用語 | 定義 |
|---|---|
| Guest | 未登録だがtokenで限定所有権を持つ主体 |
| User | 登録済み主体 |
| Owner | Planの権限・削除・共有を管理する所有者 |
| Editor | policy範囲でPlanを編集するmember |
| Voter | 候補評価、制約、コメントを行うmember |
| Viewer | 許可fieldを閲覧するmember |
| Share Viewer | Share Grantで期限・範囲付き閲覧する主体 |
| Organization Admin | 組織設定・配布を管理。個人旅行の当然閲覧権はない |
| Service Admin | 運用主体。利用者秘密の当然閲覧権はない |
| Membership | IdentityとPlan/Organizationの関係 |
| Role | 標準権限集合 |
| Permission | Resource/Field/Action条件の許可・拒否 |
| Field Policy | 予約、QR、費用等の項目群ごとの公開範囲 |
| Share Grant | token hash、期限、回数、role、field policyを持つ共有許可 |
| Support Grant | 利用者同意、ticket、scope、期限を持つサポート閲覧許可 |
| Reauthentication | 最近の認証を再確認し高リスク操作を許すこと |

## 3. 情報品質用語

| 状態 | 定義 | 代表UI |
|---|---|---|
| VERIFIED | 一次情報または利用者確認済み | 確認者・日時 |
| IMPORTED | 原本/APIから取り込まれたが確認状態を別途持つ | 原本リンク |
| USER_ENTERED | 利用者が直接入力 | 入力者・更新時刻 |
| INFERRED | AI・規則・推定 | 推定バッジ |
| FRESH | 鮮度基準内 | 通常 |
| AGING | 期限に近い | 軽い注意 |
| STALE | 鮮度期限超過 | 再確認 |
| CONFLICTED | 複数sourceが矛盾 | 比較・解決 |
| UNAVAILABLE | 現在取得不能 | 最終値と取得時刻 |
| Confidence | 抽出・推定の確からしさ | 事実の保証ではない |
| Source | 値の由来・provider・原本・取得時刻 | |
| Evidence Locator | 原本文書内で抽出根拠となるページ・領域 | |
| Verification | 利用者または一次情報による確認行為 | |

## 4. セキュリティ用語

| 用語 | 定義 |
|---|---|
| PUBLIC | 公開情報。無制限公開を意味しない |
| INTERNAL | 旅行member向け情報 |
| CONFIDENTIAL | 予約番号・連絡先等、限定権限情報 |
| RESTRICTED | QR、PIN、旅券、健康、実位置等の最高保護情報 |
| Mask | UI上の一部非表示。暗号化の代替ではない |
| Reveal | 権限・目的・再認証を確認して一時表示 |
| Field Encryption | application層で個別fieldを暗号化 |
| Envelope Encryption | data keyをmaster/KMS keyでwrapする方式 |
| Blind Index | 平文を保存せず限定検索するHMAC等の索引 |
| Token Hash | share/refresh等の平文tokenをDBに保存しないための値 |
| Crypto-shredding | 復号鍵破棄でデータを実質読取不能にする削除補助 |
| Data Minimization | 目的に必要な最小情報だけ扱うこと |
| Purpose Limitation | 収集目的を越えて利用しないこと |
| Consent | 目的、policy version、scopeを伴う同意記録 |
| DLP | 秘密・個人情報の漏洩検知・防止 |
| IDOR | 他人のresource ID指定で不正取得する脆弱性 |
| SSRF | サーバーに内部・任意URLを取得させる攻撃 |
| Prompt Injection | 取込文書等がAIへの命令を偽装する攻撃 |
| データ鍵 / KEK(v6.0) | 旅行・利用者ごとのデータ鍵(DEK)と、それを包む鍵(KEK)。KEK は今は .env(KMS ではない) |

## 5. 変更・同期用語

| 用語 | 定義 |
|---|---|
| Revision | Aggregate/entityの単調増加版 |
| ETag | APIでrevisionを表す競合制御値 |
| Change Set | 複数field/entity変更を一つの意味単位で束ねたもの |
| Change Item | Change Set内の個別差分 |
| Undo | Change Setの影響を競合確認後に打ち消す操作 |
| Idempotency Key | 同一副作用要求の再送を識別するkey |
| Operation ID | Offline操作の永続一意ID |
| Base Revision | Clientが編集開始時に見ていた版 |
| Conflict | BaseとCurrentの双方が同じfield等を変更した状態 |
| Tombstone | Offline同期で削除を表す記録 |
| Outbox | DB変更とevent発行の不整合を防ぐtable pattern |
| At-least-once | event/jobが重複配送され得る前提 |
| Dead Letter | 自動再試行不能のjob/event隔離先 |

## 6. 金額・時刻用語

| 用語 | 定義 |
|---|---|
| Planned Amount | 計画時の見込 |
| Reserved Amount | 予約確定時の金額 |
| Actual Amount | 実際の支出 |
| Base Currency | Planの集計基準通貨 |
| Transaction Currency | 実際に支払う通貨 |
| Exchange Rate | source、基準日時を持つ換算率 |
| Expense Share | 一支出のmember別負担 |
| Settlement | member間債務を実際に精算する記録 |
| UTC | 保存・比較の基準時刻 |
| IANA Timezone | Asia/Tokyo等の地域timezone ID |
| Local Date | 旅行先の暦日 |
| Exact Time | 確定時刻 |
| Approximate Time | 目安時刻 |
| Unscheduled | 時刻未定 |
| Buffer | 移動以外の準備・入口・保安等の余裕 |

## 7. API・運用用語

| 用語 | 定義 |
|---|---|
| Command | 状態変更を意図する要求 |
| Query Model | 画面用途へ認可済み情報を集約した読取表現 |
| Contract | OpenAPI/schemaとその互換性 |
| Breaking Change | 既存clientを壊すAPI変更 |
| SLO | 利用者向け信頼性目標 |
| SLI | SLOを測る指標 |
| Error Budget | SLO内で許容される失敗量 |
| RPO | 許容データ損失時間 |
| RTO | 復旧時間目標 |
| Runbook | 監視alertから復旧までの手順 |
| Feature Flag | 機能を対象別に切替える制御 |
| Canary | 一部trafficへ段階release |
| Kill Switch | 危険機能を即停止する制御 |
| SBOM | Software部品表 |
| ADR | Architecture Decision Record |
| Gate(v6.0) | 開発の区切り。1 つの PR と DOC-10 の改訂・trace を伴う(例: Gate Hardening-A) |
| PR(v6.0) | プルリクエスト。変更を main へ取り込む申請。CI の合格の後にマージする |

## 8. Domain Event Catalog

| Event | 発生 | 主consumer | 秘密方針 |
|---|---|---|---|
| GuestCreated | guest発行 | analytics最小、cleanup | tokenなし |
| GuestUpgraded | user移管 | identity、plan | emailなし |
| PlanCreated | plan作成 | search、audit | title必要時mask |
| PlanRevisionChanged | change適用 | realtime、cache、offline | 差分IDだけ |
| PlanDeleted | 論理削除 | share、search、offline | plan ID |
| EventCreated | event作成 | planner、validation | secret fieldなし |
| EventChanged | event更新 | segment、validation、notification | safe changed fields |
| PlaceSourceUpdated | place外部更新 | freshness、validation | public/source |
| SourceBecameStale | 期限超過 | readiness、notification | 値本文なし |
| ReservationImported | review確定 | planner、readiness | reservation IDのみ |
| ReservationModified | 更新確定 | event、alert | secretなし |
| ReservationCancelled | 取消 | validation、replan | secretなし |
| TicketAdded | ticket登録 | offline builder | payloadなし |
| DocumentQuarantined | malware | security | hash、安全metadata |
| ImportReviewReady | 抽出完了 | notification | 原文なし |
| SegmentChanged | 移動更新 | validation | route ID |
| ValidationCompleted | 検証完了 | UI、readiness | issue ID |
| OptimizationCompleted | 候補生成 | UI | candidate ID/metrics |
| OptimizationApplied | 承認 | plan、audit | change set |
| MemberInvited | 招待 | notification | invite tokenなし |
| MemberRemoved | 削除 | auth、offline、realtime | identity pseudonym |
| PermissionChanged | 権限変更 | cache、realtime | policy version |
| ShareCreated | grant作成 | audit | tokenなし |
| ShareRevoked | 失効 | cache、realtime | grant ID |
| VoteChanged | 投票 | consensus | private reasonなし |
| ConcernRaised | 懸念 | collaboration | privacy policy適用 |
| ReadinessChanged | 準備状態 | dashboard | aggregateのみ |
| ExpenseRecorded | 支出 | finance | amount policy検討 |
| AlertReceived | 外部alert | impact engine | provider raw ref |
| AlertImpactedPlan | 影響判定 | execution、notification | safe summary |
| ReplanReady | 候補 | Today UI | metrics/diff ID |
| ReplanApplied | 承認 | plan、members | change set |
| OfflinePackReady | pack生成 | device notification | download secretなし |
| OfflinePackRevoked | 失効 | device/sync | pack ID |
| SyncConflictCreated | 競合 | device/UI | field名、安全差分 |
| ExportReady | 出力完了 | notification | file tokenなし |
| PublicationRevoked | 公開停止 | CDN/cache | publication ID |
| ConsentWithdrawn | 同意撤回 | AI/location/analytics | purposeのみ |
| DeletionRequested | 削除開始 | deletion workflow | subject ID |
| SecurityIncidentRaised | 検知 | security on-call | safe indicator |
| DayVariantSwitched(v6.0) | 日ごとの案の切り替え | plan、today、journey、notification | 案の ID・理由の種類だけ。位置は地名の概略 |

**v6.0:** 実装は外部のイベントバスを持たず、同じ意味の記録(監査・通知・リアルタイムの revision)で表す。名前は設計の語彙として残す。

## 9. Event共通Envelope

```json
{
  "event_id": "uuid",
  "event_type": "ReservationImported",
  "schema_version": 1,
  "occurred_at": "2026-08-29T00:00:00Z",
  "aggregate_type": "reservation",
  "aggregate_id": "uuid",
  "aggregate_revision": 3,
  "actor": {"type":"user","id":"pseudonymous-id"},
  "correlation_id": "uuid",
  "causation_id": "uuid",
  "data": {"reservation_id":"uuid"}
}
```

Event schemaは互換性を管理し、consumerは重複event_idを冪等処理する。本文やciphertextを不要にevent busへ流さない。

## 10. Notification Template Catalog

| Code | 例文 | 秘密配慮 |
|---|---|---|
| N-001 | 旅行への招待が届きました | 旅行名をlock screenで省略可能 |
| N-002 | 旅程が更新されました | 詳細は認証後 |
| N-003 | 出発時刻が近づいています | 場所名表示設定 |
| N-004 | 予約情報の確認が必要です | 番号・名義なし |
| N-005 | 交通情報が旅程へ影響しています | 便詳細は認証後 |
| N-006 | 雨天の代替案を確認してください | 位置を通知へ出さない |
| N-007 | 共有リンクが使用されました | tokenなし、異常時導線 |
| N-008 | 新しい端末でログインしました | locationは概略 |
| N-009 | オフライン旅行パックの期限が近いです | 内容なし |
| N-010 | データ削除が完了しました | 共有端末に詳細なし |
| N-011(v6.0) | プランB に切り替えました | 理由の種類だけ。位置は出さない |

## 11. Error Code Namespace(設計の方針)

**v6.0:** 実装のエラーの code・HTTP・再試行(`retry`)の正本は **`docs/spec/error-catalog.md`**(`scripts/ci/render_error_catalog.py` がコードから生成)。
実装の code は小文字の snake_case(例: `too_many_streams`・`input_too_long`)。下の大文字の名前空間は分類の考え方として残す。

| Prefix | Domain | 例 |
|---|---|---|
| AUTH_ | 認証 | AUTH_TOKEN_EXPIRED |
| PERMISSION_ | 認可 | PERMISSION_FIELD_DENIED |
| PLAN_ | 旅行 | PLAN_REVISION_CONFLICT |
| PLACE_ | 場所 | PLACE_SOURCE_CONFLICT |
| RESERVATION_ | 予約 | RESERVATION_DUPLICATE_CANDIDATE |
| TICKET_ | チケット | TICKET_OFFLINE_NOT_ALLOWED |
| DOCUMENT_ | 文書 | DOCUMENT_QUARANTINED |
| IMPORT_ | 取込 | IMPORT_REVIEW_REQUIRED |
| ROUTE_ | 移動 | ROUTE_PROVIDER_UNAVAILABLE |
| VALIDATION_ | 検証 | VALIDATION_SOURCE_STALE |
| OPTIMIZATION_ | 最適化 | OPTIMIZATION_INFEASIBLE |
| SHARE_ | 共有 | SHARE_GRANT_EXPIRED |
| SYNC_ | 同期 | SYNC_OPERATION_CONFLICT |
| EXPORT_ | 出力 | EXPORT_SENSITIVE_CONFIRMATION_REQUIRED |
| PRIVACY_ | データ権利 | PRIVACY_DELETION_IN_PROGRESS |
| SECURITY_ | 安全 | SECURITY_REAUTH_REQUIRED |

## 12. 状態機械用語

Terminal stateは通常の更新で元へ戻さず、新しいversion/resourceを作る。例: revoked shareをactiveへ戻さず新grant、cancelled reservationの復活は新versionと確認、deleted documentの完全削除後は復元不能。

状態遷移はAPI、DB CHECK、UI button、event、testで一致させる。文字列を各層で独自定義せず、contractまたは生成enumを使用する。

## 13. 用語変更ルール

- 同義語追加はcanonical termへaliasを登録。
- DB/API enum変更はmigrationと互換期間。
- UIだけ言い換える場合もhelp・accessibility labelを確認。
- 「プロジェクト」と「旅行プラン」等、旧語を段階廃止。
- “AI最適化”は生成AIと数理最適化を区別して表記。
- “リアルタイム”は取得時刻・更新頻度・遅延保証を具体化。
- “安全”“暗号化”“完全削除”“オフライン”を証拠なしに絶対表現しない。
- **v6.0:** 決まった規則で作った物を「AI」と呼ばない。直線の目安を「道のり」「道順」と呼ばない。

## 14. 完成条件

本用語集のcanonical termsがDOC-01〜12、OpenAPI、DB enum、UI label、ログ、Runbookで矛盾しないこと。新機能は用語・状態・event・error codeを追加してから実装し、複数の似た概念を無秩序に作らない。

## 15. 移動手段の値と表示(v6.0 追加)

| 値 | 表示(アイコン · 名前) | 備考 |
|---|---|---|
| walking | Footprints · 徒歩 | |
| bicycle | Bike · 自転車 | |
| bus | Bus · 路線バス | 区別する前に保存した高速バスも bus のまま(推測で直さない) |
| express_bus | BusFront · 高速バス | 所要時間は推定(60km/h・迂回 1.25 の目安) |
| train | TrainFront · 鉄道 | 新幹線と推測しない |
| shinkansen | TrainFrontTunnel · 新幹線 | 区間で明示された時だけ |
| driving / car | Car · 自家用車 | タクシーと区別 |
| taxi | CarTaxiFront · タクシー | |
| ferry | Ship · 船 | |
| flight / plane | Plane · 飛行機 | |
| helicopter | ヘリの形 · ヘリ(要手配) | 所要時間は「未確定」とし推定しない |
| mixed | Shuffle · 乗り継ぎ | |
| (空・不明) | 移動手段未設定 | アイコンを出さない |

アイコンは lucide の SVG。名前を必ず文字で出す(色・形だけで伝えない)。出典 `docs/ux/G11_UIUX全範囲_実装仕様.md` §4。

## 16. 当日の移動時間の出どころと地図の線(v6.0 追加)

| 語 | 意味 | 表示で禁じること |
|---|---|---|
| 実時刻 | 乗り換えの提供元から取った出発・到着の時刻 | 取得時刻なしに出す |
| 手入力 | 利用者が入れた移動時間 | 実時刻に見せる |
| 登録した移動 | 移動区間・経路の候補として保存した値 | 実時刻に見せる |
| 概算 | 距離と手段から計算した目安 | 確定値・実時刻に見せる |
| 不明 | 出どころが無い | 0 分として扱う |
| 直線の目安 | 予定の地点を順に直線で結んだ地図の線 | 「道のり」「道順」と呼ぶ |
| 道に沿った経路 | 道の経路の提供元(OSRM)から取った線。地図では実線(2026-11-20 追記: 凡例に「道に沿った経路」と「直線(目安・道ではない)」を線の種類として常に出す) | 取れなかった区間を道のように描く・点線の目安を道に見せる |
| 足跡 | 位置の記録(端末内の点)を結んだ線。記録を ON にした時だけ | 予定の地点を結んだ線を足跡と呼ぶ |
| 外の地図で案内 | 道順を外の地図アプリへ渡すこと | アプリ内の直線を道順として示す |
| 未照会 | まだ提供元に聞いていない値(2026-11-20 追記。共通の確からしさの印 `components/common/certainty.ts`) | 「無い」「0」と書く |
| 未接続 | 提供元がつながっていない(設定・契約が無い)ため取れない値(同上) | 検索・取得したように見せる |
| 取得失敗 | 提供元に聞いたが取れなかった値(同上。§3 の UNAVAILABLE) | 「0 件」「見つからない」と同じに見せる |

共通の印(2026-11-20 追記): 上の語と §3 の状態を 8 つの状態(実データ・手入力・登録した値・概算・不明・未照会・未接続・取得失敗)にまとめ、
`CertaintyBadge` で同じ形で出す。当日の「実時刻」「登録した移動」は画面の言い方として残す。設計: `docs/ux/certainty_display.md`。

## 17. 日ごとの案(プランB)(v6.0 追加)

| 用語 | 意味 |
|---|---|
| 日の案(案) | ある日付の予定の一式。予定・移動区間・宿・予約のつながりを持つ |
| 今の案 | その日付で有効な案(1 日に 1 つ)。旅程・全日程・地図・しおり・共有・今日・予約の札・検証は今の案を使う |
| 控えの案 | 今の案ではない案。編集・比較・検証はできるが旅程の本体には出ない |
| 切り替え | 今の案の印を別の案へ付け替えること。予定を上書き・削除しない。記録が残り元に戻せる |
| 途中の切り替え | 旅行中にその日の途中から別の案へ移ること。済んだ予定は残る |
| 合流点 | 途中の切り替えで新しい案のどの予定から入るか(間に合う最初の予定) |
| 理由 | 雨・人数・移動手段・遅れ・疲れ・予算・休業・その他 |
| 前後のつながり | 前の日の終わり・翌日の始まり(宿・時刻・移動・予約・人数)との整合。合う・注意・合わない |
| 案の組 | 複数の日にまとめて作り、一緒に切り替える案 |

## 18. 当日・旅行箱の言葉(v6.0 追加)

| 用語 | 意味 |
|---|---|
| 旅行箱 | 予約・チケット・文書・準備・費用・取込・検索をまとめた画面(旅行情報ハブ) |
| 旅帖ライブ | 旅行当日の今日の画面の構成 |
| 旅帖・印 | 着いたら押す記録。写真・音声・ひとことを添えられ、取り消せる |
| 出発の合図 | 「HH:MM に出れば、ちょうど」。ゆっくり・そろそろ・いま・遅れ の 4 段階 |
| 旅の糸 | 今日の予定を済み・いま・これからで示す線 |
| 寄り道の候補 | 30 分以上の空き時間に近くの候補を出し、影響を見てから旅程に足す |
| 同行者の到着の共有 | 到着の予定だけを共有(位置は送らない。24 時間で消える) |
| お助け | 緊急・病院・交番・忘れ物などの連絡先 |

## 19. 外部の提供元と利用枠(v6.0 追加)

| 用語 | 意味 |
|---|---|
| 提供元 / provider | 外部の API(AI・場所・経路・地図・天気・メール等) |
| 原価上限 | 1 旅行あたりの外部 API の原価の上限(FR-059) |
| 利用枠 / quota | 会員のクラスごとの外部 API の使える量 |
| 会員のクラス | Free 等の利用者の区分。AI を使えるか・枠の大きさを決める |
| 予約・確定・解放 | 呼び出しの前に枠を予約し、結果で確定、失敗で解放する台帳の手順 |
| 鍵の確認 | 登録した提供元の鍵が有効かを確かめること(72 時間で失効) |
| 接続口だけ | 有料の提供元は、鍵があれば動くが今は接続していない状態 |
| テストモード | Stripe の試験用の決済(本番の請求をしない) |

## 状態機械・Event・Error(v5.1 のまま + v6.0)

| Aggregate | 許可状態遷移 |
|---|---|
| Share | DRAFT→ACTIVE→EXPIRED/REVOKED/LOCKED。REVOKED/EXPIREDは終端 |
| Export | QUEUED→RUNNING→READY→EXPIRED、QUEUED/RUNNING→FAILED/CANCELED |
| OfflinePack | QUEUED→BUILDING→READY→STALE→SYNCING→READY、任意→REVOKED/FAILED |
| Visit | OBSERVED→ASSESSED→CONFIRMED/CORRECTED/HIDDEN/DELETED。手動状態は自動上書き禁止 |
| Subscription | TRIALING→ACTIVE→PAST_DUE→GRACE→CANCELED/EXPIRED |
| 日ごとの案(v6.0) | 控え⇄今(1 日に今は 1 つ)。切り替えは記録を残し、元に戻すも 1 つの切り替えとして記録 |

Event envelopeはevent_id UUID、type、schema_version、occurred_at、actor_type/id、tenant_id、aggregate_type/id/version、correlation_id、causation_id、policy_decision_id、payloadを持つ。payloadへtoken、秘密平文、精密座標を載せない。主要eventはQuickDraftPromoted、ShareCreated/Viewed/Revoked、ExportReady/Expired、OfflinePackReady/Synced/Revoked、LocationConsentChanged、VisitObserved/Assessed/Corrected/Hidden/Deleted、AtlasRebuilt、PlanConvertedToMemory、MemoryReplanned、EntitlementChanged。

追加error(設計の名前): SHARE_EXPIRED/REVOKED/PIN_LOCKED、FIELD_REDACTED、EXPORT_EXPIRED、OFFLINE_PACK_REVOKED/TOO_LARGE、SYNC_CONFLICT、VISIT_LOW_CONFIDENCE、LOCATION_CONSENT_REQUIRED/PERMISSION_REVOKED、ENTITLEMENT_REQUIRED/QUOTA_EXCEEDED。実装の code は `docs/spec/error-catalog.md`。

## v6.0 共通不変条件(v5.1 のまま)

1. Quick/Advancedは同一Travel Information Graphの段階的開示であり、別形式へ保存しない。
2. 共有、検索、通知、AI、PDF、Offline、監査ログはfield-level Policy Decisionを必ず通過する。
3. 予定と実績は別Revisionで保存し、推定は根拠・confidence・algorithm_versionを持つ。
4. 自動処理は確定済み旅程を無断更新せず、差分、理由、影響、承認、Undoを提供する。
5. 秘密、位置、券、予約、健康、決済は最小化・暗号化・目的制限・保持期限・削除伝播を適用する。
6. 「実装済み」はDOC-10にcommit、test、migration、deploy、観測証拠が揃った場合だけ宣言する。

## 20. 相談の言葉(v6.0 追加)

| 用語 | 意味 |
|---|---|
| 相談 | 旅行の話し合いの画面(SC-19・SC-20)。話し合いが中心で、投票は必要な時だけ |
| 話し合い | 旅行全体へのコメント(発言)のスレッド |
| これで決まり | 投票をせずに、話し合いで決めたことを「決まったこと」に記録する操作(polls.mode=decision) |
| 決まったこと | 「これで決まり」の記録と、決定した投票の一覧。旅程に反映できる |
| 投票にする | 発言から投票を作る操作。題名と選択肢の下書きを発言から作る(元の発言 polls.source_comment_id) |
| かんたん投票 | 1人1つ選ぶ投票(polls.mode=simple。画面の既定) |
| 詳しい投票 | Love/OK/懸念/不可の4段階・定足数・「不可」の扱いを使う投票(polls.mode=detailed) |

## 21. スポットモードの言葉(v6.0 追加。FR-060)

| 用語 | 意味 |
|---|---|
| 自由に歩くエリア | 旅程の中で順番を決めずに歩く範囲。日・時間枠・集合・範囲と、中の候補(spot_areas / spot_area_items) |
| スポットモード | エリアの中を地図と一覧で歩く画面(SC-49)。予定(当日の画面)といつでも切り替える |
| 行きたい / 気分で | エリアの候補の優先。行きたい = 行くつもり、気分で = その時次第 |
| 行きたい印 | メンバーが自分で付ける印(閲覧者も付けられる。本人の分だけ外せる) |
| 着いた / 今日はやめる | エリアの候補の当日の状態。候補箱の候補の状態は変えない |
| 戻り始め | 集合の時刻から、今いる場所から集合の場所まで歩く時間を引いた時刻 |
| 次どこ？ | 気分・近さ・行きたい印・営業時間・残り時間で次の候補を並べる案内(AI なし) |
| 道順の目安 | 今いる場所から候補への直線。道順ではない |
| 方角で見る | 地図の代わりに、候補の方角と距離を一覧で出す見方(圏外でも端末で計算) |
| 別行動 | エリアの中でメンバーが集合の場所・時刻だけを約束して分かれること(spot_area_splits。位置は持たない) |
| 合流した | 自分の別行動の約束を消す操作 |
| 自由に歩いた | 旅帖(旅行記の下書き)に入る、エリアで着いた候補の着いた時刻の順の記録 |


## 23. 日帰り・今度行きたい の言葉(v6.0 追加。FR-061・FR-062)

| 用語 | 意味 |
|---|---|
| 日帰り | `travel_plans.trip_style = day_trip` の旅行。行き・帰りのルートは day_trip_routes |
| ルートの幅 | ルートの線からの距離の上限(300m / 1km / 3km / 5km) |
| 寄り道 | ルートから外れて立ち寄る場所 |
| 寄り道の時間 | 追加の時間の目安(往復 + 3 分。下道 30km/h・高速は近い IC・SA/PA から 40km/h。分からない時は +約 15 分の札) |
| あなた向け | 好みの傾向(保存しない。本人の応答だけ)で並べること |
| 今度行きたい | 行きたい場所の wish_kind `next`(null の今までの行も今度に数える) |
| また行きたい | wish_kind `again`。同じ場所を残すと again_count が増える |
| エリア(行きたい場所) | wish_scope `area`(半径 radius_m) |
| 近くに来たら知らせる | remind_nearby。端末の中だけで比べる知らせ(当日の画面・スポットモードの間だけ・1 日 1 回) |
| 残した元 | source_kind・source_label(旅行を消しても名前の写しで出す) |

## 22. 旅行の状態と段階(2026-11-20 追記。実装の言葉を記録したもの)

旅行には、**利用者が選ぶ「状態」**と、**日付から決まる「段階」**の 2 つがあり、別の物。

| 種類 | 語 | 意味 | 正本(コード) |
|---|---|---|---|
| 状態 | 計画中 | 行くつもりで計画している | `frontend/src/pages/dashboard/shelfModel.ts` の `SHELF_TEXT` |
| 状態 | 検討中 | 行くかどうか決めていない | 同上 |
| 状態 | 行った旅 | 行き終えた旅行 | 同上 |
| 状態 | 見送り・中止 | 行かないことにした | 同上 |
| 段階 | 旅行前・旅行中・旅行後・日付未定 | 旅行の日付と今日から決まる(ホームの見出し・旅行中の欄) | `frontend/src/pages/dashboard/dashboardModel.ts` の `PHASE_LABEL` |

- 状態の名前はホーム・旅行の一覧で同じ正本を使う(以前は 3 か所に同じ表があった)。
- 指示書の案「検討中/計画中/出発前/旅行中/旅行後」のように状態と段階を 1 列にまとめるかは、**未決**(画面の言葉の変更になるため、利用者の承認が要る)。

## 改訂履歴

| 版 | 日付 | 内容 |
|---|---|---|
| v5.1 | 2026-09-03 | 資料室。保管 |
| **v6.0** | 2026-11-17 | リポジトリの正本へ。§15〜19 の実装の言葉、エラーの code の正本を error-catalog に、ブランチを廃止の語に。§20 相談の言葉(Gate ChatConsensus)。§21 スポットモードの言葉(Gate SpotMode)。§23 日帰り・今度行きたいの言葉(FR-061・FR-062) |
