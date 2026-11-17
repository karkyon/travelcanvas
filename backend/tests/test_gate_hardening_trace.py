"""[Gate Hardening-A・監査 G-01/G-03/G-09] 要求の追跡(docs/trace/fr-requirements.json)と正本の所在(docs/spec/canonical-sources.json)。

- 全59 FR に要求の出典・要約・受入があり、fr-status.json と同じ並び・題
- 書いた API・試験のファイル・画面の route・表が実在する(消す・名前を変えると落ちる)
- 証拠の区分が fr-status.json・ledger と食い違わない。実機・実 API・運用(本番)を、証拠のファイル無しに「済」にしない
- 共通正本(DOC-02/04/05/06/11/13)の所在と版・状態を記録し、DOC-10 がそれを参照する
- 人が読む表(FR-TRACE.md・CANONICAL-SOURCES.md)が JSON から作った物と一致する
- DOC-11 の対応表(docs/security/SECURITY-TRACE.md)が参照するファイルが実在する

リポジトリの根(docs・scripts)が無い場所(backend コンテナ)では飛ばす。CI の backend ジョブで必ず走る。
"""
import importlib.util
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
REQ = ROOT / "docs" / "trace" / "fr-requirements.json"
STATUS = ROOT / "docs" / "trace" / "fr-status.json"
LEDGER = ROOT / "docs" / "trace" / "v1-verification-ledger.json"
SOURCES = ROOT / "docs" / "spec" / "canonical-sources.json"
RENDER = ROOT / "scripts" / "ci" / "render_fr_trace.py"
SECURITY = ROOT / "docs" / "security" / "SECURITY-TRACE.md"
ADDENDUM = ROOT / "docs" / "audit" / "2026-11-17_product-hardening-gate_addendum.md"
SCENARIOS = ROOT / "docs" / "test" / "integrated-acceptance-scenarios.md"

pytestmark = pytest.mark.skipif(not (REQ.is_file() and RENDER.is_file()), reason="リポジトリの根が無い(backend コンテナの中)")

KINDS = ("requirement", "implementation", "integration", "e2e", "authz_failure", "device", "real_api", "ops")
STATES = ("done", "partial", "pending", "na")
GAP_CATS = {"未実装", "設定待ち", "実通信待ち", "実機待ち", "運用待ち", "利用者判断待ち"}
COMMON = {"DOC-02", "DOC-04", "DOC-05", "DOC-06", "DOC-11", "DOC-13"}


def _j(path):
    return json.loads(path.read_text(encoding="utf-8"))


def _req():
    return _j(REQ)["features"]


def _routes():
    text = (ROOT / "frontend" / "src" / "router" / "index.tsx").read_text(encoding="utf-8")
    return set(re.findall(r"path:\s*'([^']*)'", text))


def _tables():
    found = set()
    for p in (ROOT / "backend" / "app").rglob("*.py"):
        found |= set(re.findall(r'__tablename__\s*=\s*"([a-z0-9_]+)"', p.read_text(encoding="utf-8")))
    return found


def test_every_fr_has_requirement_source_summary_and_acceptance():
    status = _j(STATUS)["features"]
    req = _req()
    assert list(req) == list(status), "fr-requirements.json の FR の並びが fr-status.json と違う"
    for fr, f in req.items():
        assert f["title"] == status[fr]["title"], fr
        r = f["requirement"]
        assert r["source"] and r["summary"] and r["acceptance"] and r["priority"] and r["stage"], fr
        if fr == "FR-059":
            assert "docs/spec/FR-059_" in r["source"]
        else:
            assert r["source"].startswith("DOC-02"), "%s: 要求の出典は DOC-02(と DOC-15)" % fr
        for c in f["approved_changes"]:
            assert re.fullmatch(r"\d{4}-\d{2}(-\d{2})?", c["date"]), fr
            assert c["change"] and c["source"] and c["confidence"], fr


def test_referenced_code_tests_routes_and_tables_exist():
    routes, tables = _routes(), _tables()
    for fr, f in _req().items():
        for path in f["code"]["api"] + f["tests"]:
            assert (ROOT / path).is_file(), "%s: %s が無い" % (fr, path)
        for r in f["code"]["routes"]:
            assert r in routes or r.split("/")[-1] in routes, "%s: route %s が router に無い" % (fr, r)
        for t in f["code"]["tables"]:
            assert t in tables, "%s: 表 %s が無い" % (fr, t)
        backend = [t for t in f["tests"] if t.startswith("backend/tests/")]
        front = [t for t in f["tests"] if t.startswith("frontend/")]
        assert backend and front, "%s: backend と frontend の試験が1つ以上要る" % fr


