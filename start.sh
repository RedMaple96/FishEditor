#!/bin/bash

# 检查依赖是否已安装
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# 检查是否已有服务在运行
if [ -f ".pid" ]; then
    PID=$(cat .pid)
    if ps -p $PID > /dev/null; then
        echo "Server is already running (PID: $PID)"
        echo "Please run ./stop.sh first or access https://localhost:5178"
        exit 1
    else
        # PID 文件存在但进程已死，清理残留
        rm .pid
    fi
fi

echo "Starting Fish Path Editor server..."
# 使用 nohup 后台运行开发服务器，并将日志输出到 server.log
nohup npm run dev > server.log 2>&1 &
PID=$!

# 保存进程ID
echo $PID > .pid

echo "Server started successfully in the background!"
echo "PID: $PID"
echo "You can check the logs using: tail -f server.log"
echo "---------------------------------------------------"
echo "Access the editor at:"
echo "👉 https://localhost:5178/"
echo "👉 https://127.0.0.1:5178/"
echo "(Note: Check server.log for the exact port if 5178 is occupied)"
echo "---------------------------------------------------"
echo "To stop the server, run: ./stop.sh"
