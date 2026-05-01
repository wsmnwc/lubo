# -*- coding: utf-8 -*-
"""
GUI界面模块
使用tkinter实现美观的用户界面
包含主窗口、主播列表、配置面板、录屏历史等功能
"""

import os
import sys
import tkinter as tk
from tkinter import ttk, messagebox, filedialog
from typing import Dict, List, Optional, Any
from datetime import datetime
from pathlib import Path

from monitor_core import MonitorCore
from config import ConfigManager


class BilibiliMonitorApp:
    """B站直播间监控应用主窗口"""
    
    def __init__(self):
        # 初始化核心模块
        self.core = MonitorCore()
        
        # 创建主窗口
        self.root = tk.Tk()
        self.root.title("B站直播间监控录屏工具")
        self.root.geometry("900x700")
        self.root.minsize(800, 600)
        
        # 设置主题
        self._setup_theme()
        
        # 创建界面
        self._create_menu()
        self._create_notebook()
        self._create_status_bar()
        
        # 绑定事件
        self._bind_events()
        
        # 初始化数据
        self._refresh_streamer_list()
        self._refresh_history()
        self._load_config_to_ui()
        
        # 启动UI更新定时器
        self._ui_update_id = None
        self._schedule_ui_update()
    
    def _setup_theme(self):
        """设置主题和样式"""
        # 设置ttk样式
        self.style = ttk.Style()
        
        # 尝试使用clam主题（在Windows上效果较好）
        available_themes = self.style.theme_names()
        if 'clam' in available_themes:
            self.style.theme_use('clam')
        
        # 配置颜色
        self.colors = {
            'bg': '#f5f5f5',
            'bg_dark': '#2c3e50',
            'bg_light': '#ecf0f1',
            'text': '#2c3e50',
            'text_light': '#7f8c8d',
            'accent': '#3498db',
            'success': '#27ae60',
            'warning': '#f39c12',
            'danger': '#e74c3c',
            'live': '#ff6b6b',
            'recording': '#e74c3c'
        }
        
        # 配置样式
        self.style.configure(
            'Title.TLabel',
            font=('Microsoft YaHei UI', 14, 'bold'),
            foreground=self.colors['accent']
        )
        
        self.style.configure(
            'Status.TLabel',
            font=('Microsoft YaHei UI', 9),
            foreground=self.colors['text_light']
        )
        
        self.style.configure(
            'Live.TLabel',
            foreground=self.colors['live'],
            font=('Microsoft YaHei UI', 9, 'bold')
        )
        
        self.style.configure(
            'Offline.TLabel',
            foreground=self.colors['text_light'],
            font=('Microsoft YaHei UI', 9)
        )
        
        self.style.configure(
            'Recording.TLabel',
            foreground=self.colors['recording'],
            font=('Microsoft YaHei UI', 9, 'bold')
        )
        
        # 配置Treeview样式
        self.style.configure(
            'Treeview',
            font=('Microsoft YaHei UI', 10),
            rowheight=25
        )
        
        self.style.configure(
            'Treeview.Heading',
            font=('Microsoft YaHei UI', 10, 'bold')
        )
        
        # 设置窗口背景色
        self.root.configure(bg=self.colors['bg'])
    
    def _create_menu(self):
        """创建菜单栏"""
        self.menu_bar = tk.Menu(self.root)
        
        # 文件菜单
        self.file_menu = tk.Menu(self.menu_bar, tearoff=0)
        self.file_menu.add_command(label="打开保存目录", command=self._open_save_directory)
        self.file_menu.add_separator()
        self.file_menu.add_command(label="退出", command=self._on_exit)
        self.menu_bar.add_cascade(label="文件", menu=self.file_menu)
        
        # 设置菜单
        self.settings_menu = tk.Menu(self.menu_bar, tearoff=0)
        self.settings_menu.add_command(label="配置FFmpeg路径", command=self._configure_ffmpeg)
        self.settings_menu.add_command(label="测试通知", command=self._test_notification)
        self.menu_bar.add_cascade(label="设置", menu=self.settings_menu)
        
        # 帮助菜单
        self.help_menu = tk.Menu(self.menu_bar, tearoff=0)
        self.help_menu.add_command(label="使用说明", command=self._show_help)
        self.help_menu.add_command(label="关于", command=self._show_about)
        self.menu_bar.add_cascade(label="帮助", menu=self.help_menu)
        
        self.root.config(menu=self.menu_bar)
    
    def _create_notebook(self):
        """创建选项卡"""
        self.notebook = ttk.Notebook(self.root)
        self.notebook.pack(fill=tk.BOTH, expand=True, padx=5, pady=5)
        
        # 创建各个选项卡
        self._create_monitor_tab()
        self._create_settings_tab()
        self._create_history_tab()
    
    def _create_monitor_tab(self):
        """创建监控选项卡"""
        self.monitor_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.monitor_frame, text="  直播监控  ", padding=5)
        
        # 上部分：添加主播区域
        self._create_add_streamer_section()
        
        # 中间：监控控制按钮
        self._create_control_section()
        
        # 下部分：主播列表
        self._create_streamer_list_section()
    
    def _create_add_streamer_section(self):
        """创建添加主播区域"""
        add_frame = ttk.LabelFrame(self.monitor_frame, text=" 添加主播 ", padding=10)
        add_frame.pack(fill=tk.X, pady=5)
        
        # 输入行
        input_frame = ttk.Frame(add_frame)
        input_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(input_frame, text="直播间ID/链接:").pack(side=tk.LEFT, padx=5)
        
        self.add_streamer_entry = ttk.Entry(input_frame, width=50)
        self.add_streamer_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        ttk.Label(input_frame, text="备注:").pack(side=tk.LEFT, padx=5)
        
        self.add_note_entry = ttk.Entry(input_frame, width=15)
        self.add_note_entry.pack(side=tk.LEFT, padx=5)
        
        self.add_button = ttk.Button(
            input_frame,
            text="添加",
            command=self._add_streamer,
            width=10
        )
        self.add_button.pack(side=tk.LEFT, padx=10)
        
        # 提示文本
        hint_text = "支持输入：纯数字ID、直播间链接(https://live.bilibili.com/123)、主播主页链接"
        hint_label = ttk.Label(
            add_frame,
            text=hint_text,
            foreground=self.colors['text_light']
        )
        hint_label.pack(side=tk.LEFT, padx=5)
    
    def _create_control_section(self):
        """创建控制按钮区域"""
        control_frame = ttk.Frame(self.monitor_frame)
        control_frame.pack(fill=tk.X, pady=10)
        
        # 左侧：监控控制
        left_frame = ttk.Frame(control_frame)
        left_frame.pack(side=tk.LEFT)
        
        self.start_monitor_button = ttk.Button(
            left_frame,
            text="▶ 开始监控",
            command=self._toggle_monitor,
            width=15
        )
        self.start_monitor_button.pack(side=tk.LEFT, padx=5)
        
        # 中间：状态显示
        middle_frame = ttk.Frame(control_frame)
        middle_frame.pack(side=tk.LEFT, expand=True)
        
        self.monitor_status_label = ttk.Label(
            middle_frame,
            text="监控状态: 未启动",
            style='Status.TLabel'
        )
        self.monitor_status_label.pack(side=tk.LEFT)
        
        self.recording_status_label = ttk.Label(
            middle_frame,
            text="",
            style='Status.TLabel'
        )
        self.recording_status_label.pack(side=tk.LEFT, padx=20)
        
        # 右侧：刷新按钮
        right_frame = ttk.Frame(control_frame)
        right_frame.pack(side=tk.RIGHT)
        
        self.refresh_button = ttk.Button(
            right_frame,
            text="刷新列表",
            command=self._refresh_streamer_list,
            width=10
        )
        self.refresh_button.pack(side=tk.LEFT, padx=5)
    
    def _create_streamer_list_section(self):
        """创建主播列表区域"""
        list_frame = ttk.LabelFrame(self.monitor_frame, text=" 监控主播列表 ", padding=5)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        
        # 创建表格
        columns = ('room_id', 'name', 'status', 'is_monitoring', 'note', 'last_live_time')
        self.streamer_tree = ttk.Treeview(
            list_frame,
            columns=columns,
            show='headings',
            selectmode='browse'
        )
        
        # 设置列
        self.streamer_tree.heading('room_id', text='直播间ID')
        self.streamer_tree.heading('name', text='主播名称')
        self.streamer_tree.heading('status', text='状态')
        self.streamer_tree.heading('is_monitoring', text='监控中')
        self.streamer_tree.heading('note', text='备注')
        self.streamer_tree.heading('last_live_time', text='最后直播时间')
        
        # 设置列宽
        self.streamer_tree.column('room_id', width=100, anchor=tk.CENTER)
        self.streamer_tree.column('name', width=150, anchor=tk.W)
        self.streamer_tree.column('status', width=100, anchor=tk.CENTER)
        self.streamer_tree.column('is_monitoring', width=80, anchor=tk.CENTER)
        self.streamer_tree.column('note', width=100, anchor=tk.W)
        self.streamer_tree.column('last_live_time', width=150, anchor=tk.CENTER)
        
        # 添加滚动条
        scrollbar_y = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.streamer_tree.yview)
        scrollbar_x = ttk.Scrollbar(list_frame, orient=tk.HORIZONTAL, command=self.streamer_tree.xview)
        self.streamer_tree.configure(yscrollcommand=scrollbar_y.set, xscrollcommand=scrollbar_x.set)
        
        # 布局
        self.streamer_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar_y.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 右键菜单
        self._create_streamer_context_menu()
        
        # 绑定双击事件
        self.streamer_tree.bind('<Double-1>', self._on_streamer_double_click)
    
    def _create_streamer_context_menu(self):
        """创建主播列表右键菜单"""
        self.streamer_menu = tk.Menu(self.root, tearoff=0)
        self.streamer_menu.add_command(label="开启监控", command=lambda: self._toggle_streamer_monitor(True))
        self.streamer_menu.add_command(label="关闭监控", command=lambda: self._toggle_streamer_monitor(False))
        self.streamer_menu.add_separator()
        self.streamer_menu.add_command(label="打开直播间", command=self._open_streamer_room)
        self.streamer_menu.add_separator()
        self.streamer_menu.add_command(label="删除主播", command=self._delete_streamer)
        
        self.streamer_tree.bind('<Button-3>', self._show_streamer_menu)
    
    def _show_streamer_menu(self, event):
        """显示右键菜单"""
        item = self.streamer_tree.identify_row(event.y)
        if item:
            self.streamer_tree.selection_set(item)
            self.streamer_menu.tk_popup(event.x_root, event.y_root)
    
    def _create_settings_tab(self):
        """创建设置选项卡"""
        self.settings_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.settings_frame, text="  设置  ", padding=10)
        
        # 监控设置
        self._create_monitor_settings()
        
        # 录屏设置
        self._create_recording_settings()
        
        # 通知设置
        self._create_notification_settings()
        
        # 保存按钮
        save_frame = ttk.Frame(self.settings_frame)
        save_frame.pack(fill=tk.X, pady=20)
        
        self.save_settings_button = ttk.Button(
            save_frame,
            text="保存设置",
            command=self._save_settings,
            width=15
        )
        self.save_settings_button.pack(pady=10)
    
    def _create_monitor_settings(self):
        """创建监控设置"""
        frame = ttk.LabelFrame(self.settings_frame, text=" 监控设置 ", padding=10)
        frame.pack(fill=tk.X, pady=5)
        
        # 监控间隔
        interval_frame = ttk.Frame(frame)
        interval_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(interval_frame, text="监控间隔 (秒):").pack(side=tk.LEFT, padx=5)
        
        self.interval_var = tk.StringVar(value="10")
        self.interval_spinbox = ttk.Spinbox(
            interval_frame,
            from_=5,
            to=300,
            textvariable=self.interval_var,
            width=10
        )
        self.interval_spinbox.pack(side=tk.LEFT, padx=5)
        
        ttk.Label(
            interval_frame,
            text="(推荐 10-30 秒)",
            foreground=self.colors['text_light']
        ).pack(side=tk.LEFT, padx=5)
    
    def _create_recording_settings(self):
        """创建录屏设置"""
        frame = ttk.LabelFrame(self.settings_frame, text=" 录屏设置 ", padding=10)
        frame.pack(fill=tk.X, pady=5)
        
        # 保存路径
        path_frame = ttk.Frame(frame)
        path_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(path_frame, text="保存路径:").pack(side=tk.LEFT, padx=5)
        
        self.save_path_var = tk.StringVar()
        self.save_path_entry = ttk.Entry(path_frame, textvariable=self.save_path_var, width=60)
        self.save_path_entry.pack(side=tk.LEFT, padx=5, fill=tk.X, expand=True)
        
        self.browse_path_button = ttk.Button(
            path_frame,
            text="浏览...",
            command=self._browse_save_path,
            width=8
        )
        self.browse_path_button.pack(side=tk.LEFT, padx=5)
        
        # 文件名格式
        name_frame = ttk.Frame(frame)
        name_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(name_frame, text="文件名格式:").pack(side=tk.LEFT, padx=5)
        
        self.file_name_var = tk.StringVar(value="{主播名}_{开播时间}")
        self.file_name_entry = ttk.Entry(name_frame, textvariable=self.file_name_var, width=40)
        self.file_name_entry.pack(side=tk.LEFT, padx=5)
        
        name_hint = ttk.Label(
            name_frame,
            text="可用变量: {主播名} {开播时间} {标题}",
            foreground=self.colors['text_light']
        )
        name_hint.pack(side=tk.LEFT, padx=5)
        
        # 画质选择
        quality_frame = ttk.Frame(frame)
        quality_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(quality_frame, text="录屏画质:").pack(side=tk.LEFT, padx=5)
        
        self.quality_var = tk.StringVar(value="原画")
        qualities = self.core.config.get_quality_list()
        self.quality_combo = ttk.Combobox(
            quality_frame,
            textvariable=self.quality_var,
            values=qualities,
            state='readonly',
            width=15
        )
        self.quality_combo.pack(side=tk.LEFT, padx=5)
        
        # 格式选择
        format_frame = ttk.Frame(frame)
        format_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(format_frame, text="视频格式:").pack(side=tk.LEFT, padx=5)
        
        self.format_var = tk.StringVar(value="mp4")
        formats = ["mp4", "flv", "mkv", "mov"]
        self.format_combo = ttk.Combobox(
            format_frame,
            textvariable=self.format_var,
            values=formats,
            state='readonly',
            width=10
        )
        self.format_combo.pack(side=tk.LEFT, padx=5)
        
        # FFmpeg路径
        ffmpeg_frame = ttk.Frame(frame)
        ffmpeg_frame.pack(fill=tk.X, pady=5)
        
        ttk.Label(ffmpeg_frame, text="FFmpeg路径:").pack(side=tk.LEFT, padx=5)
        
        self.ffmpeg_path_var = tk.StringVar()
        self.ffmpeg_path_entry = ttk.Entry(ffmpeg_frame, textvariable=self.ffmpeg_path_var, width=50)
        self.ffmpeg_path_entry.pack(side=tk.LEFT, padx=5)
        
        self.browse_ffmpeg_button = ttk.Button(
            ffmpeg_frame,
            text="浏览...",
            command=self._browse_ffmpeg_path,
            width=8
        )
        self.browse_ffmpeg_button.pack(side=tk.LEFT, padx=5)
        
        # 检查FFmpeg状态
        ffmpeg_status_frame = ttk.Frame(frame)
        ffmpeg_status_frame.pack(fill=tk.X, pady=5)
        
        self.ffmpeg_status_label = ttk.Label(
            ffmpeg_status_frame,
            text="",
            foreground=self.colors['text_light']
        )
        self.ffmpeg_status_label.pack(side=tk.LEFT, padx=5)
    
    def _create_notification_settings(self):
        """创建通知设置"""
        frame = ttk.LabelFrame(self.settings_frame, text=" 通知设置 ", padding=10)
        frame.pack(fill=tk.X, pady=5)
        
        # 桌面通知
        self.enable_notification_var = tk.BooleanVar(value=True)
        self.enable_notification_check = ttk.Checkbutton(
            frame,
            text="启用桌面弹窗通知",
            variable=self.enable_notification_var
        )
        self.enable_notification_check.pack(anchor=tk.W, pady=5)
        
        # 提示音
        self.enable_sound_var = tk.BooleanVar(value=True)
        self.enable_sound_check = ttk.Checkbutton(
            frame,
            text="启用开播提示音",
            variable=self.enable_sound_var
        )
        self.enable_sound_check.pack(anchor=tk.W, pady=5)
    
    def _create_history_tab(self):
        """创建录屏历史选项卡"""
        self.history_frame = ttk.Frame(self.notebook)
        self.notebook.add(self.history_frame, text="  录屏历史  ", padding=5)
        
        # 工具栏
        toolbar_frame = ttk.Frame(self.history_frame)
        toolbar_frame.pack(fill=tk.X, pady=5)
        
        self.refresh_history_button = ttk.Button(
            toolbar_frame,
            text="刷新",
            command=self._refresh_history,
            width=10
        )
        self.refresh_history_button.pack(side=tk.LEFT, padx=5)
        
        self.clear_history_button = ttk.Button(
            toolbar_frame,
            text="清空历史",
            command=self._clear_history,
            width=10
        )
        self.clear_history_button.pack(side=tk.LEFT, padx=5)
        
        # 历史列表
        list_frame = ttk.Frame(self.history_frame)
        list_frame.pack(fill=tk.BOTH, expand=True, pady=5)
        
        columns = ('streamer_name', 'title', 'start_time', 'end_time', 'duration', 'file_size', 'file_path')
        self.history_tree = ttk.Treeview(
            list_frame,
            columns=columns,
            show='headings',
            selectmode='browse'
        )
        
        # 设置列
        self.history_tree.heading('streamer_name', text='主播')
        self.history_tree.heading('title', text='标题')
        self.history_tree.heading('start_time', text='开始时间')
        self.history_tree.heading('end_time', text='结束时间')
        self.history_tree.heading('duration', text='时长')
        self.history_tree.heading('file_size', text='大小')
        self.history_tree.heading('file_path', text='文件路径')
        
        # 设置列宽
        self.history_tree.column('streamer_name', width=100, anchor=tk.W)
        self.history_tree.column('title', width=150, anchor=tk.W)
        self.history_tree.column('start_time', width=130, anchor=tk.CENTER)
        self.history_tree.column('end_time', width=130, anchor=tk.CENTER)
        self.history_tree.column('duration', width=80, anchor=tk.CENTER)
        self.history_tree.column('file_size', width=80, anchor=tk.CENTER)
        self.history_tree.column('file_path', width=200, anchor=tk.W)
        
        # 滚动条
        scrollbar_y = ttk.Scrollbar(list_frame, orient=tk.VERTICAL, command=self.history_tree.yview)
        scrollbar_x = ttk.Scrollbar(list_frame, orient=tk.HORIZONTAL, command=self.history_tree.xview)
        self.history_tree.configure(yscrollcommand=scrollbar_y.set, xscrollcommand=scrollbar_x.set)
        
        # 布局
        self.history_tree.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar_y.pack(side=tk.RIGHT, fill=tk.Y)
        
        # 右键菜单
        self._create_history_context_menu()
    
    def _create_history_context_menu(self):
        """创建历史记录右键菜单"""
        self.history_menu = tk.Menu(self.root, tearoff=0)
        self.history_menu.add_command(label="打开文件位置", command=self._open_history_file_location)
        self.history_menu.add_command(label="播放视频", command=self._play_history_video)
        self.history_menu.add_separator()
        self.history_menu.add_command(label="删除记录", command=self._delete_history_item)
        
        self.history_tree.bind('<Button-3>', self._show_history_menu)
    
    def _show_history_menu(self, event):
        """显示历史右键菜单"""
        item = self.history_tree.identify_row(event.y)
        if item:
            self.history_tree.selection_set(item)
            self.history_menu.tk_popup(event.x_root, event.y_root)
    
    def _create_status_bar(self):
        """创建状态栏"""
        self.status_bar = ttk.Frame(self.root)
        self.status_bar.pack(fill=tk.X, side=tk.BOTTOM)
        
        self.status_left_label = ttk.Label(
            self.status_bar,
            text="就绪",
            relief=tk.SUNKEN,
            anchor=tk.W
        )
        self.status_left_label.pack(side=tk.LEFT, fill=tk.X, expand=True)
        
        self.status_right_label = ttk.Label(
            self.status_bar,
            text=f"版本: 1.0.0",
            relief=tk.SUNKEN,
            anchor=tk.E
        )
        self.status_right_label.pack(side=tk.RIGHT)
    
    def _bind_events(self):
        """绑定事件"""
        # 窗口关闭事件
        self.root.protocol("WM_DELETE_WINDOW", self._on_exit)
        
        # 绑定核心回调
        self.core.on_streamer_status_change = self._on_streamer_status_change
        self.core.on_error = self._on_core_error
    
    def _schedule_ui_update(self):
        """定时更新UI"""
        self._update_ui()
        # 每2秒更新一次
        self._ui_update_id = self.root.after(2000, self._schedule_ui_update)
    
    def _update_ui(self):
        """更新UI状态"""
        try:
            # 更新监控状态
            if self.core.is_running:
                self.monitor_status_label.configure(
                    text="监控状态: 运行中",
                    foreground=self.colors['success']
                )
                self.start_monitor_button.configure(text="⏹ 停止监控")
            else:
                self.monitor_status_label.configure(
                    text="监控状态: 未启动",
                    foreground=self.colors['text_light']
                )
                self.start_monitor_button.configure(text="▶ 开始监控")
            
            # 更新录制状态
            recording_info = self.core.get_recording_info()
            if recording_info:
                streamer_name = recording_info.get('streamer_name', '未知')
                duration = recording_info.get('duration', 0)
                duration_str = self._format_duration(duration)
                self.recording_status_label.configure(
                    text=f"正在录制: {streamer_name} ({duration_str})",
                    foreground=self.colors['recording']
                )
            else:
                self.recording_status_label.configure(text="")
            
            # 更新FFmpeg状态
            if self.core.recorder.check_ffmpeg_available():
                self.ffmpeg_status_label.configure(
                    text="✓ FFmpeg已就绪",
                    foreground=self.colors['success']
                )
            else:
                self.ffmpeg_status_label.configure(
                    text="✗ FFmpeg未找到，请配置路径",
                    foreground=self.colors['danger']
                )
        
        except Exception as e:
            print(f"更新UI时出错: {e}")
    
    def _format_duration(self, seconds: float) -> str:
        """格式化时长"""
        if seconds <= 0:
            return "00:00"
        
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        hours = minutes // 60
        minutes = minutes % 60
        
        if hours > 0:
            return f"{hours:02d}:{minutes:02d}:{secs:02d}"
        else:
            return f"{minutes:02d}:{secs:02d}"
    
    def _format_file_size(self, size: int) -> str:
        """格式化文件大小"""
        if size <= 0:
            return "0 B"
        
        units = ['B', 'KB', 'MB', 'GB', 'TB']
        index = 0
        while size >= 1024 and index < len(units) - 1:
            size /= 1024
            index += 1
        
        return f"{size:.1f} {units[index]}"
    
    # ==================== 事件处理方法 ====================
    
    def _on_streamer_status_change(self, data: Dict):
        """主播状态变化回调"""
        # 在主线程中更新UI
        self.root.after(0, self._refresh_streamer_list)
    
    def _on_core_error(self, error_type: str, error_msg: str):
        """核心错误回调"""
        self.root.after(0, lambda: messagebox.showerror(error_type, error_msg))
    
    def _on_exit(self):
        """退出程序"""
        # 停止UI更新
        if self._ui_update_id:
            self.root.after_cancel(self._ui_update_id)
        
        # 停止监控
        if self.core.is_running:
            self.core.stop_monitor()
        
        # 关闭窗口
        self.root.destroy()
    
    # ==================== 操作方法 ====================
    
    def _add_streamer(self):
        """添加主播"""
        input_str = self.add_streamer_entry.get().strip()
        note = self.add_note_entry.get().strip()
        
        if not input_str:
            messagebox.showwarning("提示", "请输入直播间ID或链接")
            return
        
        # 显示处理中
        self.add_button.configure(text="处理中...", state=tk.DISABLED)
        self.root.update()
        
        try:
            success, message = self.core.add_streamer(input_str, note)
            
            if success:
                messagebox.showinfo("成功", message)
                self.add_streamer_entry.delete(0, tk.END)
                self.add_note_entry.delete(0, tk.END)
                self._refresh_streamer_list()
            else:
                messagebox.showwarning("失败", message)
        
        except Exception as e:
            messagebox.showerror("错误", f"添加主播时出错: {e}")
        
        finally:
            self.add_button.configure(text="添加", state=tk.NORMAL)
    
    def _toggle_monitor(self):
        """切换监控状态"""
        if self.core.is_running:
            # 停止监控
            self.core.stop_monitor()
        else:
            # 检查是否有主播需要监控
            streamers = self.core.config.get_streamers()
            monitoring_count = sum(1 for s in streamers if s.get("is_monitoring", False))
            
            if monitoring_count == 0:
                messagebox.showwarning("提示", "没有需要监控的主播，请先开启至少一个主播的监控")
                return
            
            # 启动监控
            if self.core.start_monitor():
                self.status_left_label.configure(text="监控已启动")
            else:
                messagebox.showerror("错误", "启动监控失败，请检查FFmpeg是否已安装")
    
    def _refresh_streamer_list(self):
        """刷新主播列表"""
        # 清空列表
        for item in self.streamer_tree.get_children():
            self.streamer_tree.delete(item)
        
        # 获取所有主播状态
        streamers = self.core.get_all_streamers_status()
        
        for streamer in streamers:
            room_id = streamer.get('room_id', '')
            name = streamer.get('name', '')
            is_live = streamer.get('is_live', False)
            is_recording = streamer.get('is_recording', False)
            is_monitoring = streamer.get('is_monitoring', False)
            note = streamer.get('note', '')
            last_live_time = streamer.get('last_live_time', '') or ''
            
            # 确定状态文本
            if is_recording:
                status = "● 录制中"
                status_tag = 'recording'
            elif is_live:
                status = "● 直播中"
                status_tag = 'live'
            else:
                status = "○ 未开播"
                status_tag = 'offline'
            
            # 确定监控状态
            monitoring_text = "是" if is_monitoring else "否"
            monitoring_tag = 'monitoring' if is_monitoring else 'not_monitoring'
            
            # 插入数据
            item_id = self.streamer_tree.insert(
                '',
                tk.END,
                values=(room_id, name, status, monitoring_text, note, last_live_time)
            )
            
            # 设置标签
            self.streamer_tree.item(item_id, tags=(status_tag, monitoring_tag))
        
        # 配置标签颜色
        self.streamer_tree.tag_configure('live', foreground=self.colors['live'])
        self.streamer_tree.tag_configure('recording', foreground=self.colors['recording'])
        self.streamer_tree.tag_configure('offline', foreground=self.colors['text_light'])
        self.streamer_tree.tag_configure('monitoring', background='#e8f5e9')
    
    def _toggle_streamer_monitor(self, enable: bool):
        """切换主播监控状态"""
        selection = self.streamer_tree.selection()
        if not selection:
            return
        
        item = selection[0]
        values = self.streamer_tree.item(item, 'values')
        room_id = values[0]
        
        if self.core.toggle_monitor_streamer(room_id, enable):
            self._refresh_streamer_list()
    
    def _on_streamer_double_click(self, event):
        """双击主播项"""
        selection = self.streamer_tree.selection()
        if selection:
            item = selection[0]
            values = self.streamer_tree.item(item, 'values')
            room_id = values[0]
            # 切换监控状态
            streamer = self.core.config.get_streamer(room_id)
            if streamer:
                current = streamer.get('is_monitoring', False)
                self._toggle_streamer_monitor(not current)
    
    def _open_streamer_room(self):
        """打开直播间"""
        selection = self.streamer_tree.selection()
        if not selection:
            return
        
        item = selection[0]
        values = self.streamer_tree.item(item, 'values')
        room_id = values[0]
        
        url = f"https://live.bilibili.com/{room_id}"
        
        try:
            import webbrowser
            webbrowser.open(url)
        except Exception as e:
            messagebox.showerror("错误", f"无法打开浏览器: {e}")
    
    def _delete_streamer(self):
        """删除主播"""
        selection = self.streamer_tree.selection()
        if not selection:
            return
        
        item = selection[0]
        values = self.streamer_tree.item(item, 'values')
        room_id = values[0]
        name = values[1]
        
        if messagebox.askyesno("确认删除", f"确定要删除主播 {name} 吗？"):
            if self.core.remove_streamer(room_id):
                self._refresh_streamer_list()
                self.status_left_label.configure(text=f"已删除主播: {name}")
            else:
                messagebox.showerror("错误", "删除失败")
    
    def _refresh_history(self):
        """刷新历史记录"""
        # 清空列表
        for item in self.history_tree.get_children():
            self.history_tree.delete(item)
        
        # 获取历史记录
        history = self.core.config.get_history()
        
        for record in history:
            streamer_name = record.get('streamer_name', '')
            title = record.get('title', '')
            start_time = record.get('start_time', '')
            end_time = record.get('end_time', '')
            duration = record.get('duration', 0)
            file_size = record.get('file_size', 0)
            file_path = record.get('file_path', '')
            
            # 格式化
            duration_str = self._format_duration(duration)
            size_str = self._format_file_size(file_size)
            
            # 插入数据
            self.history_tree.insert(
                '',
                tk.END,
                values=(streamer_name, title, start_time, end_time, duration_str, size_str, file_path)
            )
    
    def _clear_history(self):
        """清空历史记录"""
        if messagebox.askyesno("确认", "确定要清空所有录屏历史吗？"):
            self.core.config.clear_history()
            self._refresh_history()
            self.status_left_label.configure(text="已清空历史记录")
    
    def _open_history_file_location(self):
        """打开历史记录文件位置"""
        selection = self.history_tree.selection()
        if not selection:
            return
        
        item = selection[0]
        values = self.history_tree.item(item, 'values')
        file_path = values[6]
        
        if not file_path or not os.path.exists(file_path):
            messagebox.showwarning("提示", "文件不存在")
            return
        
        try:
            import subprocess
            folder = os.path.dirname(file_path)
            subprocess.Popen(f'explorer /select,"{file_path}"')
        except Exception as e:
            messagebox.showerror("错误", f"无法打开文件夹: {e}")
    
    def _play_history_video(self):
        """播放历史视频"""
        selection = self.history_tree.selection()
        if not selection:
            return
        
        item = selection[0]
        values = self.history_tree.item(item, 'values')
        file_path = values[6]
        
        if not file_path or not os.path.exists(file_path):
            messagebox.showwarning("提示", "文件不存在")
            return
        
        try:
            os.startfile(file_path)
        except Exception as e:
            messagebox.showerror("错误", f"无法打开文件: {e}")
    
    def _delete_history_item(self):
        """删除历史记录项"""
        # 注意：这只是从列表中移除，并不删除实际文件
        messagebox.showinfo("提示", "历史记录无法单独删除，只能全部清空")
    
    def _load_config_to_ui(self):
        """加载配置到UI"""
        config = self.core.get_config()
        
        self.interval_var.set(str(config.get('monitor_interval', 10)))
        self.save_path_var.set(config.get('save_path', ''))
        self.file_name_var.set(config.get('file_name_format', '{主播名}_{开播时间}'))
        self.quality_var.set(config.get('video_quality', '原画'))
        self.format_var.set(config.get('video_format', 'mp4'))
        self.ffmpeg_path_var.set(config.get('ffmpeg_path', ''))
        self.enable_notification_var.set(config.get('enable_notification', True))
        self.enable_sound_var.set(config.get('enable_sound', True))
    
    def _save_settings(self):
        """保存设置"""
        try:
            # 监控间隔
            interval = int(self.interval_var.get())
            if interval < 5:
                interval = 5
            self.core.update_config('monitor_interval', interval)
            
            # 保存路径
            self.core.update_config('save_path', self.save_path_var.get())
            
            # 文件名格式
            self.core.update_config('file_name_format', self.file_name_var.get())
            
            # 画质
            self.core.update_config('video_quality', self.quality_var.get())
            
            # 格式
            self.core.update_config('video_format', self.format_var.get())
            
            # FFmpeg路径
            ffmpeg_path = self.ffmpeg_path_var.get()
            if ffmpeg_path:
                self.core.update_config('ffmpeg_path', ffmpeg_path)
            
            # 通知设置
            self.core.update_config('enable_notification', self.enable_notification_var.get())
            self.core.update_config('enable_sound', self.enable_sound_var.get())
            
            # 保存配置文件
            self.core.config.save_config()
            
            messagebox.showinfo("成功", "设置已保存")
            self.status_left_label.configure(text="设置已保存")
        
        except ValueError:
            messagebox.showerror("错误", "监控间隔必须是有效的数字")
        except Exception as e:
            messagebox.showerror("错误", f"保存设置时出错: {e}")
    
    def _browse_save_path(self):
        """浏览保存路径"""
        path = filedialog.askdirectory(
            title="选择保存目录",
            initialdir=self.save_path_var.get() or os.path.expanduser("~")
        )
        if path:
            self.save_path_var.set(path)
    
    def _browse_ffmpeg_path(self):
        """浏览FFmpeg路径"""
        path = filedialog.askopenfilename(
            title="选择FFmpeg可执行文件",
            filetypes=[("可执行文件", "*.exe"), ("所有文件", "*.*")],
            initialdir=os.path.dirname(self.ffmpeg_path_var.get()) if self.ffmpeg_path_var.get() else os.path.expanduser("~")
        )
        if path:
            self.ffmpeg_path_var.set(path)
    
    def _open_save_directory(self):
        """打开保存目录"""
        save_path = self.save_path_var.get()
        
        if not save_path:
            # 使用默认路径
            save_path = os.path.join(os.path.expanduser("~"), "Videos", "BilibiliRecordings")
        
        if not os.path.exists(save_path):
            os.makedirs(save_path, exist_ok=True)
        
        try:
            os.startfile(save_path)
        except Exception as e:
            messagebox.showerror("错误", f"无法打开文件夹: {e}")
    
    def _configure_ffmpeg(self):
        """配置FFmpeg"""
        # 切换到设置选项卡
        self.notebook.select(self.settings_frame)
    
    def _test_notification(self):
        """测试通知"""
        if self.core.notifier.play_test_sound():
            self.status_left_label.configure(text="测试提示音已播放")
        else:
            messagebox.showwarning("提示", "无法播放测试音")
        
        # 显示测试通知
        self.core.notifier.show_test_notification()
        self.status_left_label.configure(text="测试通知已发送")
    
    def _show_help(self):
        """显示帮助"""
        help_text = """
B站直播间监控录屏工具 - 使用说明

【功能说明】
1. 直播监控：自动监控指定主播的开播状态
2. 开播提醒：主播开播时发送桌面通知和提示音
3. 自动录屏：检测到开播自动开始录制，下播自动停止

【使用方法】
1. 添加主播：在输入框中输入直播间ID或链接，点击添加
2. 开启监控：双击主播列表项或右键选择"开启监控"
3. 启动监控：点击"开始监控"按钮
4. 查看设置：在"设置"选项卡中配置录屏参数

【支持的输入格式】
- 纯数字ID：例如 123456
- 直播间链接：https://live.bilibili.com/123456
- 主播主页：https://space.bilibili.com/123456
- 短链接：https://b23.tv/xxxxx

【依赖要求】
- Python 3.8+
- FFmpeg（需配置到系统PATH或在设置中指定路径）
        """
        messagebox.showinfo("使用说明", help_text)
    
    def _show_about(self):
        """显示关于"""
        about_text = """
B站直播间监控录屏工具 v1.0.0

功能特性：
- 24小时后台监控
- 开播实时提醒
- 自动录屏保存
- 多主播同时监控

技术栈：
- Python + tkinter (GUI)
- B站开放API
- FFmpeg (视频录制)

开源免费，仅供学习使用
        """
        messagebox.showinfo("关于", about_text)
    
    def run(self):
        """运行应用"""
        # 检查FFmpeg
        if not self.core.recorder.check_ffmpeg_available():
            messagebox.showwarning(
                "提示",
                "未检测到FFmpeg。\n\n"
                "请安装FFmpeg并将其添加到系统PATH，\n"
                "或在设置中手动指定FFmpeg路径。\n\n"
                "下载地址：https://ffmpeg.org/download.html"
            )
        
        # 启动主循环
        self.root.mainloop()


def main():
    """主函数"""
    app = BilibiliMonitorApp()
    app.run()


if __name__ == "__main__":
    main()
