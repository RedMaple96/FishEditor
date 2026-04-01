#!/bin/bash

# 检查是否有保存的 PID 文件
if [ -f ".pid" ]; then
    PID=$(cat .pid)
    
    # 检查进程是否真正在运行
    if ps -p $PID > /dev/null; then
        echo "Stopping Fish Path Editor server (PID: $PID)..."
        # 杀死该进程
        kill $PID
        
        # 清理残留文件
        rm .pid
        
        echo "Server stopped successfully!"
    else
        echo "Server is not running, but .pid file found. Cleaning up..."
        rm .pid
    fi
else
    # 尝试找到占用 Vite 的遗留进程
    echo "No .pid file found. Trying to find running Vite servers..."
    PIDS=$(pgrep -f "vite")
    
    if [ -z "$PIDS" ]; then
        echo "No running server found."
    else
        echo "Found orphaned Vite processes. Killing them..."
        for p in $PIDS; do
            kill $p
            echo "Killed process $p"
        done
        echo "All Vite servers stopped."
    fi
fi
