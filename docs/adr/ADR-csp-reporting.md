# ADR: ブラウザからの CSP 違反の報告を受けて数える(Gate S10)

- 状態: 採用
- 対象: セキュリティ整理 SEC-15(検知の材料)・SEC-18(監視)
- 関連: `docs/adr/ADR-auth-hardening.md`(Gate S2 の CSP)、Runbook §3.11

## 背景

画面の CSP(S2)は、XSS で入り込んだスクリプトの外部読み込み・送信・eval をブラウザに止めさせる。しかし止めたことは
利用者のブラウザの中でしか分からず、運用側は「攻撃の試み」も「画面の更新で CSP に無い読み込み先を使って壊れた」も
知ることができなかった。

## 決定

1. CSP に `report-uri <API>/api/v1/security/csp-report` を付ける。`report-to`(Reporting API)は、まとめて遅れて送られ、
   付けると `report-uri` より優先されるため使わない(必要になれば Reporting-Endpoints と合わせて足す)。
2. `POST /api/v1/security/csp-report`(認証なし)は、旧形式(`application/csp-report`)と Reporting API の形式
   (`application/reports+json`)を受け取り、違反した指示と、止めた読み込み先のオリジンだけを取り出す。
   URL のパス・クエリ(トークンを含み得る)、画面の URL、スクリプトの断片は残さない。
3. 数は `/metrics` の `security_events_total{kind="csp_violation"}` と指示ごとの `csp_<指示>`(例 `csp_script_src`)(既知の指示だけ。
   それ以外は `csp_other`。偽の報告で種類を増やされない)。止めた先のオリジンと指示はログ(WARNING)に出す。
4. 本文は16KB まで、接続元ごとに1分60件まで(`RATE_LIMIT_CSP_REPORT`)。だれでも送れるため、自動遮断の点数(S6)には
   入れない(偽の報告で他人や自分の正規の画面を遮断させない)。
5. 監視(`tcops.py monitor`)は、前回から20件以上で `csp_violations`(注意)。

## 影響

- 拡張機能が差し込むスクリプトも報告される(`chrome-extension:` 等。対応不要)。
- 偽の報告で数だけを増やすことはできる(監視の注意が出る)。数は判断の材料で、自動の対応には使わない。
