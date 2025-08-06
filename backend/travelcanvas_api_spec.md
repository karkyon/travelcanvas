# TravelCanvas Backend API仕様書（完全版）

## 概要

TravelCanvas は AI 搭載旅行プラン最適化システムのバックエンド API です。ハイブリッド認証（ゲスト + 会員）、AI 最適化、画像認識検索、リアルタイム共同編集などの高度な機能を提供します。

### 基本情報
- **API バージョン**: v1
- **ベース URL**: `https://api.travelcanvas.app/api/v1`
- **認証方式**: JWT Bearer Token + ゲストトークン
- **データ形式**: JSON
- **レート制限**: あり（ユーザータイプ別）

## 認証システム

### 認証方式
TravelCanvas では2つの認証方式をサポートしています：

1. **ゲスト認証**: セッショントークンベース
2. **会員認証**: JWT トークンベース

### ヘッダー設定

```http
# JWT認証（会員）
Authorization: Bearer <jwt_token>

# ゲスト認証
X-Guest-Token: <guest_token>

# 共通ヘッダー
Content-Type: application/json
X-Client-Version: 1.0.0
X-Request-ID: req_abc123def456
```

## エンドポイント一覧

### 1. 認証・ユーザー管理 (`/auth`)

#### ゲストセッション作成
```http
POST /auth/guest
```

**リクエスト**:
```json
{
  "device_info": {
    "platform": "web",
    "browser": "Chrome",
    "version": "120.0.0",
    "user_agent": "Mozilla/5.0...",
    "screen_resolution": "1920x1080"
  },
  "timezone": "Asia/Tokyo",
  "language": "ja"
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "ゲストセッションを作成しました",
  "data": {
    "token": {
      "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
      "token_type": "bearer",
      "expires_in": 86400,
      "user": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "username": "guest_abc123",
        "user_type": "guest",
        "is_active": true,
        "created_at": "2025-08-01T00:00:00Z"
      }
    }
  },
  "timestamp": 1704067200.0
}
```

#### ユーザー登録
```http
POST /auth/register
```

**リクエスト**:
```json
{
  "email": "user@example.com",
  "username": "traveluser",
  "full_name": "田中太郎",
  "password": "SecurePass123!",
  "confirm_password": "SecurePass123!",
  "terms_accepted": true,
  "marketing_consent": false
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "アカウントを作成しました",
  "data": {
    "token": {
      "access_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
      "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
      "expires_in": 3600,
      "user": {
        "id": "123e4567-e89b-12d3-a456-426614174000",
        "username": "traveluser",
        "email": "user@example.com",
        "full_name": "田中太郎",
        "user_type": "registered",
        "is_active": true,
        "is_verified": false,
        "created_at": "2025-08-01T00:00:00Z"
      }
    }
  }
}
```

#### ログイン
```http
POST /auth/login
```

**リクエスト**:
```json
{
  "email": "user@example.com",
  "username": "traveluser", // email または username のどちらか
  "password": "SecurePass123!",
  "remember_me": true
}
```

#### ログアウト
```http
POST /auth/logout
```

#### トークンリフレッシュ
```http
POST /auth/refresh
```

**リクエスト**:
```json
{
  "refresh_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9..."
}
```

#### 現在のユーザー情報取得
```http
GET /auth/me
```

#### ユーザー情報更新
```http
PUT /auth/me
```

**リクエスト**:
```json
{
  "full_name": "田中次郎",
  "email": "newemail@example.com",
  "username": "newusername",
  "bio": "旅行好きのエンジニア",
  "avatar_url": "https://example.com/avatar.jpg"
}
```

#### パスワード変更
```http
POST /auth/change-password
```

**リクエスト**:
```json
{
  "current_password": "OldPass123!",
  "new_password": "NewPass123!",
  "confirm_password": "NewPass123!"
}
```

#### パスワードリセット要求
```http
POST /auth/forgot-password
```

**リクエスト**:
```json
{
  "email": "user@example.com"
}
```

#### メールアドレス確認
```http
GET /auth/verify-email/{token}
```

#### ゲストユーザーのアップグレード
```http
POST /auth/upgrade-guest
```

**リクエスト**:
```json
{
  "email": "user@example.com",
  "username": "newuser",
  "full_name": "田中太郎",
  "password": "SecurePass123!",
  "confirm_password": "SecurePass123!"
}
```

#### アカウント削除
```http
DELETE /auth/delete-account
```

