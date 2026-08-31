#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
ルーティング設定調査スクリプト
React Routerの設定を検索・解析します
"""

import os
import re
from pathlib import Path
from typing import List, Dict, Any
from collections import defaultdict

class RoutingInvestigator:
    def __init__(self, project_root: str = "./"):
        self.project_root = Path(project_root)
        self.routing_files = []
        self.routes = []
        
    def find_routing_files(self, directory: Path = None, depth: int = 0) -> None:
        """ルーティング関連ファイルを検索"""
        if depth > 5:  # 深すぎる場合は停止
            return
            
        if directory is None:
            directory = self.project_root
            
        try:
            for item in directory.iterdir():
                if item.is_dir():
                    # 除外ディレクトリ
                    if item.name not in ['node_modules', '.git', 'build', 'dist', '.next', '__pycache__']:
                        self.find_routing_files(item, depth + 1)
                elif item.is_file():
                    if self.is_routing_file(item):
                        self.routing_files.append(item)
        except PermissionError:
            print(f"Permission denied: {directory}")
        except Exception as e:
            print(f"Directory read error: {directory} - {e}")
    
    def is_routing_file(self, file_path: Path) -> bool:
        """ルーティングファイルかどうか判定"""
        file_name = file_path.name.lower()
        file_ext = file_path.suffix
        
        # 拡張子チェック
        if file_ext not in ['.tsx', '.ts', '.jsx', '.js']:
            return False
        
        # ファイル名パターンチェック
        routing_patterns = [
            r'^app\.',
            r'^router',
            r'^routes',
            r'^index\.',
            r'^main\.',
            r'routing',
            r'navigation'
        ]
        
        return any(re.search(pattern, file_name) for pattern in routing_patterns)
    
    def extract_routes(self, file_path: Path) -> List[Dict[str, Any]]:
        """ファイル内容からルート定義を抽出"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"File read error: {file_path} - {e}")
            return []
        
        routes = []
        
        # Route要素のパターンマッチング
        route_patterns = [
            # <Route path="/path" element={<Component />} />
            r'<Route\s+[^>]*path\s*=\s*["\']([^"\']+)["\'][^>]*element\s*=\s*\{[^}]*<([^/>]+)[^}]*\}[^>]*/?>', 
            # <Route path="/path" component={Component} />
            r'<Route\s+[^>]*path\s*=\s*["\']([^"\']+)["\'][^>]*component\s*=\s*\{([^}]+)\}[^>]*/?>', 
            # { path: "/path", element: <Component /> }
            r'\{\s*path\s*:\s*["\']([^"\']+)["\'][^}]*element\s*:\s*<([^/>]+)[^}]*>',
            # { path: "/path", component: Component }
            r'\{\s*path\s*:\s*["\']([^"\']+)["\'][^}]*component\s*:\s*([^,}]+)'
        ]
        
        for pattern in route_patterns:
            matches = re.finditer(pattern, content, re.IGNORECASE)
            for match in matches:
                routes.append({
                    'path': match.group(1),
                    'component': match.group(2).strip() if len(match.groups()) > 1 else 'Unknown',
                    'file': str(file_path)
                })
        
        # Redirect要素も検索
        redirect_pattern = r'<Redirect\s+[^>]*from\s*=\s*["\']([^"\']+)["\'][^>]*to\s*=\s*["\']([^"\']+)["\'][^>]*/?>'
        redirect_matches = re.finditer(redirect_pattern, content, re.IGNORECASE)
        for match in redirect_matches:
            routes.append({
                'path': match.group(1),
                'redirectTo': match.group(2),
                'type': 'redirect',
                'file': str(file_path)
            })
        
        return routes
    
    def find_navigate_calls(self, file_path: Path) -> List[Dict[str, Any]]:
        """Navigate呼び出しを検索"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"Navigate search error: {file_path} - {e}")
            return []
        
        navigate_calls = []
        
        # navigate('/path') パターン
        navigate_pattern = r'navigate\s*\(\s*[\'"`]([^\'"`]+)[\'"`]\s*\)'
        matches = re.finditer(navigate_pattern, content)
        
        for match in matches:
            line_number = content[:match.start()].count('\n') + 1
            navigate_calls.append({
                'path': match.group(1),
                'file': str(file_path),
                'line': line_number
            })
        
        return navigate_calls
    
    def investigate(self) -> Dict[str, Any]:
        """調査実行"""
        print('🔍 ルーティング設定調査を開始します...\n')
        
        # 1. ルーティングファイルを検索
        print('📁 ルーティング関連ファイルを検索中...')
        self.find_routing_files()
        
        if not self.routing_files:
            print('❌ ルーティングファイルが見つかりませんでした')
            return {}
        
        print(f'✅ {len(self.routing_files)}個のファイルを発見:')
        for file in self.routing_files:
            print(f'   📄 {file}')
        print()
        
        # 2. 各ファイルからルート定義を抽出
        print('🔎 ルート定義を解析中...')
        all_routes = []
        all_navigate_calls = []
        
        for file in self.routing_files:
            routes = self.extract_routes(file)
            navigate_calls = self.find_navigate_calls(file)
            
            all_routes.extend(routes)
            all_navigate_calls.extend(navigate_calls)
            
            if routes:
                print(f'\n📄 {file}:')
                for route in routes:
                    if route.get('type') == 'redirect':
                        print(f'   🔀 {route["path"]} → {route["redirectTo"]}')
                    else:
                        print(f'   🛣️  {route["path"]} → {route.get("component", "Unknown")}')
        
        # 3. ダッシュボードから呼び出されるパスをチェック
        print('\n🎯 ダッシュボードからの遷移先チェック:')
        dashboard_paths = ['/spots/search', '/spots/register', '/spots', '/profile']
        
        for path in dashboard_paths:
            route = next((r for r in all_routes if r['path'] == path), None)
            if route:
                file_name = Path(route['file']).name
                print(f'   ✅ {path} → {route.get("component", "Unknown")} ({file_name})')
            else:
                print(f'   ❌ {path} → ルート定義が見つかりません')
        
        # 4. Navigate呼び出し一覧
        if all_navigate_calls:
            print('\n📍 Navigate呼び出し一覧:')
            for call in all_navigate_calls:
                file_name = Path(call['file']).name
                print(f'   🧭 {call["path"]} ({file_name}:{call["line"]})')
        
        # 5. 問題の可能性を指摘
        print('\n⚠️  潜在的な問題:')
        missing_routes = [
            path for path in dashboard_paths 
            if not any(r['path'] == path for r in all_routes)
        ]
        
        if missing_routes:
            print(f'   🚨 以下のルートが未定義: {", ".join(missing_routes)}')
        
        # 重複ルートチェック
        path_counts = defaultdict(int)
        for route in all_routes:
            path_counts[route['path']] += 1
        
        duplicates = [(path, count) for path, count in path_counts.items() if count > 1]
        if duplicates:
            print('   🔄 重複ルート:')
            for path, count in duplicates:
                print(f'      {path} ({count}回定義)')
        
        if not missing_routes and not duplicates:
            print('   ✅ 明らかな問題は見つかりませんでした')
        
        return {
            'routing_files': [str(f) for f in self.routing_files],
            'routes': all_routes,
            'navigate_calls': all_navigate_calls,
            'missing_routes': missing_routes,
            'duplicates': duplicates
        }

def main():
    """メイン関数"""
    investigator = RoutingInvestigator()
    
    try:
        result = investigator.investigate()
        
        print('\n📋 調査完了！')
        print('次のステップ:')
        print('1. 不足しているルート定義を追加')
        print('2. 重複ルートがある場合は整理')
        print('3. コンポーネントファイルが存在するか確認')
        print('4. 認証チェックが適切に動作しているか確認')
        
        return result
        
    except Exception as e:
        print(f'調査中にエラーが発生しました: {e}')
        return None

if __name__ == '__main__':
    main()