def test_evidence_matches_status_and_ledger_and_never_overclaims():
    status = _j(STATUS)["features"]
    ledger = _j(LEDGER)["features"]
    for fr, f in _req().items():
        ev, st = f["evidence"], status[fr]
        assert set(ev) == set(KINDS), fr
        assert all(ev[k]["state"] in STATES and ev[k]["note"] for k in KINDS), fr
        assert ev["e2e"]["state"] == {"✓": "done", "一部": "partial", "✗": "pending"}[st["e2e"]], fr
        if st["partial"]:
            assert ev["implementation"]["state"] == "partial", "%s: (部分)の機能の実装を「済」にしない" % fr
        verified = st["status"] in ("VERIFIED", "RELEASED")
        assert (ev["authz_failure"]["state"] == "done") == verified, fr
        if verified:
            assert ledger.get(fr, {}).get("authz"), "%s: VERIFIED の権限の証拠が ledger に無い" % fr
        # 実機・実 API・本番の運用は、証拠のファイルを書かない限り「済」にしない(CI の模擬の成功を実の確認にしない)
        for k in ("device", "real_api", "ops"):
            if ev[k]["state"] in ("done", "partial"):
                files = ev[k].get("evidence_files") or []
                assert files and all((ROOT / p).is_file() for p in files), "%s: %s の証拠のファイルが無い" % (fr, k)
        assert (ev["real_api"]["state"] == "na") == (not f["external_providers"]), "%s: 外部の提供元と実 API の区分が食い違う" % fr
        if st["status"] != "RELEASED":
            assert ev["ops"]["state"] != "done", fr


def test_gap_categories_are_known_and_partial_features_name_what_is_missing():
    status = _j(STATUS)["features"]
    for fr, f in _req().items():
        cats = set(f["gap_categories"])
        assert cats <= GAP_CATS, "%s: 知らない分類 %s" % (fr, cats - GAP_CATS)
        if status[fr]["partial"]:
            assert cats - {"運用待ち"}, "%s: (部分)の機能は本番以外の不足の分類を書く" % fr


def test_canonical_sources_record_common_documents_and_doc10_points_to_them():
    src = _j(SOURCES)
    docs = {d["id"]: d for d in src["documents"]}
    assert COMMON <= set(docs)
    for d in docs.values():
        assert d["state"] in src["_meta"]["states"], d["id"]
        for p in d["repo_successors"]:
            assert (ROOT / p).exists(), "%s: %s が無い" % (d["id"], p)
    for i in COMMON:
        assert docs[i]["state"] == "approved_v5.1" and docs[i].get("common_canonical") is True, i
        assert docs[i]["version"] == "v5.1" and docs[i]["effective"] == "2026-09-03", i
    assert docs["DOC-10"]["state"] == "abolished"
    assert len({d["library_path"] for d in docs.values()}) == len(docs)
    doc10 = next((ROOT / "docs" / "spec").glob("DOC-10_*.md")).read_text(encoding="utf-8")
    assert "docs/spec/CANONICAL-SOURCES.md" in doc10 and "docs/trace/FR-TRACE.md" in doc10, \
        "DOC-10 が正本の所在(CANONICAL-SOURCES.md)と要求の追跡(FR-TRACE.md)を参照していない"


def test_rendered_tables_are_up_to_date():
    spec = importlib.util.spec_from_file_location("render_fr_trace_hardening", RENDER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    assert module.render_trace() == module.OUT_TRACE.read_text(encoding="utf-8"), \
        "docs/trace/FR-TRACE.md が古い。python3 scripts/ci/render_fr_trace.py を実行する"
    assert module.render_sources() == module.OUT_SOURCES.read_text(encoding="utf-8"), \
        "docs/spec/CANONICAL-SOURCES.md が古い。python3 scripts/ci/render_fr_trace.py を実行する"


def test_security_trace_references_exist():
    text = SECURITY.read_text(encoding="utf-8")
    paths = set(re.findall(r"`((?:backend|docs|scripts|frontend)/[A-Za-z0-9_./-]+\.(?:py|md|json|ts|tsx))`", text))
    assert len(paths) > 40
    for p in sorted(paths):
        assert (ROOT / p).is_file(), "SECURITY-TRACE.md の %s が無い" % p
    for i in range(1, 21):
        assert "| SEC-%03d |" % i in text, "SEC-%03d の行が無い" % i


def test_audit_addendum_and_acceptance_scenarios_cover_every_item():
    add = ADDENDUM.read_text(encoding="utf-8")
    for i in range(1, 19):
        assert "| G-%02d |" % i in add, "追補に G-%02d の再判定が無い" % i
    assert "総合テスト開始ゲート" in add and "本番リリースゲート" in add
    sc = SCENARIOS.read_text(encoding="utf-8")
    for i in range(1, 7):
        assert "## S%d " % i in sc, "縦断シナリオ S%d が無い" % i
    frs = set(re.findall(r"FR-0\d\d", sc))
    assert frs == set(_req()), "縦断シナリオに対応しない FR: %s" % sorted(set(_req()) - frs)