**リクエスト**:
```json
{
  "password": "SecurePass123!" // 会員の場合のみ必要
}
```

### 2. 旅行プラン管理 (`/travel`)

#### プラン一覧取得
```http
GET /travel/plans?page=1&page_size=20&status=active&search=東京
```

**クエリパラメータ**:
- `page`: ページ番号（デフォルト: 1）
- `page_size`: ページサイズ（デフォルト: 20、最大: 100）
- `status`: プラン状態フィルター（draft, active, completed, archived）
- `search`: 検索キーワード
- `sort_by`: ソート項目（created_at, updated_at, title）
- `sort_order`: ソート順（asc, desc）

#### プラン作成
```http
POST /travel/plans
```

**リクエスト**:
```json
{
  "title": "東京観光2泊3日",
  "description": "初めての東京観光プラン",
  "destination": "東京",
  "start_date": "2025-08-01",
  "end_date": "2025-08-03",
  "budget": 50000,
  "group_size": 2,
  "transport_modes": ["train", "walking"],
  "constraints": {
    "accessibility_required": false,
    "child_friendly": true,
    "budget_conscious": false
  },
  "visibility": "private",
  "center_coordinates": {
    "latitude": 35.6762,
    "longitude": 139.6503
  },
  "tags": ["観光", "グルメ", "文化"]
}
```

#### プラン詳細取得
```http
GET /travel/plans/{plan_id}
```

#### プラン更新
```http
PUT /travel/plans/{plan_id}
```

#### プラン削除
```http
DELETE /travel/plans/{plan_id}
```

#### スケジュールアイテム追加
```http
POST /travel/plans/{plan_id}/days/{day_id}/items
```

**リクエスト**:
```json
{
  "spot_id": "spot-uuid-123",
  "title": "東京タワー見学",
  "description": "展望台からの景色を楽しむ",
  "category": "sightseeing",
  "start_time": "09:00",
  "end_time": "11:00",
  "duration": 120,
  "location_name": "東京タワー",
  "latitude": 35.6585,
  "longitude": 139.7454,
  "address": "東京都港区芝公園4-2-8",
  "cost": 1200,
  "currency": "JPY",
  "priority": "high",
  "travel_method": "train",
  "travel_time": 30,
  "travel_cost": 200,
  "notes": "晴れた日がおすすめ",
  "booking_info": {
    "url": "https://example.com/booking",
    "phone": "03-1234-5678"
  },
  "contact_info": {
    "website": "https://tokyotower.co.jp",
    "phone": "03-3433-5111"
  }
}
```

#### スケジュールアイテム更新
```http
PUT /travel/schedule-items/{item_id}
```

#### スケジュールアイテム削除
```http
DELETE /travel/schedule-items/{item_id}
```

#### スケジュールアイテム並び替え
```http
POST /travel/plans/{plan_id}/reorder
```

**リクエスト**:
```json
{
  "day_id": "day-uuid",
  "item_orders": [
    "item-uuid-1",
    "item-uuid-2",
    "item-uuid-3"
  ]
}
```

#### プラン最適化
```http
POST /travel/plans/{plan_id}/optimize
```

**リクエスト**:
```json
{
  "optimization_type": "time_efficient", // time_efficient, cost_effective, balanced
  "constraints": {
    "max_travel_time_minutes": 60,
    "budget_limit": 10000,
    "avoid_crowds": true,
    "accessibility_required": false
  },
  "preferences": {
    "prefer_public_transport": true,
    "include_meal_breaks": true,
    "walking_tolerance": "medium", // low, medium, high
    "activity_pace": "relaxed" // rushed, normal, relaxed
  }
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "最適化を開始しました",
  "data": {
    "job_id": "opt_abc123def456",
    "status": "started",
    "estimated_completion": 60,
    "quick_result": {
      "time_saved_minutes": 45,
      "cost_saved": 1200,
      "route_efficiency_improved": 25.5
    }
  }
}
```

#### 最適化結果取得
```http
GET /travel/optimization/{job_id}
```

**レスポンス**:
```json
{
  "success": true,
  "data": {
    "job_id": "opt_abc123def456",
    "status": "completed", // processing, completed, failed
    "progress": 100,
    "result": {
      "original_plan": {
        "total_travel_time_minutes": 180,
        "total_cost": 8500,
        "total_distance_km": 25.0
      },
      "optimized_plan": {
        "total_travel_time_minutes": 135,
        "total_cost": 7300,
        "total_distance_km": 18.5
      },
      "improvements": {
        "time_saved_minutes": 45,
        "cost_saved": 1200,
        "distance_saved_km": 6.5,
        "efficiency_score": 87.5
      },
      "changes": [
        {
          "type": "reorder",
          "description": "浅草寺と東京タワーの順序を変更",
          "impact": "移動時間15分短縮"
        }
      ]
    }
  }
}
```

