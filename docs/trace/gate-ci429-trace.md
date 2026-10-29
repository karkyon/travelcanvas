# Gate CI-429 トレース(CI の E2E の 429 連鎖の原因の調査)

対象: G11 の残り「CI の 429 連鎖」(ハンドオフ 2026-10-29h §3 の 3)。閾値・点数の付け方・E2E の再試行は変えない(連鎖を隠さない)。
コードの変更は調べるための log と報告だけ。FR の状態の遷移なし。

## これまでの記録

| PR | run | 結果 | 接続元の点数(報告) |
|---|---|---|---|
| #13 | pull_request 40783537644 | e2e が member-policy から 27 件 429 → 再実行で合格 | 報告なし |
| #15 | pull_request job 123214120657 | gate-g4 COL-05 から 50 件 429(再実行せず、次の commit で合格) | 報告なし |
| #15 | 7805b5a の 2 run | 合格 | 見積もり 合計 240・242、窓の最大 218・220 |
| #16 | 2 run | 合格 | 見積もり 合計 232・274、窓の最大 210・252 |
| #17 | pull_request job 123372260534 | gate-g11-style のあたりから 54 件 429 → 1回だけ再実行(job 123381377876)で合格 | 遮断 `09:48:52 点数 150`。見積もりは遮断の後の 429 を含み 672 |

サンドボックスの全件(Redis MONITOR で実測): 加算 41 回・合計 117(最後の zz-security-challenge の 60 を除くと 57)、900 秒の窓の最大 95。

## この Gate で足したこと

| # | 内容 | 状態 | 証拠 |
|---|---|---|---|
| 1 | threat_guard が点数を足すたびに、足した点数・種類・経路の型・合計を log に出す(ID・値・IP は出さない) | IMPLEMENTED | `app/services/threat_guard.py` `record_signal`・`signal`、BE `test_guard_logs_route_template_without_ids_or_ip` |
| 2 | CI の報告で、実際の点数の合計・最大と、**最初の遮断より前**の内訳(種類と経路の型)を出す(遮断の後の 429 で見積もりが埋もれない) | IMPLEMENTED | `scripts/ci/e2e_guard_report.py`、BE `test_actual_signals_before_first_block` |
| 3 | 原因の特定と直し | NOT STARTED | 次の CI の run の実際の内訳で決める |

## 検証(サンドボックス。CI・omega-dev2 とは別)

| 検査 | 結果(2026-10-29) |
|---|---|
| 全検証 | backend pytest 1,298 合格(新規 2)・flake8・mypy 0・vitest・build 合格 |
| E2E(全件) | **90 合格・失敗 0・再試行 0** |
| 実際の点数(新しい log) | 合計 117・最大 60。多いのは `invalid_token /api/v1/auth/me` 66(22回)・`rate_limited /api/v1/auth/register` 27(9回)・`login_failed` 5、残りは権限の試験の 403/404 が 2 点ずつ |
