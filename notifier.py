# -*- coding: utf-8 -*-
"""
桌面通知和提醒模块
实现Windows桌面弹窗通知和提示音播放功能
"""

import os
import sys
import threading
import time
from typing import Optional, Callable
from pathlib import Path


class Notifier:
    """桌面通知器"""
    
    def __init__(self):
        # 通知状态
        self.notification_enabled = True
        self.sound_enabled = True
        
        # 最后一次通知时间（防止重复通知）
        self._last_notify_time = {}
        self._notify_cooldown = 60  # 相同主播的通知冷却时间（秒）
        
        # 初始化通知模块
        self._init_modules()
    
    def _init_modules(self):
        """初始化各种通知模块"""
        # 尝试导入win10toast
        try:
            from win10toast import ToastNotifier
            self._toaster = ToastNotifier()
            self._win10toast_available = True
        except ImportError:
            self._win10toast_available = False
            self._toaster = None
        
        # Windows 10/11 原生通知（如果win10toast不可用）
        try:
            import win10toast
        except ImportError:
            # 尝试使用Windows原生API
            try:
                import ctypes
                self._ctypes_available = True
                self._user32 = ctypes.windll.user32
                self._shell32 = ctypes.windll.shell32
            except:
                self._ctypes_available = False
        
        # 声音模块
        self._sound_module = None
        try:
            import winsound
            self._sound_module = winsound
            self._winsound_available = True
        except ImportError:
            self._winsound_available = False
    
    def set_notification_enabled(self, enabled: bool):
        """设置是否启用通知"""
        self.notification_enabled = enabled
    
    def set_sound_enabled(self, enabled: bool):
        """设置是否启用提示音"""
        self.sound_enabled = enabled
    
    def notify_live_start(
        self,
        streamer_name: str,
        room_id: str,
        title: str = "",
        custom_message: str = None
    ):
        """
        发送开播通知
        参数:
            streamer_name: 主播名称
            room_id: 直播间ID
            title: 直播间标题
            custom_message: 自定义消息
        """
        # 检查冷却时间
        current_time = time.time()
        if room_id in self._last_notify_time:
            if current_time - self._last_notify_time[room_id] < self._notify_cooldown:
                print(f"通知冷却中，跳过: {streamer_name}")
                return
        
        # 更新通知时间
        self._last_notify_time[room_id] = current_time
        
        # 构建消息
        title_text = f"{streamer_name} 开播了！"
        if custom_message:
            message = custom_message
        else:
            message = f"直播间: {room_id}\n{title[:30] if title else '正在直播...'}"
        
        # 播放提示音
        if self.sound_enabled:
            self._play_notification_sound()
        
        # 发送桌面通知
        if self.notification_enabled:
            self._show_notification(title_text, message, room_id)
        
        print(f"[通知] {title_text} - {message}")
    
    def notify_recording_start(self, streamer_name: str, room_id: str):
        """发送开始录制通知"""
        if self.notification_enabled:
            title = f"开始录制: {streamer_name}"
            message = f"直播间 {room_id} 正在录制中..."
            self._show_notification(title, message, room_id)
        
        if self.sound_enabled:
            self._play_recording_sound()
        
        print(f"[通知] 开始录制: {streamer_name} (直播间: {room_id})")
    
    def notify_recording_stop(self, streamer_name: str, room_id: str, file_path: str, duration: float = 0):
        """发送录制完成通知"""
        if self.notification_enabled:
            duration_str = self._format_duration(duration)
            title = f"录制完成: {streamer_name}"
            message = f"时长: {duration_str}\n已保存到: {os.path.basename(file_path)}"
            self._show_notification(title, message, room_id)
        
        print(f"[通知] 录制完成: {streamer_name} (时长: {self._format_duration(duration)})")
    
    def notify_error(self, error_message: str, room_id: str = None):
        """发送错误通知"""
        if self.notification_enabled:
            title = "错误提醒"
            self._show_notification(title, error_message, room_id or "error")
        
        print(f"[错误] {error_message}")
    
    def _show_notification(self, title: str, message: str, identifier: str = None):
        """
        显示桌面通知
        优先使用win10toast，如果不可用则使用Windows原生API
        """
        # 1. 尝试使用win10toast
        if self._win10toast_available and self._toaster:
            try:
                # 获取图标路径
                icon_path = self._get_icon_path()
                
                # 显示通知
                self._toaster.show_toast(
                    title,
                    message,
                    icon_path=icon_path,
                    duration=5,
                    threaded=True
                )
                return
            except Exception as e:
                print(f"win10toast通知失败: {e}")
        
        # 2. 尝试使用ctypes调用Windows API
        if self._ctypes_available:
            try:
                self._show_windows_notification(title, message)
                return
            except Exception as e:
                print(f"Windows API通知失败: {e}")
        
        # 3. 最后使用简单的控制台提示
        print(f"\n{'='*50}")
        print(f"【{title}】")
        print(message)
        print(f"{'='*50}\n")
    
    def _show_windows_notification(self, title: str, message: str):
        """使用Windows原生API显示通知"""
        try:
            import ctypes
            from ctypes import wintypes
            
            # 定义结构体
            class NOTIFYICONDATA(ctypes.Structure):
                _fields_ = [
                    ("cbSize", wintypes.DWORD),
                    ("hWnd", wintypes.HWND),
                    ("uID", wintypes.UINT),
                    ("uFlags", wintypes.UINT),
                    ("uCallbackMessage", wintypes.UINT),
                    ("hIcon", wintypes.HICON),
                    ("szTip", ctypes.c_char * 128),
                    ("dwState", wintypes.DWORD),
                    ("dwStateMask", wintypes.DWORD),
                    ("szInfo", ctypes.c_char * 256),
                    ("uTimeout", wintypes.UINT),
                    ("szInfoTitle", ctypes.c_char * 64),
                    ("dwInfoFlags", wintypes.DWORD),
                ]
            
            # 简化版本：直接使用MessageBeep
            if self._winsound_available:
                self._sound_module.MessageBeep(self._sound_module.MB_ICONINFORMATION)
            
            # 使用控制台输出作为备选
            print(f"\n>>> {title}")
            print(f">>> {message}\n")
            
        except Exception as e:
            print(f"显示Windows通知失败: {e}")
    
    def _play_notification_sound(self):
        """播放通知提示音"""
        if not self.sound_enabled:
            return
        
        # 尝试播放Windows默认通知音
        if self._winsound_available:
            try:
                # 播放Windows通知音
                self._sound_module.PlaySound(
                    "SystemNotification",
                    self._sound_module.SND_ALIAS | self._sound_module.SND_ASYNC
                )
            except:
                try:
                    # 播放简单的蜂鸣声
                    self._sound_module.Beep(1000, 200)
                    time.sleep(0.1)
                    self._sound_module.Beep(1200, 200)
                except:
                    pass
    
    def _play_recording_sound(self):
        """播放录制开始提示音"""
        if not self.sound_enabled:
            return
        
        if self._winsound_available:
            try:
                self._sound_module.Beep(800, 150)
                time.sleep(0.1)
                self._sound_module.Beep(1000, 150)
                time.sleep(0.1)
                self._sound_module.Beep(1200, 150)
            except:
                pass
    
    def _play_custom_sound(self, sound_file: str):
        """播放自定义声音文件"""
        if not self.sound_enabled:
            return
        
        if not os.path.exists(sound_file):
            return
        
        if self._winsound_available:
            try:
                self._sound_module.PlaySound(
                    sound_file,
                    self._sound_module.SND_FILENAME | self._sound_module.SND_ASYNC
                )
            except:
                pass
    
    def _get_icon_path(self) -> Optional[str]:
        """获取应用图标路径"""
        # 尝试查找图标文件
        possible_paths = [
            os.path.join(os.path.dirname(__file__), "assets", "icon.ico"),
            os.path.join(os.path.dirname(__file__), "icon.ico"),
        ]
        
        for path in possible_paths:
            if os.path.exists(path):
                return path
        
        # 返回None，使用默认图标
        return None
    
    def _format_duration(self, seconds: float) -> str:
        """格式化时长"""
        if seconds <= 0:
            return "未知"
        
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        secs = int(seconds % 60)
        
        if hours > 0:
            return f"{hours}小时{minutes}分{secs}秒"
        elif minutes > 0:
            return f"{minutes}分{secs}秒"
        else:
            return f"{secs}秒"
    
    def play_test_sound(self):
        """播放测试音"""
        if self._winsound_available:
            try:
                self._sound_module.Beep(880, 300)
                return True
            except:
                return False
        return False
    
    def show_test_notification(self):
        """显示测试通知"""
        self._show_notification(
            "测试通知",
            "这是一条测试通知，用于验证通知功能是否正常工作。",
            "test"
        )
        return True