#### 現在の旅行状況取得
```http
GET /travel/plans/{plan_id}/current-status
```

**レスポンス**:
```json
{
  "success": true,
  "data": {
    "current_time": "14:30",
    "current_date": "2025-08-01",
    "current_timezone": "Asia/Tokyo",
    "next_event": {
      "id": "event-uuid",
      "title": "浅草寺参拝",
      "start_time": "15:00",
      "location_name": "浅草寺",
      "time_until_minutes": 30
    },
    "current_event": null,
    "day_progress": 37.5,
    "completed_events": 2,
    "total_events": 8,
    "remaining_events": 6,
    "today_summary": {
      "day_number": 1,
      "title": "東京観光 1日目",
      "total_cost": 8000,
      "total_duration": 480
    }
  }
}
```

#### スポット検索
```http
POST /travel/search/spots
```

**リクエスト**:
```json
{
  "query": "東京 観光スポット",
  "location": {
    "latitude": 35.6762,
    "longitude": 139.6503
  },
  "category": "sightseeing",
  "radius_km": 10.0,
  "max_results": 20,
  "price_level": "medium", // low, medium, high
  "min_rating": 4.0
}
```

#### 画像による検索
```http
POST /travel/search/image
```

**リクエスト** (multipart/form-data):
```json
{
  "file": "<image_file>",
  "location_hint": "東京"
}
```

### 3. AI機能 (`/ai`)

#### テキスト検索
```http
POST /ai/search/text
```

**リクエスト**:
```json
{
  "query": "東京 観光スポット おすすめ",
  "location": {
    "latitude": 35.6762,
    "longitude": 139.6503
  },
  "radius": 10.0,
  "filters": {
    "categories": ["sightseeing", "culture"],
    "price_range": "medium",
    "rating_min": 4.0,
    "open_now": true
  },
  "max_results": 20,
  "include_ai_suggestions": true
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "テキスト検索が完了しました",
  "data": {
    "spots": [
      {
        "id": "spot-uuid",
        "name": "東京タワー",
        "description": "東京のシンボルタワー",
        "category": "sightseeing",
        "location": {
          "latitude": 35.6585,
          "longitude": 139.7454,
          "address": "東京都港区芝公園4-2-8"
        },
        "rating": 4.2,
        "price_level": "medium",
        "estimated_duration": 120,
        "estimated_cost": 1200,
        "ai_confidence": 0.95,
        "relevance_score": 0.88
      }
    ],
    "processing_time": 1.23,
    "query_analysis": {
      "detected_intent": "find_attractions",
      "extracted_location": "東京",
      "detected_preferences": ["sightseeing", "popular"]
    },
    "search_metadata": {
      "total_results": 15,
      "ai_enhanced": true,
      "location_based": true
    }
  }
}
```

#### 画像認識検索
```http
POST /ai/search/image
```

**リクエスト** (multipart/form-data):
```json
{
  "image": "<image_file>",
  "location": "{\"latitude\": 35.6762, \"longitude\": 139.6503}",
  "max_results": 10
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "画像検索が完了しました",
  "data": {
    "recognized_objects": [
      {
        "name": "東京タワー",
        "confidence": 0.95,
        "bounding_box": {
          "x": 120,
          "y": 80,
          "width": 200,
          "height": 300
        }
      }
    ],
    "suggested_spots": [
      {
        "id": "spot-uuid",
        "name": "東京タワー",
        "similarity": 0.92,
        "location": {
          "latitude": 35.6585,
          "longitude": 139.7454
        }
      }
    ],
    "processing_time": 2.45,
    "image_metadata": {
      "filename": "image.jpg",
      "size": 1024000,
      "content_type": "image/jpeg"
    }
  }
}
```

#### 音声検索
```http
POST /ai/search/voice
```

**リクエスト** (multipart/form-data):
```json
{
  "voice_data": "<audio_file>",
  "request_data": "{\"language\": \"ja\", \"location\": {\"latitude\": 35.6762, \"longitude\": 139.6503}, \"max_results\": 10}"
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "音声検索が完了しました",
  "data": {
    "transcribed_text": "東京でおすすめの観光スポットを教えて",
    "audio_duration": 3.2,
    "confidence": 0.94,
    "spots": [
      {
        "id": "spot-uuid",
        "name": "東京タワー",
        "relevance_score": 0.91
      }
    ],
    "processing_time": 1.85,
    "audio_metadata": {
      "filename": "voice.wav",
      "size": 256000,
      "content_type": "audio/wav",
      "language": "ja"
    }
  }
}
```

