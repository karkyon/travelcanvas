"""[Gate G1] GOV-01/02/04 DOC-10 の正本(docs/spec/DOC-10_*.md)と、状態の機械が読む正本(docs/trace/fr-status.json)。

- 全58 FR が fr-status.json にあり、状態は判定の段だけ。(部分)は VERIFIED にしない
- VERIFIED の集合が証拠の台帳(v1-verification-ledger.json)と一致する
- DOC-10 の表・集計(生成部分)が fr-status.json から作った物と一致する(手で直すと落ちる)
- DOC-10 に書いた Alembic head が実際の head と一致し、基準 commit が履歴にある(履歴がある時)
- trace の索引(docs/trace/INDEX.md)が全ての trace を挙げ、後の Gate で解消した行に SUPERSEDED BY がある

リポジトリの根(docs・scripts)が無い場所(omega-dev2 の backend コンテナ)では飛ばす。CI の backend ジョブで必ず走る。
"""
import importlib.util
import json
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FR_STATUS = ROOT / "docs" / "trace" / "fr-status.json"
LEDGER = ROOT / "docs" / "trace" / "v1-verification-ledger.json"
RENDER = ROOT / "scripts" / "ci" / "render_doc10.py"

pytestmark = pytest.mark.skipif(not (FR_STATUS.is_file() and RENDER.is_file()),
                                reason="リポジトリの根が無い(backend コンテナの中)")

STATES = ("IDEA", "SPECIFIED", "SCAFFOLDED", "IMPLEMENTED", "INTEGRATED", "VERIFIED", "RELEASED")


@pytest.fixture(scope="module")
def render():
    spec = importlib.util.spec_from_file_location("render_doc10_g1", RENDER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _status():
    return json.loads(FR_STATUS.read_text(encoding="utf-8"))


def test_every_fr_has_a_valid_state():
    feats = _status()["features"]
    assert list(feats) == ["FR-%03d" % i for i in range(1, 59)]
    for fr, f in feats.items():
        assert f["status"] in STATES, fr
        assert f["e2e"] in ("✓", "一部", "✗"), fr
        assert f["title"] and f["gaps"], fr
        if f["partial"]:
            assert f["status"] in ("IMPLEMENTED", "INTEGRATED"), "%s: (部分)は INTEGRATED までにする" % fr
        if f["status"] in ("VERIFIED", "RELEASED"):
            assert f["e2e"] == "✓", "%s: E2E の無い機能は VERIFIED にしない" % fr


def test_verified_set_matches_evidence_ledger():
    feats = _status()["features"]
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))["features"]
    verified = {fr for fr, f in feats.items() if f["status"] == "VERIFIED"}
    ledger_verified = {fr for fr, f in ledger.items() if f["status"] == "VERIFIED"}
    assert verified == ledger_verified, {"fr-status だけ": sorted(verified - ledger_verified),
                                         "台帳だけ": sorted(ledger_verified - verified)}


def test_doc10_generated_parts_match_status(render):
    path = render.doc10_path()
    text = path.read_text(encoding="utf-8")
    assert render.rendered(text, render.load_status()) == text, \
        "DOC-10 の表・集計が fr-status.json と違う。python3 scripts/ci/render_doc10.py を実行する"
    rows = re.findall(r"^\| (FR-\d{3}) \|", text, re.M)
    assert rows == ["FR-%03d" % i for i in range(1, 59)]


def test_doc10_states_migration_head_and_baseline_commit(render):
    text = render.doc10_path().read_text(encoding="utf-8")
    head = render.stated(text, "Alembic head")
    assert render.alembic_heads() == [head], "DOC-10 §0.1 の Alembic head を実際の head(%s)に直す" % render.alembic_heads()
    base = render.stated(text, "基準commit")
    assert base and re.fullmatch(r"[0-9a-f]{7,40}", base)
    try:
        shallow = subprocess.run(["git", "-C", str(ROOT), "rev-parse", "--is-shallow-repository"],
                                 capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.SubprocessError):
        pytest.skip("git が無い")
    if shallow.returncode != 0 or shallow.stdout.strip() != "false":
        pytest.skip("履歴が浅い(fetch-depth 1)")
    known = subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", base, "HEAD"],
                           capture_output=True, text=True, timeout=10)
    assert known.returncode == 0, "DOC-10 の基準commit %s が HEAD の履歴に無い" % base


def test_summary_numbers(render):
    s = render.summary_numbers(render.load_status())
    assert s["total"] == 58
    assert s["verified"] == len(s["verified_list"])
    assert 0 <= s["weighted_percent"] <= 100


def test_v1_ledger_partial_set_comes_from_status():
    from tests import test_gate_v1_verification_ledger as v1

    partial = {fr for fr, f in _status()["features"].items() if f["partial"]}
    assert v1.partial_features() == partial


def test_trace_index_lists_every_trace_and_superseded_rows_are_marked():
    spec = importlib.util.spec_from_file_location("render_trace_index_g1",
                                                  ROOT / "scripts" / "ci" / "render_trace_index.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    index = (ROOT / "docs" / "trace" / "INDEX.md").read_text(encoding="utf-8")
    assert module.render() == index, "docs/trace/INDEX.md が古い。python3 scripts/ci/render_trace_index.py を実行する"
    for trace in sorted((ROOT / "docs" / "trace").glob("gate-*-trace.md")):
        assert trace.name in index, "docs/trace/INDEX.md に %s が無い" % trace.name
    # 後の Gate で解消した(古い)行。SUPERSEDED BY が無いまま残すと、全文検索で残件と誤認する
    stale = {
        "gate-b012-trace.md": "個別削除の同種500",
        "gate-l2-fr016-trace.md": "最適化への制約反映",
        "gate-l3-fr017-trace.md": "最適化への制約反映",
        "gate-s1-trace.md": "main ブランチの保護",
        "gate-s11-trace.md": "main の保護(必須の CI",
        "gate-s2-trace.md": "管理者 MFA・CAPTCHA・共有のレート制限",
        "gate-s3-trace.md": "異常の自動検知・段階的な対応",
        "gate-s4-trace.md": "異常の自動検知・段階的な対応",
        "gate-s8-trace.md": "暗号化の鍵の版の切り替え",
        "gate-v2-trace.md": "CANDIDATE(候補)",
        "gate-p5-trace.md": "ICS/GPX/KML/CSVの取込",
        "gate-p6-trace.md": "アカウント単位の削除・同意撤回・訂正",
        "gate-o1-trace.md": "保存ファイルの中身の復号確認",
        "gate-r2-trace.md": "retention purge・真の並行性テスト",
    }
    for name, needle in stale.items():
        body = (ROOT / "docs" / "trace" / name).read_text(encoding="utf-8")
        rows = [line for line in body.splitlines() if needle in line and line.startswith("|")]
        assert rows, "%s: %s の行が無い" % (name, needle)
        assert all("SUPERSEDED BY" in r for r in rows), "%s: %s の行に SUPERSEDED BY が無い" % (name, needle)
