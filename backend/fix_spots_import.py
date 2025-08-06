#!/usr/bin/env python3
"""
スポットインポートエラー修正スクリプト
"""
import os
import shutil

def check_main_py_content():
    """app/main.py の内容を確認"""
    print("🔍 app/main.py の内容確認中...")
    
    main_file = "app/main.py"
    if not os.path.exists(main_file):
        print("❌ app/main.py が見つかりません")
        return False
    
    with open(main_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    print("\n📄 現在のインポート部分:")
    lines = content.split('\n')
    for i, line in enumerate(lines[:20]):  # 最初の20行を表示
        if 'import' in line or 'from' in line:
            print(f"  {i+1}: {line}")
    
    print("\n📄 ルーター追加部分:")
    for i, line in enumerate(lines):
        if 'include_router' in line:
            print(f"  {i+1}: {line}")
    
    return content

def fix_spots_import():
    """スポットインポートを修正"""
    print("\n🔧 スポットインポート修正中...")
    
    main_file = "app/main.py"
    
    # バックアップ作成
    backup_file = f"{main_file}.backup_import_fix"
    shutil.copy2(main_file, backup_file)
    print(f"✅ {main_file} を {backup_file} にバックアップ")
    
    with open(main_file, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    
    # インポートセクションを探す
    import_section_end = 0
    for i, line in enumerate(lines):
        if line.startswith('from ') or line.startswith('import '):
            import_section_end = i
    
    # spotsインポートが既に存在するかチェック
    spots_imported = False
    for line in lines:
        if 'from app.api.v1 import' in line and 'spots' in line:
            spots_imported = True
            break
    
    if not spots_imported:
        # インポートを追加
        for i, line in enumerate(lines):
            if 'from app.api.v1 import auth' in line:
                # authと一緒にインポート
                lines[i] = line.replace('import auth', 'import auth, spots')
                spots_imported = True
                print("✅ authと一緒にspotsをインポート")
                break
        
        if not spots_imported:
            # 新規でインポート追加
            insert_pos = import_section_end + 1
            lines.insert(insert_pos, "from app.api.v1 import spots")
            print("✅ 新規でspotsインポートを追加")
    
    # 修正された内容を保存
    updated_content = '\n'.join(lines)
    
    with open(main_file, 'w', encoding='utf-8') as f:
        f.write(updated_content)
    
    print("✅ app/main.py 修正完了")
    return True

def verify_spots_file():
    """スポットファイルの存在確認"""
    print("\n🔍 スポット関連ファイル確認...")
    
    files_to_check = [
        "app/api/v1/spots.py",
        "app/schemas/spots.py",
        "app/api/v1/__init__.py"
    ]
    
    for file_path in files_to_check:
        if os.path.exists(file_path):
            print(f"  ✅ {file_path} 存在")
        else:
            print(f"  ❌ {file_path} が見つかりません")
    
    # __init__.py が空でないか確認
    init_file = "app/api/v1/__init__.py"
    if os.path.exists(init_file):
        with open(init_file, 'r') as f:
            content = f.read().strip()
        if not content:
            print("  ⚠️  app/api/v1/__init__.py が空です")
            # __init__.py を修正
            with open(init_file, 'w') as f:
                f.write('"""API v1 package"""\n')
            print("  ✅ __init__.py を修正しました")

def show_corrected_content():
    """修正後の内容を表示"""
    print("\n📄 修正後のapp/main.py インポート部分:")
    
    with open("app/main.py", 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    for i, line in enumerate(lines[:25]):
        if 'import' in line or 'from' in line or 'include_router' in line:
            print(f"  {i+1}: {line}")

def main():
    """メイン修正実行"""
    print("🔧 TravelCanvas スポットインポートエラー修正")
    print("=" * 60)
    
    # 1. 現在の内容確認
    check_main_py_content()
    
    # 2. スポット関連ファイル確認
    verify_spots_file()
    
    # 3. インポート修正
    if fix_spots_import():
        print("\n✅ 修正完了！")
        
        # 4. 修正後の内容表示
        show_corrected_content()
        
        print("\n🚀 次の手順:")
        print("  1. サーバー再起動: tc-backend")
        print("  2. ブラウザでSwagger UI確認: http://192.168.1.248:8000/docs")
        
        return True
    else:
        print("\n❌ 修正に失敗しました")
        return False

if __name__ == "__main__":
    main()