#### AI推薦システム
```http
POST /ai/recommendations
```

**リクエスト**:
```json
{
  "user_preferences": {
    "favorite_categories": ["culture", "food"],
    "budget_range": "medium",
    "activity_level": "moderate"
  },
  "location": {
    "latitude": 35.6762,
    "longitude": 139.6503
  },
  "travel_style": "cultural",
  "budget_range": "medium",
  "duration": 3,
  "interests": ["history", "food", "art"]
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "AI推薦が完了しました",
  "data": {
    "spots": [
      {
        "id": "spot-uuid",
        "name": "浅草寺",
        "recommendation_score": 0.94,
        "reason": "歴史と文化に興味があるユーザーに最適"
      }
    ],
    "processing_time": 0.85,
    "recommendation_metadata": {
      "algorithm": "hybrid_collaborative_content",
      "personalization_score": 0.87,
      "confidence": 0.91
    }
  }
}
```

#### スマート行程生成
```http
POST /ai/itinerary/generate
```

**リクエスト**:
```json
{
  "destination": "東京",
  "start_date": "2025-08-01",
  "end_date": "2025-08-03",
  "preferences": {
    "budget": 50000,
    "travel_style": "balanced",
    "interests": ["sightseeing", "food"],
    "pace": "relaxed"
  },
  "must_visit": ["東京タワー", "浅草寺"],
  "avoid_places": ["繁華街"]
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "スマート行程生成を開始しました",
  "data": {
    "task_id": "itinerary_abc123def456",
    "status": "generating",
    "estimated_completion": 120,
    "destination": "東京"
  }
}
```

#### AI機能使用状況
```http
GET /ai/usage
```

**レスポンス**:
```json
{
  "success": true,
  "message": "AI使用状況を取得しました",
  "data": {
    "current_period": "2025-08",
    "limits": {
      "text_search": 100,
      "image_search": 30,
      "voice_search": 20,
      "optimization": 10
    },
    "usage": {
      "text_search": 45,
      "image_search": 12,
      "voice_search": 3,
      "optimization": 2
    },
    "remaining": {
      "text_search": 55,
      "image_search": 18,
      "voice_search": 17,
      "optimization": 8
    },
    "reset_date": "2025-09-01T00:00:00Z"
  }
}
```

#### AIヘルスチェック
```http
GET /ai/health
```

**レスポンス**:
```json
{
  "success": true,
  "message": "AI サービスは正常です",
  "data": {
    "overall_status": "healthy",
    "services": {
      "ai_search": {
        "healthy": true,
        "response_time_ms": 145,
        "error_rate": 0.01
      },
      "image_recognition": {
        "healthy": true,
        "response_time_ms": 890,
        "error_rate": 0.02
      },
      "optimization": {
        "healthy": true,
        "response_time_ms": 2340,
        "error_rate": 0.005
      }
    },
    "timestamp": 1704067200.0
  }
}
```

### 4. 管理機能 (`/admin`) - 管理者権限必須

#### システム統計
```http
GET /admin/stats/system
```

**レスポンス**:
```json
{
  "success": true,
  "message": "システム統計を取得しました",
  "data": {
    "users": {
      "total_users": 1500,
      "active_users": 890,
      "verified_users": 1234,
      "new_users_30d": 156,
      "user_types": {
        "guest": 45,
        "registered": 1200,
        "premium": 245,
        "admin": 10
      }
    },
    "travel_plans": {
      "total_plans": 3200,
      "active_plans": 1850,
      "completed_plans": 980,
      "draft_plans": 370,
      "average_duration_days": 3.2,
      "popular_destinations": [
        {
          "destination": "東京",
          "count": 456
        }
      ]
    },
    "rate_limits": {
      "requests_per_minute": 2847,
      "rate_limit_hits_24h": 156,
      "top_limited_endpoints": [
        {
          "endpoint": "/ai/search/text",
          "hits": 89
        }
      ]
    },
    "performance": {
      "avg_response_time_ms": 145.2,
      "requests_per_minute": 2847,
      "error_rate_percent": 0.02,
      "uptime_percent": 99.95
    },
    "security": {
      "failed_login_attempts_24h": 23,
      "suspicious_activities_24h": 2,
      "blocked_ips_count": 45
    },
    "timestamp": "2025-08-01T12:00:00Z"
  }
}
```

