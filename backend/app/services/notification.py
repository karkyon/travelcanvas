"""
TravelCanvas 通知サービス (統合版)
~/travelcanvas/backend/app/services/notification.py
"""

import asyncio
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.mime.base import MIMEBase
from email import encoders
from typing import List, Dict, Optional, Any, Union
import logging
import json

try:
    import redis
    REDIS_AVAILABLE = True
except ImportError:
    REDIS_AVAILABLE = False

from jinja2 import Environment, FileSystemLoader, Template

from app.core.config import settings
from app.core.exceptions import ValidationError
from app.utils.constants import (
    NotificationType, NotificationEvent, EMAIL_TEMPLATES
)

logger = logging.getLogger(__name__)

class NotificationService:
    """
    統合通知サービス
    メール・プッシュ・SMS・アプリ内通知を統一管理
    """
    
    def __init__(self):
        self.redis_client = None
        self.email_templates = {}
        self.notification_queue = []
        
        # Redis初期化
        self._initialize_redis()
        
        # テンプレートエンジン初期化
        self._initialize_templates()
    
    def _initialize_redis(self):
        """Redis初期化（通知キューとして使用）"""
        if not REDIS_AVAILABLE or settings.TESTING:
            logger.info("Using in-memory notification queue")
            return
        
        try:
            self.redis_client = redis.from_url(
                settings.REDIS_URL,
                password=settings.REDIS_PASSWORD,
                decode_responses=True
            )
            self.redis_client.ping()
            logger.info("Redis notification queue initialized")
        except Exception as e:
            logger.warning(f"Redis initialization failed: {e}. Using in-memory queue.")
            self.redis_client = None
    
    def _initialize_templates(self):
        """メールテンプレート初期化"""
        try:
            # テンプレートディレクトリのパス
            template_dir = "app/templates/email"
            
            # Jinja2環境設定
            self.jinja_env = Environment(
                loader=FileSystemLoader(template_dir),
                autoescape=True
            )
            
            # デフォルトテンプレート定義
            self.email_templates = {
                "welcome": {
                    "subject": "TravelCanvasへようこそ！",
                    "template": "welcome.html",
                    "text_template": "welcome.txt"
                },
                "password_reset": {
                    "subject": "パスワードリセットのご案内",
                    "template": "password_reset.html",
                    "text_template": "password_reset.txt"
                },
                "plan_shared": {
                    "subject": "旅行プランが共有されました",
                    "template": "plan_shared.html",
                    "text_template": "plan_shared.txt"
                },
                "collaboration_invite": {
                    "subject": "旅行プランへの招待",
                    "template": "collaboration_invite.html",
                    "text_template": "collaboration_invite.txt"
                },
                "optimization_complete": {
                    "subject": "旅行プランの最適化が完了しました",
                    "template": "optimization_complete.html",
                    "text_template": "optimization_complete.txt"
                }
            }
            
            logger.info("Email templates initialized")
            
        except Exception as e:
            logger.warning(f"Template initialization failed: {e}")
            self.jinja_env = None
    
    async def send_email(
        self,
        to_email: str,
        subject: str,
        template_name: Optional[str] = None,
        template_data: Optional[Dict[str, Any]] = None,
        html_content: Optional[str] = None,
        text_content: Optional[str] = None,
        attachments: Optional[List[Dict[str, Any]]] = None,
        priority: str = "normal"
    ) -> bool:
        """
        メール送信
        
        Args:
            to_email: 宛先メールアドレス
            subject: 件名
            template_name: テンプレート名
            template_data: テンプレートデータ
            html_content: HTML本文（直接指定）
            text_content: テキスト本文（直接指定）
            attachments: 添付ファイル
            priority: 優先度
        
        Returns:
            bool: 送信成功かどうか
        """
        try:
            # テンプレートベースの場合
            if template_name and template_name in self.email_templates:
                template_config = self.email_templates[template_name]
                subject = template_config["subject"]
                
                if self.jinja_env:
                    # HTMLテンプレート
                    html_template = self.jinja_env.get_template(template_config["template"])
                    html_content = html_template.render(template_data or {})
                    
                    # テキストテンプレート
                    if template_config.get("text_template"):
                        text_template = self.jinja_env.get_template(template_config["text_template"])
                        text_content = text_template.render(template_data or {})
                else:
                    # フォールバック用の簡易テンプレート
                    html_content = await self._generate_fallback_email(template_name, template_data or {})
                    text_content = await self._generate_fallback_text(template_name, template_data or {})
            
            # メール作成
            message = MIMEMultipart("alternative")
            message["Subject"] = subject
            message["From"] = settings.EMAIL_FROM
            message["To"] = to_email
            
            # 優先度設定
            if priority == "high":
                message["X-Priority"] = "1"
                message["X-MSMail-Priority"] = "High"
            elif priority == "low":
                message["X-Priority"] = "5"
                message["X-MSMail-Priority"] = "Low"
            
            # テキスト部分
            if text_content:
                text_part = MIMEText(text_content, "plain", "utf-8")
                message.attach(text_part)
            
            # HTML部分
            if html_content:
                html_part = MIMEText(html_content, "html", "utf-8")
                message.attach(html_part)
            
            # 添付ファイル
            if attachments:
                for attachment in attachments:
                    await self._add_attachment(message, attachment)
            
            # SMTP送信
            if settings.MOCK_EXTERNAL_APIS:
                # モック送信（開発・テスト用）
                logger.info(f"Mock email sent to {to_email}: {subject}")
                return True
            else:
                return await self._send_smtp(message, to_email)
                
        except Exception as e:
            logger.error(f"Email sending failed: {e}")
            return False
    
    async def _send_smtp(self, message: MIMEMultipart, to_email: str) -> bool:
        """SMTP経由でメール送信"""
        try:
            # SMTP設定
            context = ssl.create_default_context()
            
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT) as server:
                if settings.SMTP_USE_TLS:
                    server.starttls(context=context)
                
                if settings.SMTP_USERNAME and settings.SMTP_PASSWORD:
                    server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
                
                # メール送信
                server.sendmail(settings.EMAIL_FROM, to_email, message.as_string())
            
            logger.info(f"Email sent successfully to {to_email}")
            return True
            
        except Exception as e:
            logger.error(f"SMTP sending failed: {e}")
            return False
    
    async def _add_attachment(self, message: MIMEMultipart, attachment: Dict[str, Any]):
        """添付ファイル追加"""
        try:
            filename = attachment.get("filename", "attachment")
            content = attachment.get("content", b"")
            content_type = attachment.get("content_type", "application/octet-stream")
            
            part = MIMEBase(*content_type.split("/"))
            part.set_payload(content)
            encoders.encode_base64(part)
            
            part.add_header(
                "Content-Disposition",
                f"attachment; filename= {filename}"
            )
            
            message.attach(part)
            
        except Exception as e:
            logger.warning(f"Attachment failed: {e}")
    
    async def _generate_fallback_email(self, template_name: str, data: Dict[str, Any]) -> str:
        """フォールバック用メールHTML生成"""
        fallback_templates = {
            "welcome": f"""
            <html>
                <body>
                    <h2>TravelCanvasへようこそ！</h2>
                    <p>{data.get('user_name', 'ユーザー')}様</p>
                    <p>TravelCanvasへのご登録ありがとうございます。</p>
                    <p>素晴らしい旅行計画をお楽しみください！</p>
                </body>
            </html>
            """,
            "password_reset": f"""
            <html>
                <body>
                    <h2>パスワードリセット</h2>
                    <p>パスワードリセットのご依頼を承りました。</p>
                    <p>下記のリンクからパスワードを再設定してください：</p>
                    <a href="{data.get('reset_url', '#')}">パスワードリセット</a>
                </body>
            </html>
            """
        }
        
        return fallback_templates.get(template_name, "<p>通知内容</p>")
    
    async def _generate_fallback_text(self, template_name: str, data: Dict[str, Any]) -> str:
        """フォールバック用メールテキスト生成"""
        fallback_texts = {
            "welcome": f"""
TravelCanvasへようこそ！

{data.get('user_name', 'ユーザー')}様

TravelCanvasへのご登録ありがとうございます。
素晴らしい旅行計画をお楽しみください！
            """,
            "password_reset": f"""
パスワードリセット

パスワードリセットのご依頼を承りました。
下記のリンクからパスワードを再設定してください：

{data.get('reset_url', 'リセットURL')}
            """
        }
        
        return fallback_texts.get(template_name, "通知内容")
    
    async def send_welcome_email(self, email: str, user_name: str) -> bool:
        """ウェルカムメール送信"""
        return await self.send_email(
            to_email=email,
            template_name="welcome",
            template_data={
                "user_name": user_name,
                "app_name": "TravelCanvas",
                "login_url": f"{getattr(settings, 'FRONTEND_URL', 'https://travelcanvas.app')}/login"
            }
        )
    
    async def send_password_reset_email(self, email: str, user_name: str, reset_token: str) -> bool:
        """パスワードリセットメール送信"""
        reset_url = f"{getattr(settings, 'FRONTEND_URL', 'https://travelcanvas.app')}/reset-password?token={reset_token}"
        
        return await self.send_email(
            to_email=email,
            template_name="password_reset",
            template_data={
                "user_name": user_name,
                "reset_url": reset_url,
                "app_name": "TravelCanvas"
            },
            priority="high"
        )
    
    async def send_plan_shared_email(
        self, 
        email: str, 
        user_name: str, 
        plan_title: str, 
        shared_by: str,
        share_url: str
    ) -> bool:
        """プラン共有通知メール送信"""
        return await self.send_email(
            to_email=email,
            template_name="plan_shared",
            template_data={
                "user_name": user_name,
                "plan_title": plan_title,
                "shared_by": shared_by,
                "share_url": share_url,
                "app_name": "TravelCanvas"
            }
        )
    
    async def send_collaboration_invite_email(
        self,
        email: str,
        plan_title: str,
        invited_by: str,
        invitation_url: str,
        permission_level: str
    ) -> bool:
        """コラボレーション招待メール送信"""
        return await self.send_email(
            to_email=email,
            template_name="collaboration_invite",
            template_data={
                "plan_title": plan_title,
                "invited_by": invited_by,
                "invitation_url": invitation_url,
                "permission_level": permission_level,
                "app_name": "TravelCanvas"
            }
        )
    
    async def send_optimization_complete_email(
        self,
        email: str,
        user_name: str,
        plan_title: str,
        optimization_results: Dict[str, Any]
    ) -> bool:
        """最適化完了通知メール送信"""
        return await self.send_email(
            to_email=email,
            template_name="optimization_complete",
            template_data={
                "user_name": user_name,
                "plan_title": plan_title,
                "time_saved": optimization_results.get("time_saved_minutes", 0),
                "cost_saved": optimization_results.get("cost_saved", 0),
                "optimization_score": optimization_results.get("optimization_score", 0),
                "plan_url": f"{getattr(settings, 'FRONTEND_URL', 'https://travelcanvas.app')}/plans/{optimization_results.get('plan_id')}",
                "app_name": "TravelCanvas"
            }
        )
    
    async def queue_notification(
        self,
        notification_type: NotificationType,
        event: NotificationEvent,
        recipient: str,
        data: Dict[str, Any],
        priority: str = "normal",
        delay_seconds: int = 0
    ):
        """
        通知をキューに追加
        
        Args:
            notification_type: 通知タイプ
            event: 通知イベント
            recipient: 受信者
            data: 通知データ
            priority: 優先度
            delay_seconds: 遅延秒数
        """
        notification = {
            "id": f"notif_{datetime.now().timestamp()}_{len(self.notification_queue)}",
            "type": notification_type.value,
            "event": event.value,
            "recipient": recipient,
            "data": data,
            "priority": priority,
            "scheduled_at": datetime.now(timezone.utc).timestamp() + delay_seconds,
            "created_at": datetime.now(timezone.utc).timestamp(),
            "status": "queued"
        }
        
        if self.redis_client:
            # Redisキューに追加
            queue_key = f"notification_queue:{priority}"
            await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: self.redis_client.lpush(queue_key, json.dumps(notification))
            )
        else:
            # メモリキューに追加
            self.notification_queue.append(notification)
        
        logger.info(f"Notification queued: {notification['id']}")
    
    async def process_notification_queue(self, max_batch_size: int = 10) -> int:
        """
        通知キューの処理
        
        Args:
            max_batch_size: 最大バッチサイズ
        
        Returns:
            int: 処理した通知数
        """
        processed_count = 0
        current_time = datetime.now(timezone.utc).timestamp()
        
        try:
            if self.redis_client:
                # Redisキューから処理
                processed_count = await self._process_redis_queue(max_batch_size, current_time)
            else:
                # メモリキューから処理
                processed_count = await self._process_memory_queue(max_batch_size, current_time)
            
            if processed_count > 0:
                logger.info(f"Processed {processed_count} notifications")
            
            return processed_count
            
        except Exception as e:
            logger.error(f"Notification queue processing failed: {e}")
            return 0
    
    async def _process_redis_queue(self, max_batch_size: int, current_time: float) -> int:
        """Redisキューから通知処理"""
        processed_count = 0
        
        # 優先度順で処理
        for priority in ["high", "normal", "low"]:
            queue_key = f"notification_queue:{priority}"
            
            for _ in range(max_batch_size - processed_count):
                notification_json = self.redis_client.rpop(queue_key)
                if not notification_json:
                    break
                
                try:
                    notification = json.loads(notification_json)
                    
                    # 送信時刻チェック
                    if notification["scheduled_at"] > current_time:
                        # 時間になっていない場合は再キュー
                        self.redis_client.lpush(queue_key, notification_json)
                        continue
                    
                    # 通知送信
                    success = await self._send_notification(notification)
                    if success:
                        processed_count += 1
                    
                except Exception as e:
                    logger.error(f"Notification processing failed: {e}")
            
            if processed_count >= max_batch_size:
                break
        
        return processed_count
    
    async def _process_memory_queue(self, max_batch_size: int, current_time: float) -> int:
        """メモリキューから通知処理"""
        processed_count = 0
        remaining_notifications = []
        
        for notification in self.notification_queue:
            if processed_count >= max_batch_size:
                remaining_notifications.append(notification)
                continue
            
            # 送信時刻チェック
            if notification["scheduled_at"] > current_time:
                remaining_notifications.append(notification)
                continue
            
            # 通知送信
            try:
                success = await self._send_notification(notification)
                if success:
                    processed_count += 1
                else:
                    # 失敗した場合は再試行のためキューに残す
                    remaining_notifications.append(notification)
            except Exception as e:
                logger.error(f"Notification processing failed: {e}")
                remaining_notifications.append(notification)
        
        # キューを更新
        self.notification_queue = remaining_notifications
        
        return processed_count
    
    async def _send_notification(self, notification: Dict[str, Any]) -> bool:
        """個別通知送信"""
        try:
            notification_type = NotificationType(notification["type"])
            event = NotificationEvent(notification["event"])
            recipient = notification["recipient"]
            data = notification["data"]
            
            if notification_type == NotificationType.EMAIL:
                return await self._send_email_notification(event, recipient, data)
            elif notification_type == NotificationType.PUSH:
                return await self._send_push_notification(event, recipient, data)
            elif notification_type == NotificationType.SMS:
                return await self._send_sms_notification(event, recipient, data)
            elif notification_type == NotificationType.IN_APP:
                return await self._send_in_app_notification(event, recipient, data)
            else:
                logger.warning(f"Unknown notification type: {notification_type}")
                return False
                
        except Exception as e:
            logger.error(f"Notification sending failed: {e}")
            return False
    
    async def _send_email_notification(self, event: NotificationEvent, recipient: str, data: Dict[str, Any]) -> bool:
        """メール通知送信"""
        email_handlers = {
            NotificationEvent.USER_REGISTERED: lambda: self.send_welcome_email(
                recipient, data.get("user_name", "")
            ),
            NotificationEvent.PASSWORD_RESET: lambda: self.send_password_reset_email(
                recipient, data.get("user_name", ""), data.get("reset_token", "")
            ),
            NotificationEvent.PLAN_SHARED: lambda: self.send_plan_shared_email(
                recipient, data.get("user_name", ""), data.get("plan_title", ""),
                data.get("shared_by", ""), data.get("share_url", "")
            ),
            NotificationEvent.COLLABORATION_INVITE: lambda: self.send_collaboration_invite_email(
                recipient, data.get("plan_title", ""), data.get("invited_by", ""),
                data.get("invitation_url", ""), data.get("permission_level", "")
            ),
            NotificationEvent.OPTIMIZATION_COMPLETE: lambda: self.send_optimization_complete_email(
                recipient, data.get("user_name", ""), data.get("plan_title", ""), data.get("results", {})
            )
        }
        
        handler = email_handlers.get(event)
        if handler:
            return await handler()
        else:
            logger.warning(f"No email handler for event: {event}")
            return False
    
    async def _send_push_notification(self, event: NotificationEvent, recipient: str, data: Dict[str, Any]) -> bool:
        """プッシュ通知送信（モック実装）"""
        # 実際の実装では FCM や APNs を使用
        logger.info(f"Push notification sent to {recipient}: {event}")
        return True
    
    async def _send_sms_notification(self, event: NotificationEvent, recipient: str, data: Dict[str, Any]) -> bool:
        """SMS通知送信（モック実装）"""
        # 実際の実装では Twilio などのSMSサービスを使用
        logger.info(f"SMS notification sent to {recipient}: {event}")
        return True
    
    async def _send_in_app_notification(self, event: NotificationEvent, recipient: str, data: Dict[str, Any]) -> bool:
        """アプリ内通知送信（モック実装）"""
        # 実際の実装では WebSocket や データベースを使用
        logger.info(f"In-app notification sent to {recipient}: {event}")
        return True
    
    def get_queue_stats(self) -> Dict[str, Any]:
        """キュー統計情報取得"""
        try:
            if self.redis_client:
                stats = {}
                for priority in ["high", "normal", "low"]:
                    queue_key = f"notification_queue:{priority}"
                    stats[f"{priority}_queue_size"] = self.redis_client.llen(queue_key)
                return stats
            else:
                return {
                    "memory_queue_size": len(self.notification_queue),
                    "queued_notifications": [n["event"] for n in self.notification_queue[:10]]
                }
        except Exception as e:
            logger.error(f"Queue stats failed: {e}")
            return {"error": str(e)}

# シングルトンインスタンス
notification_service = NotificationService()

# 便利関数
async def send_welcome_email(email: str, user_name: str) -> bool:
    """ウェルカムメール送信便利関数"""
    return await notification_service.send_welcome_email(email, user_name)

async def send_password_reset_email(email: str, user_name: str, reset_token: str) -> bool:
    """パスワードリセットメール送信便利関数"""
    return await notification_service.send_password_reset_email(email, user_name, reset_token)

async def queue_notification(
    notification_type: NotificationType,
    event: NotificationEvent,
    recipient: str,
    data: Dict[str, Any],
    priority: str = "normal"
):
    """通知キュー追加便利関数"""
    await notification_service.queue_notification(
        notification_type, event, recipient, data, priority
    )