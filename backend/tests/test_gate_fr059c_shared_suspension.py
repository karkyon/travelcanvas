"""
[FR059-C] FR-059 正本 §13 D14: provider の停止(見込みの超過・請求の照合の差)を全ての worker で共有する。

以前はプロセスの中の印だけで、複数の worker では止めた worker だけが止まり、他の worker は呼び続けた。
- Redis に届く時: 印は Redis(回数制限と同じ名前空間)。別のプロセス(運用のコマンド)が戻すと全ての worker で戻る
- Redis を使わない設定(試験・CI の backend ジョブ)・届かない時: このプロセスの印で止める(止めた印を忘れない)
- 届かない間に付けた印は、届いた時に Redis へ送る

Redis を使う試験は試験ごとに別の名前空間を使い、終わったら消す。Redis に届かない環境では Redis の試験だけを飛ばす
(CI は TC_REQUIRE_REDIS=1 で飛ばさない。tests/redis_support.py)。
"""
import json
import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
import redis as redis_lib

from app.core.config import settings
from app.ops import metrics
from app.services import cost_guard as cg
from app.utils import rate_limiter as rl
from tests.redis_support import needs_redis

P = "fake-paid-provider"
BACKEND = Path(__file__).resolve().parents[1]

# 別の process(別の worker と同じ: プロセスの中の印を持たない)で、同じ名前空間の共有の印を読み書きする
_WORKER = r"""
import json, sys
from app.core.config import settings
from app.utils import rate_limiter as rl
from app.services import cost_guard as cg
settings.RATE_LIMIT_NAMESPACE = sys.argv[1]
rl.use_backend("redis")
action, name = sys.argv[2], sys.argv[3]
if action == "suspend":
    print(json.dumps({"shared": cg.suspend_provider(name, "settled_over_estimate")}))
elif action == "resume":
    print(json.dumps({"shared": cg.resume_provider(name, reason="worker")}))
else:
    print(json.dumps({"suspended": cg.is_suspended(name), "all": cg.suspended_providers()}))
"""


def _worker(namespace: str, action: str, name: str = P) -> dict:
    out = subprocess.run([sys.executable, "-c", _WORKER, namespace, action, name], cwd=str(BACKEND),
                         env=dict(os.environ), capture_output=True, text=True, timeout=60, check=True)
    return json.loads(out.stdout.strip().splitlines()[-1])


@pytest.fixture(autouse=True)
def _clean():
    cg._suspended.clear()
    cg._unsynced.clear()
    yield
    cg._suspended.clear()
    cg._unsynced.clear()


@pytest.fixture()
def shared(monkeypatch):
    monkeypatch.setattr(settings, "RATE_LIMIT_NAMESPACE", f"tc-test-{uuid.uuid4().hex[:8]}")
    rl.set_redis_client_for_testing(None)
    rl.use_backend("redis")
    client = redis_lib.Redis.from_url(settings.REDIS_URL)
    yield client
    client.delete(cg._shared_key())
    rl.use_backend("memory")
    rl.set_redis_client_for_testing(None)


def test_memory_backend_suspends_in_process():
    assert cg.suspend_provider(P, "settled_over_estimate") is False  # 共有はしていない
    assert cg.is_suspended(P)
    assert cg.suspended_providers() == {P: "settled_over_estimate"}
    assert cg.resume_provider(P, reason="単価の改定を確認") is False
    assert not cg.is_suspended(P)


@needs_redis
def test_suspension_is_shared_and_resumed_from_another_process(shared):
    assert cg.suspend_provider(P, "reconciliation_delta") is True
    assert shared.hget(cg._shared_key(), P) == b"reconciliation_delta"
    # 別の worker(このプロセスの印が無い)も止まる
    cg._suspended.clear()
    assert cg.is_suspended(P)
    assert cg.suspended_providers() == {P: "reconciliation_delta"}
    # 運用者が別のプロセスから戻すと、止めた worker の古い印でも止め続けない
    cg._suspended[P] = "reconciliation_delta"
    shared.hdel(cg._shared_key(), P)
    assert not cg.is_suspended(P)
    assert cg.resume_provider(P, reason="確認済み") is True
    assert cg.suspended_providers() == {}


