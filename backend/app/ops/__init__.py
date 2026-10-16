"""[Gate O1] 運用(B-010)のための部品。

- ``opslib``: 標準ライブラリだけで書いた純粋関数(ホスト側CLI ``scripts/ops/tcops.py`` と
  コンテナ内の両方から import する)。このパッケージの ``__init__`` では app の設定を読まない。
- ``metrics``: backend のリクエスト計測(Prometheus のテキスト形式で ``/metrics`` に出す)。
- ``db_inventory`` / ``decrypt_check``: コンテナ内で実行する点検コマンド(件数・暗号の復号確認)。
"""
