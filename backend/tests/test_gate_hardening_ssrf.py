"""[Gate Hardening-A・監査 SEC-009] Web ページの 1 ページの読み取り(app/services/url_place.py)の内部の宛先の拒否。

既存の試験(test_gate_remaining6_account.py)は public_addresses を差し替えて画面の文を確かめるだけで、拒否の判定そのものは
確かめていなかった。ここは判定を差し替えずに確かめる(IP の literal は名前の解決に通信が要らない)。
"""
import socket

import httpx
import pytest

from app.services import url_place as up


@pytest.mark.parametrize("host", ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.11", "169.254.169.254",
                                  "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1"])
def test_private_loopback_link_local_and_metadata_addresses_are_refused(host):
    with pytest.raises(up.PageUnavailable):
        up.public_addresses(host, 80)


def test_public_address_is_allowed():
    assert up.public_addresses("93.184.216.34", 443) == ["93.184.216.34"]


@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://93.184.216.34/", "http://93.184.216.34:8080/",
                                 "https://user:pw@93.184.216.34/", "gopher://93.184.216.34/", "http:///nohost"])
def test_scheme_port_and_credentials_are_refused(url):
    with pytest.raises(up.PageUnavailable):
        up.check_url(url)


def test_name_that_resolves_to_any_private_address_is_refused(monkeypatch):
    """DNS の答えに 1 つでも内部のアドレスが混ざれば読まない(DNS rebinding の一部の対策)"""
    real = socket.getaddrinfo

    def fake(host, port, *a, **k):
        if host == "mixed.example":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port)),
                    (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.2.3", port))]
        return real(host, port, *a, **k)

    monkeypatch.setattr(up.socket, "getaddrinfo", fake)
    with pytest.raises(up.PageUnavailable):
        up.public_addresses("mixed.example", 443)


def test_redirect_to_internal_address_is_refused(monkeypatch):
    """公開のページから内部(クラウドの metadata)への転送は、転送の先を確かめ直して止める"""
    real = socket.getaddrinfo

    def fake(host, port, *a, **k):
        if host == "public.example":
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", port))]
        return real(host, port, *a, **k)

    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return httpx.Response(302, headers={"location": "http://169.254.169.254/latest/meta-data/"})

    monkeypatch.setattr(up.socket, "getaddrinfo", fake)
    monkeypatch.setattr(up, "transport", httpx.MockTransport(handler))
    with pytest.raises(up.PageUnavailable):
        up._fetch("https://public.example/")
    assert len(seen) == 1 and "169.254.169.254" not in seen[0]  # 内部へは 1 度もつながない
