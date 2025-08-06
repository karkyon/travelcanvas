#!/usr/bin/env python3
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
            lines = content.split('\n')
            for i, line in enumerate(lines):
                if line.startswith('from app.api.v1'):
                    lines.insert(i+1, "from app.api.v1 import spots")
                    break
            content = '\n'.join(lines)
            print("✅ spotsインポート追加（新規）")
    
    # spotsルーター追加
    if "app.include_router(spots.router" not in content:
        if 'app.include_router(auth.router, prefix="/api/v1")' in content:
            content = content.replace(
                'app.include_router(auth.router, prefix="/api/v1")',
                'app.include_router(auth.router, prefix="/api/v1")\napp.include_router(spots.router, prefix="/api/v1")'
            )
            print("✅ spotsルーター追加")
        else:
            # FastAPIアプリの末尾に追加
            content += '\napp.include_router(spots.router, prefix="/api/v1")'
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
    print("\n🔄 サーバー再起動手順:")
    print("  1. 現在のサーバーを停止 (Ctrl+C)")
    print("  2. tc-backend で再起動")
    print("  3. http://192.168.1.248:8000/docs で確認")

if __name__ == "__main__":
    print("🔧 TravelCanvas スポットAPI修正スクリプト")
    print("=" * 50)
    
    if fix_main_py():
        restart_server_instruction()
        print("\n✅ 修正完了！サーバーを再起動してください")
    else:
        print("\n❌ 修正に失敗しました")
