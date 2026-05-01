# -*- coding: utf-8 -*-
"""
B站直播间监控模块
负责获取直播间状态、主播信息和直播流地址
"""

import re
import time
import threading
from typing import Dict, Optional, Tuple
from datetime import datetime

import requests


class BilibiliMonitor:
    """B站直播间监控器"""
    
    def __init__(self):
        # B站API接口
        self.api_room_init = "https://api.live.bilibili.com/room/v1/Room/room_init"
        self.api_room_info = "https://api.live.bilibili.com/room/v1/Room/get_info"
        self.api_room_play_info = "https://api.live.bilibili.com/room/v1/Room/playUrl"
        self.api_user_info = "https://api.live.bilibili.com/live_user/v1/Master/info"
        self.api_room_status = "https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids"
        
        # 模拟浏览器请求头
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://live.bilibili.com/"
        }
        
        # 请求会话
        self.session = requests.Session()
        self.session.headers.update(self.headers)
    
    def extract_room_id(self, input_str: str) -> Optional[str]:
        """
        从输入字符串中提取直播间ID
        支持以下格式：
        - 纯数字ID: 123456
        - 直播间链接: https://live.bilibili.com/123456
        - 短链接: https://b23.tv/xxxxx
        - 主播主页: https://space.bilibili.com/123456
        """
        input_str = input_str.strip()
        
        # 1. 检查是否是纯数字ID
        if input_str.isdigit():
            return input_str
        
        # 2. 检查是否是直播间链接
        live_pattern = r"live\.bilibili\.com/(\d+)"
        match = re.search(live_pattern, input_str)
        if match:
            return match.group(1)
        
        # 3. 检查是否是B站空间链接
        space_pattern = r"space\.bilibili\.com/(\d+)"
        match = re.search(space_pattern, input_str)
        if match:
            # 获取用户的直播间ID
            uid = match.group(1)
            return self._get_room_id_from_uid(uid)
        
        # 4. 检查是否是短链接（需要跳转）
        short_pattern = r"b23\.tv/\w+"
        if re.search(short_pattern, input_str):
            return self._resolve_short_link(input_str)
        
        return None
    
    def _get_room_id_from_uid(self, uid: str) -> Optional[str]:
        """根据用户UID获取直播间ID"""
        try:
            params = {
                "uid": uid
            }
            response = self.session.get(
                self.api_user_info,
                params=params,
                timeout=10
            )
            data = response.json()
            
            if data.get("code") == 0:
                room_info = data.get("data", {}).get("room_id", 0)
                if room_info:
                    return str(room_info)
        except Exception as e:
            print(f"获取用户直播间ID失败: {e}")
        
        return None
    
    def _resolve_short_link(self, short_url: str) -> Optional[str]:
        """解析短链接获取直播间ID"""
        try:
            # 确保URL完整
            if not short_url.startswith("http"):
                short_url = "https://" + short_url
            
            # 获取重定向后的URL
            response = self.session.head(
                short_url,
                allow_redirects=True,
                timeout=10
            )
            final_url = response.url
            
            # 从最终URL中提取直播间ID
            return self.extract_room_id(final_url)
        except Exception as e:
            print(f"解析短链接失败: {e}")
        
        return None
    
    def get_room_info(self, room_id: str) -> Optional[Dict]:
        """
        获取直播间详细信息
        返回包含以下字段的字典：
        - room_id: 直播间ID
        - uid: 主播UID
        - uname: 主播名称
        - title: 直播间标题
        - live_status: 直播状态 (1=直播中, 2=轮播, 0=未开播)
        - live_time: 开播时间
        - area_name: 分区名称
        - parent_area_name: 父分区名称
        - cover: 封面图片URL
        """
        try:
            # 第一步：获取房间基础信息
            params_init = {
                "id": room_id
            }
            response_init = self.session.get(
                self.api_room_init,
                params=params_init,
                timeout=10
            )
            data_init = response_init.json()
            
            if data_init.get("code") != 0:
                print(f"获取房间基础信息失败: {data_init.get('message', '未知错误')}")
                return None
            
            room_data = data_init.get("data", {})
            real_room_id = room_data.get("room_id", room_id)
            uid = room_data.get("uid", 0)
            
            # 第二步：获取房间详细信息
            params_info = {
                "room_id": real_room_id
            }
            response_info = self.session.get(
                self.api_room_info,
                params=params_info,
                timeout=10
            )
            data_info = response_info.json()
            
            info_data = data_info.get("data", {}) if data_info.get("code") == 0 else {}
            
            # 第三步：获取主播信息
            uname = ""
            try:
                params_user = {
                    "uid": uid
                }
                response_user = self.session.get(
                    self.api_user_info,
                    params=params_user,
                    timeout=10
                )
                data_user = response_user.json()
                if data_user.get("code") == 0:
                    uname = data_user.get("data", {}).get("info", {}).get("uname", "")
            except:
                pass
            
            # 整合信息
            result = {
                "room_id": str(real_room_id),
                "uid": uid,
                "uname": uname or info_data.get("uname", f"主播_{real_room_id}"),
                "title": info_data.get("title", ""),
                "live_status": room_data.get("live_status", 0),
                "live_time": info_data.get("live_time", ""),
                "area_name": info_data.get("area_name", ""),
                "parent_area_name": info_data.get("parent_area_name", ""),
                "cover": info_data.get("user_cover", ""),
                "description": info_data.get("description", "")
            }
            
            return result
            
        except requests.exceptions.RequestException as e:
            print(f"网络请求失败: {e}")
            return None
        except Exception as e:
            print(f"获取直播间信息失败: {e}")
            return None
    
    def check_live_status(self, room_id: str) -> Tuple[bool, str, Optional[Dict]]:
        """
        检查直播间是否正在直播
        返回: (是否开播, 状态描述, 房间信息字典)
        """
        room_info = self.get_room_info(room_id)
        
        if not room_info:
            return False, "获取信息失败", None
        
        live_status = room_info.get("live_status", 0)
        
        if live_status == 1:
            return True, "直播中", room_info
        elif live_status == 2:
            return False, "轮播中", room_info
        else:
            return False, "未开播", room_info
    
    def get_live_stream_url(self, room_id: str, quality: int = 10000, platform: str = "web") -> Optional[Dict]:
        """
        获取直播流地址
        参数:
            room_id: 直播间ID
            quality: 画质 (10000=原画, 400=蓝光8M, 250=蓝光4M, 150=超清, 120=高清, 80=流畅)
            platform: 平台 (web=网页端)
        返回:
            包含直播流地址的字典，失败返回None
        """
        try:
            params = {
                "cid": room_id,
                "qn": quality,
                "platform": platform,
                "https_url_req": 1,
                "ptype": 16
            }
            
            response = self.session.get(
                self.api_room_play_info,
                params=params,
                timeout=15
            )
            data = response.json()
            
            if data.get("code") != 0:
                print(f"获取直播流地址失败: {data.get('message', '未知错误')}")
                return None
            
            stream_data = data.get("data", {})
            
            # 获取当前使用的画质
            current_qn = stream_data.get("current_qn", quality)
            
            # 获取直播流地址
            durl = stream_data.get("durl", [])
            if not durl:
                print("未找到直播流地址")
                return None
            
            # 通常第一个地址是可用的
            stream_info = durl[0]
            
            result = {
                "room_id": room_id,
                "quality": current_qn,
                "quality_name": self._get_quality_name(current_qn),
                "stream_url": stream_info.get("url", ""),
                "stream_host": stream_info.get("host", ""),
                "stream_extra": stream_info.get("extra", ""),
                "stream_type": stream_info.get("stream_type", ""),
                "length": stream_info.get("length", 0),
                "order": stream_info.get("order", 1),
                "all_qualities": stream_data.get("quality_description", [])
            }
            
            return result
            
        except requests.exceptions.RequestException as e:
            print(f"网络请求失败: {e}")
            return None
        except Exception as e:
            print(f"获取直播流地址失败: {e}")
            return None
    
    def _get_quality_name(self, qn: int) -> str:
        """根据画质代码获取画质名称"""
        quality_map = {
            10000: "原画",
            400: "蓝光8M",
            250: "蓝光4M",
            150: "超清",
            120: "高清",
            80: "流畅"
        }
        return quality_map.get(qn, f"未知({qn})")
    
    def verify_room_exists(self, room_id: str) -> Tuple[bool, str]:
        """
        验证直播间是否存在
        返回: (是否存在, 错误信息)
        """
        try:
            params = {
                "id": room_id
            }
            response = self.session.get(
                self.api_room_init,
                params=params,
                timeout=10
            )
            data = response.json()
            
            if data.get("code") == 0:
                return True, ""
            else:
                return False, data.get("message", "直播间不存在")
        except Exception as e:
            return False, f"验证失败: {str(e)}"
