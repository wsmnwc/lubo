# -*- coding: utf-8 -*-
"""
录屏模块
使用FFmpeg下载直播流，实现高质量的直播录制功能
支持后台静默运行，兼容Windows系统
"""

import os
import re
import time
import subprocess
import threading
import shutil
from datetime import datetime
from typing import Optional, Callable, Dict, Any
from pathlib import Path


class StreamRecorder:
    """直播流录制器"""
    
    def __init__(self):
        # 检查FFmpeg是否可用
        self.ffmpeg_path = self._find_ffmpeg()
        
        # 录制状态
        self.is_recording = False
        self.current_room_id = None
        self.current_streamer_name = ""
        self.current_title = ""
        self.start_time = None
        
        # 录制进程
        self.recording_process = None
        self.monitor_thread = None
        self._stop_event = threading.Event()
        
        # 回调函数
        self.on_start = None  # 开始录制回调
        self.on_stop = None   # 停止录制回调
        self.on_error = None  # 错误回调
        self.on_progress = None  # 进度回调
        
        # 输出文件信息
        self.output_file = ""
        self.temp_file = ""
    
    def _find_ffmpeg(self) -> str:
        """查找FFmpeg可执行文件路径"""
        # 1. 检查环境变量中的ffmpeg
        ffmpeg_path = shutil.which("ffmpeg")
        if ffmpeg_path:
            return ffmpeg_path
        
        # 2. 检查常用安装路径
        common_paths = [
            os.path.join(os.environ.get("PROGRAMFILES", ""), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.environ.get("PROGRAMFILES(X86)", ""), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.path.expanduser("~"), "ffmpeg", "bin", "ffmpeg.exe"),
            os.path.join(os.getcwd(), "ffmpeg", "bin", "ffmpeg.exe")
        ]
        
        for path in common_paths:
            if os.path.exists(path):
                return path
        
        return ""
    
    def check_ffmpeg_available(self) -> bool:
        """检查FFmpeg是否可用"""
        if not self.ffmpeg_path:
            return False
        
        try:
            result = subprocess.run(
                [self.ffmpeg_path, "-version"],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except:
            return False
    
    def set_ffmpeg_path(self, path: str):
        """手动设置FFmpeg路径"""
        self.ffmpeg_path = path
    
    def _sanitize_filename(self, filename: str) -> str:
        """清理文件名中的非法字符"""
        # 移除Windows文件名中不允许的字符
        invalid_chars = r'[<>:"/\\|?*]'
        sanitized = re.sub(invalid_chars, "_", filename)
        # 移除首尾空格
        sanitized = sanitized.strip()
        # 限制文件名长度
        if len(sanitized) > 100:
            sanitized = sanitized[:100]
        return sanitized
    
    def _generate_filename(self, streamer_name: str, title: str, format_str: str = None) -> str:
        """
        生成输出文件名
        格式: 主播名_开播时间_标题
        """
        now = datetime.now()
        time_str = now.strftime("%Y%m%d_%H%M%S")
        
        # 清理输入字符串
        streamer_name = self._sanitize_filename(streamer_name or "未知主播")
        title = self._sanitize_filename(title or "")
        
        # 默认格式
        if not format_str:
            format_str = "{主播名}_{开播时间}"
        
        # 替换占位符
        filename = format_str
        filename = filename.replace("{主播名}", streamer_name)
        filename = filename.replace("{开播时间}", time_str)
        filename = filename.replace("{标题}", title[:30] if title else "")
        
        # 确保文件名不为空
        if not filename or filename == "_":
            filename = f"录制_{time_str}"
        
        return filename
    
    def start_recording(
        self,
        stream_url: str,
        room_id: str,
        streamer_name: str = "",
        title: str = "",
        save_path: str = "",
        file_format: str = "mp4",
        file_name_format: str = None
    ) -> bool:
        """
        开始录制直播流
        参数:
            stream_url: 直播流地址
            room_id: 直播间ID
            streamer_name: 主播名称
            title: 直播间标题
            save_path: 保存目录
            file_format: 文件格式 (mp4, flv, mkv等)
            file_name_format: 文件名格式模板
        返回:
            是否成功启动录制
        """
        if self.is_recording:
            print("已有录制任务正在进行")
            return False
        
        if not self.check_ffmpeg_available():
            error_msg = "FFmpeg未安装或未配置到环境变量，请先安装FFmpeg"
            print(error_msg)
            if self.on_error:
                self.on_error(error_msg)
            return False
        
        # 确保保存目录存在
        if not save_path:
            save_path = os.path.join(os.path.expanduser("~"), "Videos", "BilibiliRecordings")
        
        os.makedirs(save_path, exist_ok=True)
        
        # 生成文件名
        base_filename = self._generate_filename(streamer_name, title, file_name_format)
        output_filename = f"{base_filename}.{file_format.lower()}"
        self.output_file = os.path.join(save_path, output_filename)
        
        # 临时文件（防止文件损坏）
        self.temp_file = self.output_file + ".tmp"
        
        # 记录当前录制信息
        self.current_room_id = room_id
        self.current_streamer_name = streamer_name
        self.current_title = title
        self.start_time = datetime.now()
        self._stop_event.clear()
        
        # 构建FFmpeg命令
        ffmpeg_cmd = self._build_ffmpeg_command(stream_url, self.temp_file, file_format)
        
        print(f"开始录制: {streamer_name} - {title}")
        print(f"保存到: {self.output_file}")
        print(f"FFmpeg命令: {' '.join(ffmpeg_cmd)}")
        
        try:
            # 启动FFmpeg进程
            # 使用CREATE_NO_WINDOW标志在Windows上不显示窗口
            startupinfo = None
            if os.name == 'nt':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
            
            self.recording_process = subprocess.Popen(
                ffmpeg_cmd,
                startupinfo=startupinfo,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            
            self.is_recording = True
            
            # 启动监控线程
            self.monitor_thread = threading.Thread(
                target=self._monitor_recording,
                daemon=True
            )
            self.monitor_thread.start()
            
            # 触发开始回调
            if self.on_start:
                self.on_start({
                    "room_id": room_id,
                    "streamer_name": streamer_name,
                    "title": title,
                    "output_file": self.output_file,
                    "start_time": self.start_time.strftime("%Y-%m-%d %H:%M:%S")
                })
            
            return True
            
        except Exception as e:
            error_msg = f"启动录制失败: {e}"
            print(error_msg)
            self.is_recording = False
            if self.on_error:
                self.on_error(error_msg)
            return False
    
    def _build_ffmpeg_command(self, stream_url: str, output_file: str, format: str) -> list:
        """
        构建FFmpeg命令
        使用流式复制模式，不进行重新编码，速度快且质量无损
        """
        cmd = [
            self.ffmpeg_path,
            "-y",  # 覆盖已存在的文件
            "-i", stream_url,  # 输入流
            "-c", "copy",  # 复制流，不重新编码
            "-bsf:a", "aac_adtstoasc",  # 修复FLV转MP4时的音频问题
            "-f", format,  # 输出格式
            output_file
        ]
        
        # 添加额外的参数以提高稳定性
        extra_args = [
            "-reconnect", "1",  # 自动重连
            "-reconnect_streamed", "1",
            "-reconnect_delay_max", "5",
            "-timeout", "60000000",  # 超时时间(微秒)
            "-rw_timeout", "60000000",
            "-loglevel", "warning"  # 只显示警告和错误
        ]
        
        # 将额外参数插入到输入之前
        cmd[2:2] = extra_args
        
        return cmd
    
    def _monitor_recording(self):
        """监控录制进程"""
        while self.is_recording and not self._stop_event.is_set():
            try:
                # 检查进程是否还在运行
                if self.recording_process and self.recording_process.poll() is not None:
                    # 进程已结束
                    returncode = self.recording_process.returncode
                    if returncode != 0 and not self._stop_event.is_set():
                        # 异常结束
                        print(f"录制进程异常退出，返回码: {returncode}")
                        if self.on_error:
                            stderr = self.recording_process.stderr.read() if self.recording_process.stderr else ""
                            self.on_error(f"录制异常退出: {stderr}")
                    break
                
                # 更新进度
                if self.on_progress and os.path.exists(self.temp_file):
                    try:
                        file_size = os.path.getsize(self.temp_file)
                        duration = (datetime.now() - self.start_time).total_seconds()
                        self.on_progress({
                            "file_size": file_size,
                            "duration": duration,
                            "room_id": self.current_room_id
                        })
                    except:
                        pass
                
                time.sleep(2)
                
            except Exception as e:
                print(f"监控录制时出错: {e}")
                time.sleep(1)
        
        # 录制结束后的清理工作
        self._finalize_recording()
    
    def _finalize_recording(self):
        """完成录制，将临时文件重命名为正式文件"""
        try:
            # 等待进程完全结束
            if self.recording_process:
                try:
                    self.recording_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    # 强制终止
                    self.recording_process.kill()
                    self.recording_process.wait(timeout=5)
            
            # 重命名临时文件
            if os.path.exists(self.temp_file):
                # 检查文件大小
                file_size = os.path.getsize(self.temp_file)
                if file_size > 0:
                    # 如果目标文件已存在，添加序号
                    final_file = self.output_file
                    counter = 1
                    while os.path.exists(final_file):
                        name, ext = os.path.splitext(self.output_file)
                        final_file = f"{name}_{counter}{ext}"
                        counter += 1
                    
                    os.rename(self.temp_file, final_file)
                    self.output_file = final_file
                    print(f"录制完成，文件已保存: {final_file}")
                else:
                    # 文件为空，删除
                    os.remove(self.temp_file)
                    print("录制文件为空，已删除")
            
            # 计算录制时长
            end_time = datetime.now()
            duration = 0
            if self.start_time:
                duration = (end_time - self.start_time).total_seconds()
            
            # 触发停止回调
            if self.on_stop:
                self.on_stop({
                    "room_id": self.current_room_id,
                    "streamer_name": self.current_streamer_name,
                    "title": self.current_title,
                    "output_file": self.output_file if os.path.exists(self.output_file) else "",
                    "file_size": os.path.getsize(self.output_file) if os.path.exists(self.output_file) else 0,
                    "duration": duration,
                    "start_time": self.start_time.strftime("%Y-%m-%d %H:%M:%S") if self.start_time else "",
                    "end_time": end_time.strftime("%Y-%m-%d %H:%M:%S")
                })
            
        except Exception as e:
            print(f"完成录制时出错: {e}")
            if self.on_error:
                self.on_error(f"完成录制时出错: {e}")
        finally:
            # 重置状态
            self.is_recording = False
            self.recording_process = None
    
    def stop_recording(self) -> bool:
        """
        停止录制
        优雅地停止FFmpeg进程
        """
        if not self.is_recording:
            return True
        
        print("正在停止录制...")
        self._stop_event.set()
        
        try:
            if self.recording_process and self.recording_process.poll() is None:
                # 发送q命令让FFmpeg优雅退出
                try:
                    self.recording_process.stdin.write(b'q\n')
                    self.recording_process.stdin.flush()
                except:
                    pass
                
                # 等待进程结束
                try:
                    self.recording_process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    # 强制终止
                    self.recording_process.kill()
                    try:
                        self.recording_process.wait(timeout=5)
                    except:
                        pass
            
            # 等待监控线程结束
            if self.monitor_thread and self.monitor_thread.is_alive():
                self.monitor_thread.join(timeout=15)
            
            return True
            
        except Exception as e:
            print(f"停止录制时出错: {e}")
            # 强制重置状态
            self.is_recording = False
            return False
    
    def get_recording_info(self) -> Optional[Dict[str, Any]]:
        """获取当前录制信息"""
        if not self.is_recording:
            return None
        
        duration = 0
        if self.start_time:
            duration = (datetime.now() - self.start_time).total_seconds()
        
        file_size = 0
        if os.path.exists(self.temp_file):
            file_size = os.path.getsize(self.temp_file)
        
        return {
            "room_id": self.current_room_id,
            "streamer_name": self.current_streamer_name,
            "title": self.current_title,
            "output_file": self.output_file,
            "temp_file": self.temp_file,
            "start_time": self.start_time.strftime("%Y-%m-%d %H:%M:%S") if self.start_time else "",
            "duration": duration,
            "file_size": file_size
        }
