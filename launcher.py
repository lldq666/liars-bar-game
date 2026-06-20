#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
骗子酒馆游戏启动器
自动检查环境并启动服务器
"""

import os
import sys
import subprocess
import webbrowser
import time
from pathlib import Path

def check_dependencies():
    """检查依赖包"""
    print("检查依赖包...")
    required = ['flask', 'flask_cors']
    missing = []
    
    for pkg in required:
        try:
            __import__(pkg)
            print(f"  ✓ {pkg}")
        except ImportError:
            missing.append(pkg)
            print(f"  ✗ {pkg} (未安装)")
    
    if missing:
        print(f"\n正在安装缺失的依赖: {', '.join(missing)}")
        try:
            subprocess.check_call([sys.executable, '-m', 'pip', 'install'] + missing)
            print("安装成功!")
            return True
        except Exception as e:
            print(f"安装失败: {e}")
            return False
    return True

def start_server(port=5000):
    """启动后端服务器"""
    print(f"\n启动后端服务器 (端口 {port})...")
    
    # 获取项目根目录
    root_dir = Path(__file__).parent
    backend_dir = root_dir / 'backend'
    server_script = backend_dir / 'server.py'
    
    if not server_script.exists():
        print(f"错误: 找不到服务器脚本 {server_script}")
        return False
    
    # 启动服务器
    try:
        cmd = [sys.executable, str(server_script), str(port)]
        print(f"执行命令: {' '.join(cmd)}")
        print("按 Ctrl+C 停止服务器\n")
        
        subprocess.run(cmd, cwd=str(backend_dir))
        return True
    except KeyboardInterrupt:
        print("\n服务器已停止")
        return True
    except Exception as e:
        print(f"启动失败: {e}")
        return False

def start_frontend_server(port=8080):
    """启动前端HTTP服务器"""
    print(f"\n启动前端服务器 (端口 {port})...")
    
    frontend_dir = Path(__file__).parent / 'frontend'
    
    if not frontend_dir.exists():
        print(f"错误: 找不到前端目录 {frontend_dir}")
        return False
    
    try:
        cmd = [sys.executable, '-m', 'http.server', str(port)]
        print(f"前端服务器启动在 http://localhost:{port}")
        print("按 Ctrl+C 停止服务器\n")
        
        subprocess.run(cmd, cwd=str(frontend_dir))
        return True
    except KeyboardInterrupt:
        print("\n前端服务器已停止")
        return True
    except Exception as e:
        print(f"启动失败: {e}")
        return False

def main():
    """主函数"""
    print("=" * 50)
    print("    骗子酒馆游戏启动器")
    print("=" * 50)
    print()
    
    # 检查依赖
    if not check_dependencies():
        print("\n请手动安装依赖: pip install flask flask-cors")
        input("按回车键退出...")
        return
    
    # 选择启动模式
    print("\n请选择启动模式:")
    print("  1. 启动后端服务器 (端口 5000)")
    print("  2. 启动前端服务器 (端口 8080)")
    print("  0. 退出")
    print()
    
    try:
        choice = input("请输入选项 (0-2): ").strip()
        
        if choice == '1':
            start_server(5000)
        elif choice == '2':
            start_frontend_server(8080)
            print(f"\n打开浏览器访问: http://localhost:8080")
            input("按回车键退出...")
        elif choice == '0':
            print("再见!")
        else:
            print("无效选项!")
    except KeyboardInterrupt:
        print("\n\n已取消")
    except Exception as e:
        print(f"\n错误: {e}")
        input("\n按回车键退出...")

if __name__ == '__main__':
    main()