#### ユーザー分析
```http
GET /admin/stats/users?days=30&group_by=day
```

**クエリパラメータ**:
- `days`: 分析期間（日数）
- `group_by`: グループ化単位（day, week, month）

**レスポンス**:
```json
{
  "success": true,
  "message": "ユーザー分析データを取得しました",
  "data": {
    "period": {
      "start": "2025-07-01T00:00:00Z",
      "end": "2025-08-01T00:00:00Z",
      "days": 30
    },
    "registration_trend": [
      {
        "period": "2025-07-01",
        "count": 12
      }
    ],
    "activity_trend": [
      {
        "period": "2025-07-01",
        "active_users": 89,
        "plan_creations": 23,
        "plan_optimizations": 15
      }
    ],
    "user_type_distribution": {
      "distribution": {
        "guest": 45,
        "registered": 1200,
        "premium": 245,
        "admin": 10
      },
      "total_users": 1500
    },
    "geographic_distribution": [
      {
        "country": "Japan",
        "count": 1250,
        "percent": 83.3
      }
    ],
    "feature_usage": {
      "plan_creations": 234,
      "ai_optimizations": 156,
      "image_searches": 89,
      "voice_searches": 23
    }
  }
}
```

#### ユーザー一覧
```http
GET /admin/users?page=1&page_size=50&search=tokyo&user_type=registered&status=active
```

**クエリパラメータ**:
- `page`: ページ番号
- `page_size`: ページサイズ
- `search`: 検索キーワード
- `user_type`: ユーザータイプフィルター
- `status`: アカウント状態フィルター
- `sort_by`: ソート項目
- `sort_order`: ソート順

**レスポンス**:
```json
{
  "success": true,
  "message": "ユーザー一覧を取得しました",
  "data": [
    {
      "id": "user-uuid",
      "username": "traveluser",
      "email": "user@example.com",
      "full_name": "田中太郎",
      "user_type": "registered",
      "is_active": true,
      "is_verified": true,
      "last_activity": "2025-08-01T10:30:00Z",
      "created_at": "2025-01-15T09:00:00Z",
      "travel_plans_count": 5,
      "total_logins": 45
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 50,
    "total_count": 1500,
    "total_pages": 30,
    "has_next": true,
    "has_prev": false
  }
}
```

#### ユーザー詳細
```http
GET /admin/users/{user_id}
```