@needs_redis
def test_suspension_while_redis_is_down_is_kept_and_sent_later(shared, monkeypatch):
    metrics.registry.reset()
    dead = redis_lib.Redis(host="127.0.0.1", port=1, socket_timeout=0.2, socket_connect_timeout=0.2)
    rl.set_redis_client_for_testing(dead)
    rl.use_backend("auto")
    assert cg.suspend_provider(P, "settled_over_estimate") is False
    assert cg.is_suspended(P)  # 届かない間もこのプロセスでは止まる
    assert "provider_suspension_unshared" in metrics.registry.render()
    # Redis が戻ると、未送の印を送ってから判定する(止めた印を失わない)
    rl.set_redis_client_for_testing(None)
    rl.use_backend("redis")
    assert cg.is_suspended(P)
    assert shared.hget(cg._shared_key(), P) == b"settled_over_estimate"
    assert cg._unsynced == {}


@needs_redis
def test_suspension_and_resume_cross_real_processes(shared):
    """別の process(別の worker)で止めると、この process でも止まり、この process で戻すと別の process でも戻る。"""
    ns = settings.RATE_LIMIT_NAMESPACE
    assert _worker(ns, "suspend") == {"shared": True}
    assert cg._suspended == {}  # この process の印は無い(共有の印だけで止まる)
    assert cg.is_suspended(P)
    assert cg.suspended_providers() == {P: "settled_over_estimate"}
    assert cg.resume_provider(P, reason="確認済み") is True
    assert _worker(ns, "status") == {"suspended": False, "all": {}}


@needs_redis
def test_namespaces_are_isolated(shared, monkeypatch):
    """名前空間(環境ごとの RATE_LIMIT_NAMESPACE)が違えば、停止の印は混ざらない。"""
    ns = settings.RATE_LIMIT_NAMESPACE
    other = f"tc-test-{uuid.uuid4().hex[:8]}"
    try:
        assert _worker(other, "suspend") == {"shared": True}
        assert not cg.is_suspended(P)
        assert _worker(other, "status")["suspended"] is True
        assert _worker(ns, "status") == {"suspended": False, "all": {}}
    finally:
        shared.delete(f"{other}:costguard:suspended")


@needs_redis
def test_earlier_shared_reason_is_not_overwritten(shared):
    shared.hset(cg._shared_key(), P, "reconciliation_delta")
    cg._unsynced[P] = "settled_over_estimate"
    assert cg.is_suspended(P)
    assert shared.hget(cg._shared_key(), P) == b"reconciliation_delta"


def test_reserve_refuses_while_suspended(db_session):
    from tests.test_gate_fr059_cost_guard import FAKE, _key, _plan, _user

    member = _user(db_session)
    plan = _plan(db_session, member)
    cg.suspend_provider(FAKE, "settled_over_estimate")
    try:
        with pytest.raises(cg.CostGuardError) as e:
            cg.reserve(db_session, plan, member, "map.load", FAKE, {"loads": 1}, _key())
        assert e.value.code == "provider_suspended" and e.value.status == 503
    finally:
        cg.resume_provider(FAKE)


def test_ops_command_requires_confirmation_and_reason(monkeypatch, capsys):
    import importlib.util
    from pathlib import Path

    path = Path(__file__).resolve().parents[1] / "scripts" / "security_incident.py"
    spec = importlib.util.spec_from_file_location("security_incident_fr059c", path)
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    monkeypatch.setattr(mod, "_shared", lambda: True)
    monkeypatch.setattr(mod.rate_limiter, "use_backend", lambda name: None)
    cg.suspend_provider(P, "settled_over_estimate")
    assert mod.main(["provider-status"]) == mod.EXIT_OK
    assert '"fake-paid-provider": "settled_over_estimate"' in capsys.readouterr().out
    assert mod.main(["provider-resume", "--provider", P]) == mod.EXIT_USAGE
    assert mod.main(["provider-resume", "--provider", P, "--yes"]) == mod.EXIT_USAGE  # 理由が要る
    assert cg.is_suspended(P)
    assert mod.main(["provider-resume", "--provider", P, "--yes", "--reason", "単価の改定を確認"]) == mod.EXIT_OK
    assert not cg.is_suspended(P)
    monkeypatch.setattr(mod, "_shared", lambda: False)
    cg.suspend_provider(P, "settled_over_estimate")
    assert mod.main(["provider-resume", "--provider", P, "--yes", "--reason", "x"]) == mod.EXIT_NO_EFFECT
    assert cg.is_suspended(P)  # 全 worker に伝えられない時は戻さない
