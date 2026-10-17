"""[Gate O2] 試験の全実行中のログに、個人情報・秘密が出ていないことの判定(B-009)。

ファイル名を test_zz_ で始め、試験の最後に実行されるようにしている(pytest はファイル名の順に集める)。
ログの収集と秘密の登録は tests/conftest.py(LEAK_COLLECTOR)。
単独で実行した時は、その時点までに出たログだけを判定する。
"""


def test_no_personal_data_or_secrets_in_logs(request):
    collector = request.config._tc_leak_collector
    assert collector.records >= 0
    groups = {}
    for f in collector.findings:
        where = str(f["line"]) if str(f["kind"]).startswith("source:") else "出力"
        key = (str(f["kind"]), str(f["logger"]), where)
        groups.setdefault(key, []).append(str(f["excerpt"]))
    lines = ["%d件 %s %s %s 例: %s" % (len(v), k[0], k[1], k[2], v[0]) for k, v in sorted(groups.items())]
    assert not collector.findings, (
        "ログに個人情報・秘密が出ています(%d 件、ログ %d 件中、既知の秘密 %d 個で照合。"
        "source: は伏せる前の出どころ、それ以外は実際の出力):\n%s"
        % (len(collector.findings), collector.records, len(collector.secrets), "\n".join(lines))
    )