**レスポンス**:
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user-uuid",
      "username": "traveluser",
      "email": "user@example.com",
      "user_type": "registered",
      "is_active": true,
      "is_verified": true,
      "created_at": "2025-01-15T09:00:00Z"
    },
    "statistics": {
      "account_age_days": 198,
      "total_plans": 5,
      "active_plans": 2,
      "completed_plans": 3,
      "optimization_usage": 12,
      "latest_plan_date": "2025-07-25T14:20:00Z"
    },
    "recent_activities": [
      {
        "type": "plan_update",
        "description": "プラン '東京観光' を更新",
        "timestamp": "2025-08-01T10:30:00Z"
      }
    ],
    "security_logs": [
      {
        "event_type": "login_success",
        "timestamp": "2025-08-01T09:00:00Z",
        "client_ip": "192.168.1.100",
        "user_agent": "Mozilla/5.0...",
        "severity": "info"
      }
    ]
  }
}
```

#### ユーザー管理アクション
```http
POST /admin/users/manage
```

**リクエスト**:
```json
{
  "action": "suspend", // suspend, unsuspend, verify, unverify, upgrade, downgrade
  "user_ids": ["user-uuid-1", "user-uuid-2"],
  "reason": "利用規約違反",
  "notify_users": true
}
```

#### セキュリティログ
```http
GET /admin/security/logs?page=1&event_type=login_failed&hours=24
```

**クエリパラメータ**:
- `page`: ページ番号
- `page_size`: ページサイズ
- `event_type`: イベントタイプフィルター
- `user_id`: ユーザーIDフィルター
- `client_ip`: クライアントIPフィルター
- `severity`: 重要度フィルター
- `hours`: 時間範囲

**レスポンス**:
```json
{
  "success": true,
  "message": "セキュリティログを取得しました",
  "data": [
    {
      "id": "log-uuid",
      "event_type": "login_failed",
      "user_id": "user-uuid",
      "client_ip": "192.168.1.100",
      "timestamp": "2025-08-01T10:30:00Z",
      "severity": "warning",
      "message": "ログイン試行に失敗",
      "details": {
        "user_identifier": "user@example.com",
        "failure_reason": "invalid_password"
      }
    }
  ]
}
```

#### セキュリティアラート
```http
GET /admin/security/alerts?hours=24&severity=high
```

#### システム設定取得
```http
GET /admin/settings
```

**レスポンス**:
```json
{
  "success": true,
  "data": {
    "rate_limits": {
      "api_general": 1000,
      "api_guest": 100,
      "ai_optimization": 50
    },
    "security": {
      "max_login_attempts": 5,
      "session_timeout_minutes": 30,
      "password_min_length": 8
    },
    "features": {
      "ai_optimization_enabled": true,
      "image_recognition_enabled": true,
      "voice_search_enabled": true
    },
    "maintenance": {
      "mode": false,
      "message": "",
      "scheduled_time": null
    }
  }
}
```

#### システム設定更新
```http
POST /admin/settings/update
```

**リクエスト**:
```json
{
  "updates": [
    {
      "config_key": "rate_limits.api_general",
      "config_value": 2000,
      "description": "API制限を緩和"
    }
  ]
}
```

#### データエクスポート
```http
POST /admin/export
```

**リクエスト**:
```json
{
  "export_type": "user_activity", // user_activity, travel_plans, security_logs
  "date_range": {
    "start": "2025-07-01",
    "end": "2025-07-31"
  },
  "filters": {
    "user_type": "registered"
  },
  "format": "csv" // csv, json, xlsx
}
```

**レスポンス**:
```json
{
  "success": true,
  "message": "データエクスポートを開始しました",
  "data": {
    "task_id": "export_abc123def456",
    "status": "processing",
    "estimated_completion": 300
  }
}
```

#### エクスポート状況確認
```http
GET /admin/export/{task_id}/status
```

#### エクスポートファイルダウンロード
```http
GET /admin/export/{task_id}/download
```

#### メンテナンスモード設定
```http
POST /admin/maintenance
```

**リクエスト**:
```json
{
  "enabled": true,
  "message": "システムメンテナンス中です",
  "duration_minutes": 60
}
```

### 5. 共有機能 (`/travel/plans/{plan_id}/share`)

#### 共有リンク作成
```http
POST /travel/plans/{plan_id}/share
```

**リクエスト**:
```json
{
  "permission": "view_only", // view_only, comment, edit
  "expires_at": "2025-12-31T23:59:59Z",
  "share_password": "optional_password",
  "invite_emails": ["friend@example.com"],
  "allow_public": false
}
```

**レスポンス**:
```json
{
  "success": true,
  "data": {
    "share_url": "https://travelcanvas.com/shared/abc123def456",
    "qr_code_url": "https://api.travelcanvas.com/qr/abc123def456.png",
    "share_token": "abc123def456",
    "permission": "view_only",
    "expires_at": "2025-12-31T23:59:59Z",
    "password_protected": true
  }
}
```

#### 共有設定取得
```http
GET /travel/plans/{plan_id}/share
```

#### 共有設定更新
```http
PUT /travel/plans/{plan_id}/share/{share_id}
```

#### 共有リンク削除
```http
DELETE /travel/plans/{plan_id}/share/{share_id}
```

#### コラボレーター招待
```http
POST /travel/plans/{plan_id}/collaborators
```

**リクエスト**:
```json
{
  "email": "collaborator@example.com",
  "permission": "edit",
  "message": "一緒に旅行プランを作りましょう！"
}
```

#### コラボレーター一覧
```http
GET /travel/plans/{plan_id}/collaborators
```

### 6. 通知システム (`/notifications`)

#### 通知一覧取得
```http
GET /notifications?page=1&unread_only=true
```

#### 通知を既読にする
```http
POST /notifications/{notification_id}/read
```

#### 全通知を既読にする
```http
POST /notifications/mark-all-read
```

#### 通知設定取得
```http
GET /notifications/settings
```

#### 通知設定更新
```http
PUT /notifications/settings
```

**リクエスト**:
```json
{
  "email_notifications": true,
  "push_notifications": true,
  "plan_updates": true,
  "collaboration_invites": true,
  "optimization_complete": true,
  "system_maintenance": false
}
```

## レスポンス形式

### 成功レスポンス
```json
{
  "success": true,
  "message": "処理が完了しました",
  "data": { /* 結果データ */ },
  "timestamp": 1704067200.0
}
```

### エラーレスポンス
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "バリデーションエラーが発生しました",
    "details": [
      {
        "field": "email",
        "message": "メールアドレスの形式が正しくありません"
      }
    ]
  },
  "request_id": "req_abc123def456",
  "timestamp": 1704067200.0
}
```

