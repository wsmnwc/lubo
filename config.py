# -*- coding: utf-8 -*-
"""
配置管理模块
管理应用程序的配置、主播列表和录屏历史
"""

import os
import json
import threading
from datetime import datetime
from typing import Dict, List, Optional, Any


class ConfigManager:
    """配置管理器"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls, config_dir: Optional[str] = None):
        """单例模式"""
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self, config_dir: Optional[str] = None):
        if self._initialized:
            return
        
        if config_dir is None:
            # 默认配置目录在用户文档下
            config_dir = os.path.join(os.path.expanduser("~"), "Documents", "BilibiliMonitor")
        
        self.config_dir = config_dir
        self.config_file = os.path.join(config_dir, "config.json")
        self.streamers_file = os.path.join(config_dir, "streamers.json")
        self.history_file = os.path.join(config_dir, "history.json")
        
        # 确保目录存在
        os.makedirs(config_dir, exist_ok=True)
        
        # 默认配置
        self.default_config = {
            "monitor_interval": 10,
            "save_path": os.path.join(os.path.expanduser("~"), "Videos", "BilibiliRecordings"),
            "file_name_format": "{主播名}_{开播时间}",
            "video_quality": "原画",
            "video_format": "mp4",
            "enable_notification": True,
            "enable_sound": True,
            "ffmpeg_path": "",
            "theme": "light"
        }
        
        # 默认质量映射
        self.quality_mapping = {
            "原画": 10000,
            "蓝光8M": 400,
            "蓝光4M": 250,
            "超清": 150,
            "高清": 120,
            "流畅": 80
        }
        
        # 线程锁
        self._file_lock = threading.Lock()
        
        self._initialized = True
        self._load_all()
    
    def _load_all(self):
        """加载所有配置"""
        self.config = self._load_json(self.config_file, self.default_config)
        self.streamers = self._load_json(self.streamers_file, [])
        self.history = self._load_json(self.history_file, [])
        
        # 确保保存目录存在
        save_path = self.config.get("save_path", self.default_config["save_path"])
        os.makedirs(save_path, exist_ok=True)
    
    def _load_json(self, file_path: str, default: Any) -> Any:
        """加载JSON文件"""
        if not os.path.exists(file_path):
            return default
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return default
    
    def _save_json(self, file_path: str, data: Any):
        """保存JSON文件"""
        with self._file_lock:
            try:
                with open(file_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
            except IOError as e:
                print(f"保存配置文件失败: {e}")
    
    def get_config(self, key: str = None, default: Any = None) -> Any:
        """获取配置值"""
        if key is None:
            return self.config.copy()
        return self.config.get(key, default)
    
    def update_config(self, key: str, value: Any):
        """更新配置"""
        self.config[key] = value
        self._save_json(self.config_file, self.config)
    
    def save_config(self):
        """保存配置到文件"""
        self._save_json(self.config_file, self.config)
    
    def get_streamers(self) -> List[Dict]:
        """获取所有主播列表"""
        return self.streamers.copy()
    
    def add_streamer(self, room_id: str, name: str = "", note: str = "") -> bool:
        """
        添加主播
        返回: True=添加成功, False=已存在
        """
        # 检查是否已存在
        for streamer in self.streamers:
            if streamer.get("room_id") == room_id:
                return False
        
        streamer = {
            "room_id": room_id,
            "name": name or f"主播_{room_id}",
            "note": note,
            "is_monitoring": False,
            "is_live": False,
            "last_live_time": "",
            "added_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
        
        self.streamers.append(streamer)
        self._save_json(self.streamers_file, self.streamers)
        return True
    
    def remove_streamer(self, room_id: str) -> bool:
        """删除主播"""
        for i, streamer in enumerate(self.streamers):
            if streamer.get("room_id") == room_id:
                del self.streamers[i]
                self._save_json(self.streamers_file, self.streamers)
                return True
        return False
    
    def update_streamer(self, room_id: str, updates: Dict):
        """更新主播信息"""
        for streamer in self.streamers:
            if streamer.get("room_id") == room_id:
                streamer.update(updates)
                self._save_json(self.streamers_file, self.streamers)
                return True
        return False
    
    def get_streamer(self, room_id: str) -> Optional[Dict]:
        """获取指定主播信息"""
        for streamer in self.streamers:
            if streamer.get("room_id") == room_id:
                return streamer.copy()
        return None
    
    def add_history(self, record: Dict):
        """添加录屏历史"""
        history_record = {
            "id": len(self.history) + 1,
            "room_id": record.get("room_id", ""),
            "streamer_name": record.get("streamer_name", ""),
            "title": record.get("title", ""),
            "start_time": record.get("start_time", datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            "end_time": record.get("end_time", ""),
            "file_path": record.get("file_path", ""),
            "file_size": record.get("file_size", 0),
            "duration": record.get("duration", 0),
            "status": record.get("status", "completed")
        }
        
        self.history.insert(0, history_record)
        
        # 只保留最近100条记录
        if len(self.history) > 100:
            self.history = self.history[:100]
        
        self._save_json(self.history_file, self.history)
        return history_record
    
    def get_history(self) -> List[Dict]:
        """获取录屏历史"""
        return self.history.copy()
    
    def clear_history(self):
        """清空录屏历史"""
        self.history = []
        self._save_json(self.history_file, self.history)
    
    def get_quality_value(self, quality_name: str) -> int:
        """获取画质对应的数值"""
        return self.quality_mapping.get(quality_name, 10000)
    
    def get_quality_list(self) -> List[str]:
        """获取可用画质列表"""
        return list(self.quality_mapping.keys())
