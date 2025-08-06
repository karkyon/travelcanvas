#!/usr/bin/env python3
"""
スポットAPI表示問題診断スクリプト
"""
import os
import json

def check_main_file():
    """app/main.py の内容確認"""
    print("🔍 app/main.py 確認中...")
    
    main_file = "app/main.py"
    if not os.path.exists(main_file):
        print("  ❌ app/main.py が見つかりません")
        return False
    
    with open(main_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    checks = {
        "spots_import": "from app.api.v1 import spots" in content,
        "spots_router": "spots.router" in content,
        "include_router_spots": "app.include_router(spots.router" in content
    }
    
    print("  📋 インポート・ルーター確認:")
    for check, result in checks.items():
        status = "✅" if result else "❌"
        print(f"    {status} {check}: {result}")
    
    if not all(checks.values()):
        print("\n  🔧 修正が必要な箇所:")
        if not checks["spots_import"]:
            print("    - spotsモジュールのインポートが不足")
        if not checks["spots_router"]:
            print("    - spotsルーターの追加が不足")
    
    return all(checks.values())

def check_spots_api_file():
    """app/api/v1/spots.py 確認"""
    print("\n🔍 app/api/v1/spots.py 確認中...")
    
    spots_file = "app/api/v1/spots.py"
    if not os.path.exists(spots_file):
        print("  ❌ spots.py が見つかりません")
        return False
    
    with open(spots_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    checks = {
        "router_creation": "router = APIRouter" in content,
        "prefix_spots": 'prefix="/spots"' in content,
        "tags_spots": 'tags=["spots"]' in content,
        "create_endpoint": "@router.post" in content,
        "get_endpoints": "@router.get" in content
    }
    
    print("  📋 APIエンドポイント確認:")
    for check, result in checks.items():
        status = "✅" if result else "❌"
        print(f"    {status} {check}: {result}")
    
    return all(checks.values())

def check_api_v1_init():
    """app/api/v1/__init__.py 確認"""
    print("\n🔍 app/api/v1/__init__.py 確認中...")
    
    init_file = "app/api/v1/__init__.py"
    if not os.path.exists(init_file):
        print("  ❌ __init__.py が見つかりません")
        return False
    
    with open(init_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    print(f"  📄 内容: {len(content)} 文字")
    if "spots" in content:
        print("  ✅ spots への参照が存在")
    else:
        print("  ⚠️  spots への参照が見当たらない")
    
    return True

def check_imports_and_dependencies():
    """インポートと依存関係確認"""
    print("\n🔍 インポート・依存関係確認中...")
    
    # models確認
    models_file = "app/models/models.py"
    if os.path.exists(models_file):
        with open(models_file, 'r', encoding='utf-8') as f:
            models_content = f.read()
        
        if "class Spot(" in models_content:
            print("  ✅ Spotモデル存在")
        else:
            print("  ❌ Spotモデルが見つかりません")
    
    # schemas確認
    schemas_file = "app/schemas/spots.py"
    if os.path.exists(schemas_file):
        print("  ✅ スポットスキーマ存在")
    else:
        print("  ❌ app/schemas/spots.py が見つかりません")

def generate_fix_script():
    """修正スクリプト生成"""
    print("\n🛠️  修正スクリプト生成中...")
    
    fix_script = '''#!/usr/bin/env python3
"""
スポットAPI修正スクリプト
"""
import os
import shutil

def fix_main_py():
    """app/main.py にスポットルーター追加"""
    main_file = "app/main.py"
    
    if not os.path.exists(main_file):
        print("❌ app/main.py が見つかりません")
        return False
    
    # バックアップ作成
    backup_file = f"{main_file}.backup_spot_fix"
    shutil.copy2(main_file, backup_file)
    print(f"✅ {main_file} を {backup_file} にバックアップ")
    
    with open(main_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    
    # spotsインポート追加
    if "from app.api.v1 import spots" not in content:
        if "from app.api.v1 import auth" in content:
            content = content.replace(
                "from app.api.v1 import auth",
                "from app.api.v1 import auth, spots"
            )
            print("✅ spotsインポート追加")
        else:
            # インポートセクションを探して追加
            lines = content.split('\\n')
            for i, line in enumerate(lines):
                if line.startswith('from app.api.v1'):
                    lines.insert(i+1, "from app.api.v1 import spots")
                    break
            content = '\\n'.join(lines)
            print("✅ spotsインポート追加（新規）")
    
    # spotsルーター追加
    if "app.include_router(spots.router" not in content:
        if 'app.include_router(auth.router, prefix="/api/v1")' in content:
            content = content.replace(
                'app.include_router(auth.router, prefix="/api/v1")',
                'app.include_router(auth.router, prefix="/api/v1")\\napp.include_router(spots.router, prefix="/api/v1")'
            )
            print("✅ spotsルーター追加")
        else:
            # FastAPIアプリの末尾に追加
            content += '\\napp.include_router(spots.router, prefix="/api/v1")'
            print("✅ spotsルーター追加（末尾）")
    
    # 変更があった場合のみ保存
    if content != original_content:
        with open(main_file, 'w', encoding='utf-8') as f:
            f.write(content)
        print("✅ app/main.py 更新完了")
        return True
    else:
        print("ℹ️  app/main.py は既に正しく設定されています")
        return True

def restart_server_instruction():
    """サーバー再起動手順"""
    print("\\n🔄 サーバー再起動手順:")
    print("  1. 現在のサーバーを停止 (Ctrl+C)")
    print("  2. tc-backend で再起動")
    print("  3. http://192.168.1.248:8000/docs で確認")

if __name__ == "__main__":
    print("🔧 TravelCanvas スポットAPI修正スクリプト")
    print("=" * 50)
    
    if fix_main_py():
        restart_server_instruction()
        print("\\n✅ 修正完了！サーバーを再起動してください")
    else:
        print("\\n❌ 修正に失敗しました")
'''
    
    with open('fix_spots_api.py', 'w', encoding='utf-8') as f:
        f.write(fix_script)
    
    print("  ✅ fix_spots_api.py を作成")

def main():
    """メイン診断実行"""
    print("🔧 TravelCanvas スポットAPI診断")
    print("=" * 50)
    
    issues = []
    
    # 1. メインファイル確認
    if not check_main_file():
        issues.append("app/main.py の設定")
    
    # 2. スポットAPIファイル確認
    if not check_spots_api_file():
        issues.append("app/api/v1/spots.py の内容")
    
    # 3. __init__.py確認
    check_api_v1_init()
    
    # 4. 依存関係確認
    check_imports_and_dependencies()
    
    # 5. 修正スクリプト生成
    generate_fix_script()
    
    print("\\n📋 診断結果:")
    if issues:
        print("  ❌ 以下の問題が見つかりました:")
        for issue in issues:
            print(f"    - {issue}")
        
        print("\\n🚀 修正手順:")
        print("  1. python3 fix_spots_api.py")
        print("  2. サーバー再起動 (Ctrl+C → tc-backend)")
        print("  3. Swagger UI確認")
    else:
        print("  ✅ 設定は正常です")
        print("  💡 サーバーの再起動が必要かもしれません")

if __name__ == "__main__":
    main()