### ページネーションレスポンス
```json
{
  "success": true,
  "data": [ /* データ配列 */ ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_count": 157,
    "total_pages": 8,
    "has_next": true,
    "has_prev": false
  }
}
```

## HTTPステータスコード

| コード | 説明 | 使用場面 |
|--------|------|----------|
| 200 | OK | 正常処理 |
| 201 | Created | リソース作成成功 |
| 204 | No Content | 削除成功など |
| 400 | Bad Request | リクエストエラー |
| 401 | Unauthorized | 認証が必要 |
| 403 | Forbidden | アクセス権限なし |
| 404 | Not Found | リソースが見つからない |
| 409 | Conflict | 重複エラー |
| 429 | Too Many Requests | レート制限超過 |
| 500 | Internal Server Error | サーバーエラー |
| 503 | Service Unavailable | メンテナンス中 |

## エラーコード一覧

### 認証エラー (AUTH_xxx)
- `AUTH_001`: 無効なトークン
- `AUTH_002`: トークンの有効期限切れ
- `AUTH_003`: 認証情報が無効
- `AUTH_004`: ユーザーが見つからない
- `AUTH_005`: アカウントが無効
- `AUTH_006`: アカウントがロック中
- `AUTH_007`: セッションの有効期限切れ
- `AUTH_008`: ゲストユーザー制限

### 認可エラー (AUTHZ_xxx)
- `AUTHZ_001`: 権限が不足
- `AUTHZ_002`: 役割が不十分
- `AUTHZ_003`: リソースアクセス拒否
- `AUTHZ_004`: 管理者権限が必要

### バリデーションエラー (VALID_xxx)
- `VALID_001`: 必須フィールドが不足
- `VALID_002`: フィールドが無効
- `VALID_003`: フォーマットが無効
- `VALID_004`: 長さが無効
- `VALID_005`: 値が範囲外
- `VALID_006`: 重複した値
- `VALID_007`: 制約違反
- `VALID_008`: パスワードが弱い

### ビジネスロジックエラー (BIZ_xxx)
- `BIZ_001`: 旅行プランが見つからない
- `BIZ_002`: 旅行プランへのアクセス拒否
- `BIZ_003`: 最適化に失敗
- `BIZ_004`: 検索結果なし
- `BIZ_005`: 画像認識に失敗
- `BIZ_006`: 音声認識に失敗
- `BIZ_007`: エクスポートに失敗
- `BIZ_008`: インポートに失敗

### 外部サービスエラー (EXT_xxx)
- `EXT_001`: 外部APIが利用不可
- `EXT_002`: 外部APIレート制限
- `EXT_003`: 外部API応答が無効
- `EXT_004`: データベース接続失敗
- `EXT_005`: Redis接続失敗
- `EXT_006`: ファイルストレージエラー
- `EXT_007`: メール送信失敗

### システムエラー (SYS_xxx)
- `SYS_001`: 内部エラー
- `SYS_002`: サービス利用不可
- `SYS_003`: タイムアウト
- `SYS_004`: リソース不足
- `SYS_005`: 設定エラー

### レート制限エラー (RATE_xxx)
- `RATE_001`: レート制限超過
- `RATE_002`: IPブロック
- `RATE_003`: ユーザー停止

### メンテナンスエラー (MAINT_xxx)
- `MAINT_001`: 予定メンテナンス
- `MAINT_002`: 緊急メンテナンス

## レート制限

### ユーザータイプ別制限（1時間あたり）
| ユーザータイプ | 一般API | AI検索 | 画像認識 | 音声検索 | 最適化 |
|-------------|--------|--------|----------|----------|--------|
| ゲスト | 100 | 10 | 5 | 3 | 2 |
| 登録ユーザー | 1000 | 100 | 30 | 20 | 10 |
| プレミアム | 5000 | 500 | 100 | 50 | 50 |
| 管理者 | 10000 | 1000 | 200 | 100 | 100 |

### レート制限ヘッダー
```http
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1635724800
X-RateLimit-Type: user_type
```

## WebSocket（リアルタイム機能）

