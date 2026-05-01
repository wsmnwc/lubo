# -*- coding: utf-8 -*-
"""
核心逻辑模块
整合直播间监控、录屏和通知功能
实现自动监控、开播提醒、自动录屏的完整流程
"""

import os
import time
import threading
from datetime import datetime
from typing import Dict, List, Optional, Callable, Any
from collections import defaultdict

from config import ConfigManager
from bilibili_monitor import BilibiliMonitor
from recorder import StreamRecorder
from notifier import Notifier


class MonitorCore:
    """监控核心控制器"""
    
    def __init__(self):
        # 初始化各个模块
        self.config = ConfigManager()
        self.monitor = BilibiliMonitor()
        self.recorder = StreamRecorder()
        self.notifier = Notifier()
        
        # 监控状态
        self.is_running = False
        self.monitor_thread = None
        self._stop_event = threading.Event()
        
        # 主播状态记录
        self._streamer_states = defaultdict(lambda: {
            "is_live": False,
            "last_check_time": None,
            "live_start_time": None,
            "consecutive_errors": 0,
            "last_room_info": None
        })
        
        # 正在录制的主播
        self._recording_rooms = set()
        
        # 回调函数
        self.on_streamer_status_change = None  # 主播状态变化回调
        self.on_monitor_tick = None          # 每次监控周期回调
        self.on_error = None                  # 错误回调
        
        # 锁
        self._state_lock = threading.Lock()
        
        # 设置录制回调
        self._setup_recorder_callbacks()
    
    def _setup_recorder_callbacks(self):
        """设置录制器回调"""
        self.recorder.on_start = self._on_recording_start
        self.recorder.on_stop = self._on_recording_stop
        self.recorder.on_error = self._on_recording_error
    
    def _on_recording_start(self, info: Dict):
        """录制开始回调"""
        room_id = info.get("room_id", "")
        streamer_name = info.get("streamer_name", "")
        
        # 发送通知
        if self.config.get_config("enable_notification", True):
            self.notifier.notify_recording_start(streamer_name, room_id)
        
        # 更新配置中的主播信息
        with self._state_lock:
            self._recording_rooms.add(room_id)
        
        # 触发外部回调
        if self.on_streamer_status_change:
            self.on_streamer_status_change({
                "room_id": room_id,
                "event": "recording_start",
                "info": info
            })
    
    def _on_recording_stop(self, info: Dict):
        """录制停止回调"""
        room_id = info.get("room_id", "")
        streamer_name = info.get("streamer_name", "")
        file_path = info.get("output_file", "")
        duration = info.get("duration", 0)
        
        # 添加到历史记录
        self.config.add_history({
            "room_id": room_id,
            "streamer_name": streamer_name,
            "title": info.get("title", ""),
            "start_time": info.get("start_time", ""),
            "end_time": info.get("end_time", ""),
            "file_path": file_path,
            "file_size": info.get("file_size", 0),
            "duration": duration,
            "status": "completed"
        })
        
        # 发送通知
        if self.config.get_config("enable_notification", True):
            self.notifier.notify_recording_stop(streamer_name, room_id, file_path, duration)
        
        # 更新状态
        with self._state_lock:
            self._recording_rooms.discard(room_id)
        
        # 触发外部回调
        if self.on_streamer_status_change:
            self.on_streamer_status_change({
                "room_id": room_id,
                "event": "recording_stop",
                "info": info
            })
    
    def _on_recording_error(self, error_msg: str):
        """录制错误回调"""
        print(f"录制错误: {error_msg}")
        
        if self.on_error:
            self.on_error("录制错误", error_msg)
    
    def start_monitor(self):
        """开始监控"""
        if self.is_running:
            print("监控已在运行中")
            return False
        
        # 检查FFmpeg
        if not self.recorder.check_ffmpeg_available():
            error_msg = "FFmpeg未安装或未配置，请先安装FFmpeg"
            print(error_msg)
            if self.on_error:
                self.on_error("配置错误", error_msg)
            return False
        
        self.is_running = True
        self._stop_event.clear()
        
        # 启动监控线程
        self.monitor_thread = threading.Thread(
            target=self._monitor_loop,
            daemon=True,
            name="MonitorThread"
        )
        self.monitor_thread.start()
        
        print("监控已启动")
        return True
    
    def stop_monitor(self):
        """停止监控"""
        if not self.is_running:
            return
        
        print("正在停止监控...")
        self._stop_event.set()
        self.is_running = False
        
        # 停止所有录制
        self._stop_all_recordings()
        
        # 等待监控线程结束
        if self.monitor_thread and self.monitor_thread.is_alive():
            self.monitor_thread.join(timeout=10)
        
        print("监控已停止")
    
    def _stop_all_recordings(self):
        """停止所有录制任务"""
        if self.recorder.is_recording:
            self.recorder.stop_recording()
    
    def _monitor_loop(self):
        """监控主循环"""
        monitor_interval = self.config.get_config("monitor_interval", 10)
        
        while not self._stop_event.is_set():
            try:
                # 获取所有需要监控的主播
                streamers = self.config.get_streamers()
                monitoring_streamers = [s for s in streamers if s.get("is_monitoring", False)]
                
                # 逐个检查主播状态
                for streamer in monitoring_streamers:
                    if self._stop_event.is_set():
                        break
                    
                    room_id = streamer.get("room_id", "")
                    if not room_id:
                        continue
                    
                    self._check_streamer(room_id)
                
                # 触发周期回调
                if self.on_monitor_tick:
                    self.on_monitor_tick()
                
                # 等待下一次检查
                self._stop_event.wait(monitor_interval)
                
            except Exception as e:
                print(f"监控循环出错: {e}")
                if self.on_error:
                    self.on_error("监控错误", str(e))
                # 出错后等待一段时间再继续
                self._stop_event.wait(5)
    
    def _check_streamer(self, room_id: str):
        """检查单个主播的状态"""
        try:
            # 获取直播间状态
            is_live, status_desc, room_info = self.monitor.check_live_status(room_id)
            
            # 更新检查时间
            with self._state_lock:
                state = self._streamer_states[room_id]
                state["last_check_time"] = datetime.now()
                state["last_room_info"] = room_info
            
            # 处理状态变化
            if is_live:
                # 主播正在直播
                self._handle_live_state(room_id, room_info)
            else:
                # 主播未开播或已下播
                self._handle_offline_state(room_id, room_info)
            
            # 重置错误计数
            with self._state_lock:
                self._streamer_states[room_id]["consecutive_errors"] = 0
                
        except Exception as e:
            print(f"检查主播 {room_id} 状态时出错: {e}")
            
            # 记录错误
            with self._state_lock:
                self._streamer_states[room_id]["consecutive_errors"] += 1
    
    def _handle_live_state(self, room_id: str, room_info: Dict):
        """处理主播正在直播的状态"""
        with self._state_lock:
            state = self._streamer_states[room_id]
            was_live = state["is_live"]
        
        # 获取主播信息
        streamer_name = room_info.get("uname", f"主播_{room_id}")
        title = room_info.get("title", "")
        
        if not was_live:
            # 刚刚开播！
            print(f"【开播提醒】{streamer_name} 开播了！")
            
            # 更新状态
            with self._state_lock:
                state["is_live"] = True
                state["live_start_time"] = datetime.now()
            
            # 发送开播通知
            if self.config.get_config("enable_notification", True):
                self.notifier.notify_live_start(streamer_name, room_id, title)
            
            # 触发状态变化回调
            if self.on_streamer_status_change:
                self.on_streamer_status_change({
                    "room_id": room_id,
                    "event": "live_start",
                    "streamer_name": streamer_name,
                    "title": title,
                    "room_info": room_info
                })
            
            # 开始录制
            self._start_recording_if_needed(room_id, room_info)
        
        else:
            # 已经在直播中
            # 检查录制是否正常进行
            with self._state_lock:
                is_currently_recording = room_id in self._recording_rooms
            
            if not is_currently_recording:
                # 可能是监控中断后重新连接，重新开始录制
                print(f"重新开始录制: {streamer_name}")
                self._start_recording_if_needed(room_id, room_info)
    
    def _handle_offline_state(self, room_id: str, room_info: Dict):
        """处理主播未开播的状态"""
        with self._state_lock:
            state = self._streamer_states[room_id]
            was_live = state["is_live"]
        
        if was_live:
            # 刚刚下播
            streamer_name = room_info.get("uname", f"主播_{room_id}") if room_info else f"主播_{room_id}"
            print(f"【下播提醒】{streamer_name} 下播了")
            
            # 更新状态
            with self._state_lock:
                state["is_live"] = False
                state["live_start_time"] = None
            
            # 停止录制
            self._stop_recording_if_needed(room_id)
            
            # 更新配置中的主播信息
            self.config.update_streamer(room_id, {
                "is_live": False,
                "last_live_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })
            
            # 触发状态变化回调
            if self.on_streamer_status_change:
                self.on_streamer_status_change({
                    "room_id": room_id,
                    "event": "live_stop",
                    "streamer_name": streamer_name
                })
    
    def _start_recording_if_needed(self, room_id: str, room_info: Dict):
        """如果需要的话开始录制"""
        # 检查是否已经在录制
        with self._state_lock:
            if room_id in self._recording_rooms:
                return
        
        # 获取录制配置
        save_path = self.config.get_config("save_path", "")
        file_format = self.config.get_config("video_format", "mp4")
        file_name_format = self.config.get_config("file_name_format", "")
        quality_name = self.config.get_config("video_quality", "原画")
        quality_value = self.config.get_quality_value(quality_name)
        
        # 获取主播信息
        streamer_name = room_info.get("uname", f"主播_{room_id}")
        title = room_info.get("title", "")
        
        # 获取直播流地址
        stream_info = self.monitor.get_live_stream_url(room_id, quality_value)
        
        if not stream_info or not stream_info.get("stream_url"):
            print(f"无法获取直播流地址: {room_id}")
            if self.on_error:
                self.on_error("录制错误", f"无法获取 {streamer_name} 的直播流地址")
            return
        
        stream_url = stream_info.get("stream_url")
        
        # 开始录制
        print(f"开始录制: {streamer_name} - {title}")
        success = self.recorder.start_recording(
            stream_url=stream_url,
            room_id=room_id,
            streamer_name=streamer_name,
            title=title,
            save_path=save_path,
            file_format=file_format,
            file_name_format=file_name_format
        )
        
        if success:
            # 更新状态
            with self._state_lock:
                self._recording_rooms.add(room_id)
            
            # 更新配置中的主播信息
            self.config.update_streamer(room_id, {
                "is_live": True
            })
        else:
            print(f"启动录制失败: {streamer_name}")
    
    def _stop_recording_if_needed(self, room_id: str):
        """如果需要的话停止录制"""
        with self._state_lock:
            if room_id not in self._recording_rooms:
                return
        
        # 检查是否是当前录制的房间
        if self.recorder.current_room_id == room_id:
            print(f"停止录制: {room_id}")
            self.recorder.stop_recording()
    
    def add_streamer(self, input_str: str, note: str = "") -> tuple:
        """
        添加主播
        返回: (是否成功, 错误信息)
        """
        # 提取直播间ID
        room_id = self.monitor.extract_room_id(input_str)
        
        if not room_id:
            return False, "无法识别的直播间地址或ID"
        
        # 验证直播间是否存在
        exists, error_msg = self.monitor.verify_room_exists(room_id)
        if not exists:
            return False, error_msg or "直播间不存在"
        
        # 获取直播间信息
        room_info = self.monitor.get_room_info(room_id)
        if not room_info:
            return False, "无法获取直播间信息"
        
        streamer_name = room_info.get("uname", f"主播_{room_id}")
        
        # 添加到配置
        success = self.config.add_streamer(room_id, streamer_name, note)
        
        if success:
            # 初始化状态
            with self._state_lock:
                self._streamer_states[room_id]["is_live"] = (room_info.get("live_status", 0) == 1)
            
            return True, f"成功添加主播: {streamer_name}"
        else:
            return False, f"主播已存在"
    
    def remove_streamer(self, room_id: str) -> bool:
        """删除主播"""
        # 先停止录制
        with self._state_lock:
            if room_id in self._recording_rooms:
                self._stop_recording_if_needed(room_id)
        
        # 从配置中删除
        success = self.config.remove_streamer(room_id)
        
        # 清理状态
        if success:
            with self._state_lock:
                if room_id in self._streamer_states:
                    del self._streamer_states[room_id]
                self._recording_rooms.discard(room_id)
        
        return success
    
    def toggle_monitor_streamer(self, room_id: str, enable: bool = None) -> bool:
        """切换主播监控状态"""
        streamer = self.config.get_streamer(room_id)
        if not streamer:
            return False
        
        if enable is None:
            enable = not streamer.get("is_monitoring", False)
        
        self.config.update_streamer(room_id, {"is_monitoring": enable})
        return True
    
    def get_streamer_status(self, room_id: str) -> Optional[Dict]:
        """获取主播当前状态"""
        with self._state_lock:
            state = self._streamer_states.get(room_id, {})
            is_recording = room_id in self._recording_rooms
        
        streamer = self.config.get_streamer(room_id)
        
        if not streamer:
            return None
        
        return {
            "room_id": room_id,
            "name": streamer.get("name", ""),
            "is_monitoring": streamer.get("is_monitoring", False),
            "is_live": state.get("is_live", False),
            "is_recording": is_recording,
            "last_check_time": state.get("last_check_time"),
            "live_start_time": state.get("live_start_time"),
            "room_info": state.get("last_room_info")
        }
    
    def get_all_streamers_status(self) -> List[Dict]:
        """获取所有主播状态"""
        streamers = self.config.get_streamers()
        result = []
        
        for streamer in streamers:
            room_id = streamer.get("room_id", "")
            status = self.get_streamer_status(room_id)
            if status:
                result.append(status)
        
        return result
    
    def is_streamer_recording(self, room_id: str) -> bool:
        """检查主播是否正在录制"""
        with self._state_lock:
            return room_id in self._recording_rooms
    
    def get_recording_info(self) -> Optional[Dict]:
        """获取当前录制信息"""
        return self.recorder.get_recording_info()
    
    def get_config(self) -> Dict:
        """获取配置"""
        return self.config.get_config()
    
    def update_config(self, key: str, value: Any):
        """更新配置"""
        self.config.update_config(key, value)
        
        # 同步更新通知器设置
        if key == "enable_notification":
            self.notifier.set_notification_enabled(value)
        elif key == "enable_sound":
            self.notifier.set_sound_enabled(value)
        elif key == "ffmpeg_path":
            self.recorder.set_ffmpeg_path(value)
