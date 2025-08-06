#!/usr/bin/env python3
"""
TravelCanvas プロジェクト構造確認・修正スクリプト
"""
import os
import json
from pathlib import Path

def find_main_files():
    """メインファイルを検索"""
    print("🔍 メインファイル検索中...")
    
    possible_main_files = [
        "main.py",
        "app.py", 
        "server.py",
        "run.py",
        "app/main.py",
        "src/main.py"
    ]
    
    found_files = []
    for file_path in possible_main_files:
        if os.path.exists(file_path):
            found_files.append(file_path)
            print(f"  ✅ 発見: {file_path}")
    
    if not found_files:
        print("  ❌ メインファイルが見つかりません")
    
    return found_files

def analyze_project_structure():
    """プロジェクト構造詳細分析"""
    print("\n📂 プロジェクト構造分析:")
    
    structure = {
        "root_files": [],
        "directories": {},
        "python_files": [],
        "config_files": []
    }
    
    # ルートファイル確認
    for item in os.listdir('.'):
        if os.path.isfile(item):
            structure["root_files"].append(item)
            if item.endswith('.py'):
                structure["python_files"].append(item)
            elif item in ['requirements.txt', 'pyproject.toml', 'Dockerfile', '.env']:
                structure["config_files"].append(item)
        elif os.path.isdir(item) and not item.startswith('.'):
            structure["directories"][item] = []
            try:
                for subitem in os.listdir(item):
                    structure["directories"][item].append(subitem)
            except PermissionError:
                structure["directories"][item] = ["<アクセス権限なし>"]
    
    return structure

def check_fastapi_setup():
    """FastAPIセットアップ確認"""
    print("\n⚡ FastAPI構成確認:")
    
    # app ディレクトリ確認
    if os.path.exists('app'):
        print("  ✅ app/ ディレクトリ存在")
        
        # __init__.py確認
        if os.path.exists('app/__init__.py'):
            print("  ✅ app/__init__.py 存在")
        
        # main.py確認
        if os.path.exists('app/main.py'):
            print("  ✅ app/main.py 発見")
            return 'app/main.py'
        
        # アプリケーションファクトリー確認
        if os.path.exists('app/app.py'):
            print("  ✅ app/app.py 発見")
            return 'app/app.py'
            
        # core/app.py確認
        if os.path.exists('app/core/app.py'):
            print("  ✅ app/core/app.py 発見")
            return 'app/core/app.py'
    
    return None

def find_fastapi_app():
    """FastAPIアプリインスタンスを探す"""
    print("\n🔎 FastAPIアプリインスタンス検索:")
    
    search_files = []
    
    # 検索対象ファイル収集
    for root, dirs, files in os.walk('.'):
        for file in files:
            if file.endswith('.py') and not file.startswith('test_'):
                search_files.append(os.path.join(root, file))
    
    fastapi_files = []
    
    for file_path in search_files:
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
                if 'FastAPI' in content and ('app = FastAPI' in content or 'application = FastAPI' in content):
                    fastapi_files.append(file_path)
                    print(f"  ✅ FastAPIアプリ発見: {file_path}")
        except (UnicodeDecodeError, PermissionError):
            continue
    
    return fastapi_files

def create_missing_main():
    """メインファイルが存在しない場合の作成"""
    print("\n🛠️  メインファイル作成オプション:")
    
    # app/main.py パターン
    if os.path.exists('app') and not os.path.exists('app/main.py'):
        print("  💡 app/main.py を作成することを推奨")
        return 'app/main.py'
    
    # ルート main.py パターン  
    if not os.path.exists('main.py'):
        print("  💡 main.py を作成することを推奨")
        return 'main.py'
    
    return None

def suggest_setup_fix():
    """セットアップ修正提案"""
    print("\n🔧 セットアップ修正提案:")
    
    main_files = find_main_files()
    fastapi_files = find_fastapi_app()
    
    if main_files:
        print(f"  ✅ 既存メインファイル使用: {main_files[0]}")
        return main_files[0]
    
    elif fastapi_files:
        print(f"  ✅ FastAPIファイルをメインとして使用: {fastapi_files[0]}")
        return fastapi_files[0]
    
    else:
        suggested_path = create_missing_main()
        if suggested_path:
            print(f"  💡 新規作成推奨: {suggested_path}")
            return suggested_path
    
    return None

def generate_setup_fix_script(main_file_path):
    """修正用スクリプト生成"""
    print(f"\n📝 修正スクリプト生成中...")
    
    fix_script = f'''#!/usr/bin/env python3
"""
MVPスポットセットアップ修正版
メインファイルパス: {main_file_path}
"""
import shutil
import os

def fix_mvp_setup():
    """mvp_spot_setup.py を修正"""
    print("🔧 mvp_spot_setup.py 修正中...")
    
    # バックアップ作成
    if os.path.exists('mvp_spot_setup.py'):
        shutil.copy2('mvp_spot_setup.py', 'mvp_spot_setup.py.backup')
        print("  ✅ mvp_spot_setup.py をバックアップ")
    
    # ファイル読み込み
    with open('mvp_spot_setup.py', 'r', encoding='utf-8') as f:
        content = f.read()
    
    # main.py パスを修正
    content = content.replace(
        'main_file = "main.py"',
        'main_file = "{main_file_path}"'
    )
    
    # 修正版保存
    with open('mvp_spot_setup_fixed.py', 'w', encoding='utf-8') as f:
        f.write(content)
    
    print("  ✅ mvp_spot_setup_fixed.py を作成")
    print(f"  📁 メインファイルパス: {main_file_path}")
    
    return True

if __name__ == "__main__":
    fix_mvp_setup()
    print("\\n🚀 修正完了！次のコマンドを実行:")
    print("  python3 mvp_spot_setup_fixed.py")
'''
    
    with open('fix_mvp_setup.py', 'w', encoding='utf-8') as f:
        f.write(fix_script)
    
    print("  ✅ fix_mvp_setup.py を作成")

def main():
    """メイン実行"""
    print("🔍 TravelCanvas プロジェクト構造確認")
    print("=" * 60)
    
    # 1. 構造分析
    structure = analyze_project_structure()
    
    print(f"\n📊 分析結果:")
    print(f"  ルートファイル数: {len(structure['root_files'])}")
    print(f"  ディレクトリ数: {len(structure['directories'])}")
    print(f"  Pythonファイル数: {len(structure['python_files'])}")
    
    # 主要ディレクトリ表示
    important_dirs = ['app', 'api', 'src', 'backend', 'server']
    for dir_name in important_dirs:
        if dir_name in structure['directories']:
            print(f"  📂 {dir_name}/: {len(structure['directories'][dir_name])} items")
    
    # 2. FastAPIセットアップ確認
    fastapi_main = check_fastapi_setup()
    
    # 3. 修正提案
    suggested_main = suggest_setup_fix()
    
    # 4. 修正スクリプト生成
    if suggested_main:
        generate_setup_fix_script(suggested_main)
        
        print(f"\n🎯 推奨解決策:")
        print(f"  1. python3 fix_mvp_setup.py")
        print(f"  2. python3 mvp_spot_setup_fixed.py")
        print(f"  メインファイル: {suggested_main}")
    else:
        print(f"\n❌ 自動修正できません")
        print(f"  手動でプロジェクト構造を確認してください")
    
    # 5. 詳細構造をJSONで保存
    with open('project_structure_analysis.json', 'w', encoding='utf-8') as f:
        json.dump(structure, f, ensure_ascii=False, indent=2)
    
    print(f"\n📄 詳細分析結果: project_structure_analysis.json")

if __name__ == "__main__":
    main()