### 接続
```javascript
const ws = new WebSocket('wss://api.travelcanvas.app/ws/plan/{plan_id}?token={jwt_token}');
```

### イベントタイプ
- `plan_updated`: プラン更新
- `event_added`: イベント追加
- `event_updated`: イベント更新
- `event_deleted`: イベント削除
- `collaborator_joined`: コラボレーター参加
- `optimization_complete`: 最適化完了

### メッセージ形式
```json
{
  "type": "plan_updated",
  "timestamp": "2025-08-01T12:00:00Z",
  "user_id": "user-uuid",
  "data": {
    "plan_id": "plan-uuid",
    "changes": {
      "field": "title",
      "old_value": "古いタイトル",
      "new_value": "新しいタイトル"
    }
  }
}
```

## SDK・クライアントライブラリ

### JavaScript/TypeScript
```bash
npm install @travelcanvas/api-client
```

```javascript
import { TravelCanvasAPI } from '@travelcanvas/api-client';

const api = new TravelCanvasAPI({
  baseURL: 'https://api.travelcanvas.app',
  apiKey: 'your-api-key'
});

// 認証
const auth = await api.auth.createGuestSession();
await api.auth.login({ email: 'user@example.com', password: 'password' });

// 旅行プラン
const plans = await api.travel.getPlans({ page: 1, pageSize: 20 });
const plan = await api.travel.createPlan({
  title: '東京観光',
  destination: '東京',
  startDate: '2025-08-01',
  endDate: '2025-08-03'
});

// AI機能
const searchResults = await api.ai.searchText({
  query: '東京 観光',
  location: { latitude: 35.6762, longitude: 139.6503 }
});

const optimizationResult = await api.ai.optimizePlan(plan.id, {
  optimizationType: 'balanced'
});
```

### Python
```bash
pip install travelcanvas-api-client
```

```python
from travelcanvas import TravelCanvasAPI

api = TravelCanvasAPI(
    base_url='https://api.travelcanvas.app',
    api_key='your-api-key'
)

# 認証
guest_session = api.auth.create_guest_session()
login_result = api.auth.login(email='user@example.com', password='password')

# 旅行プラン
plans = api.travel.get_plans(page=1, page_size=20)
plan = api.travel.create_plan(
    title='東京観光',
    destination='東京',
    start_date='2025-08-01',
    end_date='2025-08-03'
)

# AI機能
search_results = api.ai.search_text(
    query='東京 観光',
    location={'latitude': 35.6762, 'longitude': 139.6503}
)
```

## セキュリティ

### HTTPS必須
- 本番環境では全てのAPIリクエストでHTTPS必須
- HTTP接続は自動的にHTTPSにリダイレクト

### 認証トークン
- JWT形式
- Bearer認証
- 適切なexpiration設定
- Refresh tokenによる自動更新

### CORS設定
```http
Access-Control-Allow-Origin: https://travelcanvas.app
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type, X-Request-ID
Access-Control-Max-Age: 86400
```

### セキュリティヘッダー
```http
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

### API キー管理
- 環境変数での管理
- 定期的なローテーション
- スコープ制限
- 使用状況監視

## パフォーマンス

### キャッシュ戦略
- CDN利用
- Redis キャッシュ
- データベースクエリキャッシュ
- ブラウザキャッシュ制御

### レスポンス最適化
- データの圧縮
- 不要フィールドの除外
- ページネーション実装
- 非同期処理の活用

## 監視・ログ

### ログレベル
- DEBUG: 詳細なデバッグ情報
- INFO: 一般的な情報
- WARNING: 警告（処理は継続）
- ERROR: エラー（処理に影響）
- CRITICAL: 重大なエラー

### メトリクス
- レスポンス時間
- エラー率
- API使用回数
- ユーザーアクティビティ

### アラート
- サーバーエラー率が閾値を超過
- レスポンス時間が基準を超過
- データベース接続エラー
- レート制限の大量発生

## 変更履歴

### v1.0.0 (2025-08-01)
- 初期リリース
- ハイブリッド認証システム
- AI機能（検索、最適化、画像・音声認識）
- 管理機能完全実装
- リアルタイム共同編集

### 今後の予定
- v1.1.0: 多言語対応強化
- v1.2.0: AR機能統合
- v1.3.0: オフライン機能対応
- v1.4.0: GraphQL API 追加

---

**注意**: この仕様書は TravelCanvas Backend v1.0.0 に基づいています。最新の情報については、[開発者ドキュメント](https://docs.travelcanvas.app) を参照してください。