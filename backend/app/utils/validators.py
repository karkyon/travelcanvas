"""
TravelCanvas の保存ファイルの拡張子の許可一覧。

[Gate G10-Q] 以前はこのモジュールに検証の関数が約20個あった(validate_username・validate_password_strength・
validate_file_upload など)が、どこからも呼ばれておらず(ghost code)、型の誤りも25件あった。
実際に使われているのは storage_backend が読む拡張子の一覧だけのため、それだけを残す。
入力の検証は各 API の Pydantic の schema と services 側で行う。
"""

# 許可されたファイル拡張子(app/services/storage_backend.py が使う)
ALLOWED_IMAGE_EXTENSIONS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'}
ALLOWED_DOCUMENT_EXTENSIONS = {'.pdf', '.doc', '.docx', '.txt', '.md'}
