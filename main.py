# -*- coding: utf-8 -*-
"""
B站直播间监控录屏工具
功能：直播间监控、开播提醒、自动录屏
作者：Trae AI Assistant
版本：1.0.0
"""

import sys
import os


def check_python_version():
    """检查Python版本"""
    if sys.version_info < (3, 8):
        print("错误：Python版本过低，请使用Python 3.8或更高版本")
        print(f"当前版本：{sys.version}")
        input("按回车退出...")
        sys.exit(1)


def check_dependencies():
    """检查依赖是否安装"""
    missing_packages = []
    
    required_packages = [
        ('requests', 'requests'),
        ('win10toast', 'win10toast'),
        ('yaml', 'pyyaml'),
    ]
    
    for module_name, package_name in required_packages:
        try:
            __import__(module_name)
        except ImportError:
            missing_packages.append(package_name)
    
    if missing_packages:
        print("警告：以下依赖包未安装：")
        for pkg in missing_packages:
            print(f"  - {pkg}")
        print("\n请运行以下命令安装依赖：")
        print(f"  pip install {' '.join(missing_packages)}")
        print("\n或者安装所有依赖：")
        print("  pip install -r requirements.txt")
        print()
        
        # 询问用户是否继续
        response = input("是否继续运行？(y/n): ")
        if response.lower() != 'y':
            sys.exit(1)


def main():
    """主函数"""
    # 检查Python版本
    check_python_version()
    
    # 检查依赖
    check_dependencies()
    
    # 启动GUI
    try:
        from gui import BilibiliMonitorApp
        app = BilibiliMonitorApp()
        app.run()
    except Exception as e:
        print(f"启动程序时出错: {e}")
        import traceback
        traceback.print_exc()
        input("按回车退出...")
        sys.exit(1)


if __name__ == "__main__":
    main()
