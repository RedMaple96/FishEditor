import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MousePointer2, MousePointerClick, PenTool, Trash2, Download, Settings, Copy, Check, Fish, Undo, Redo, FlipHorizontal, FlipVertical, Repeat, FileDown, ImageDown } from 'lucide-react';
import { Point, PathPoint, douglasPeucker, calculateAngles, bezierSpline, resamplePath, resampleSegment } from '../utils/path';

// 定义绘制模式
type DrawMode = 'freehand' | 'keypoint' | 'select';

export default function Home() {
  // 画布尺寸设置
  const [resolution, setResolution] = useState({ width: 1280, height: 720 });
  
  // 核心状态
  const [mode, setMode] = useState<DrawMode>('freehand');
  const [isDrawing, setIsDrawing] = useState(false);
  const [tempPoints, setTempPoints] = useState<Point[]>([]); // 自由绘制时的临时点
  const [smoothEpsilon, setSmoothEpsilon] = useState(50); // 平滑容差
  const [addPointsCount, setAddPointsCount] = useState(10); // 全局增加坐标点数量

  // 历史记录状态 (用于撤回/重做)
  const [historyState, setHistoryState] = useState({
    history: [[]] as Point[][],
    currentIndex: 0
  });

  // 从历史记录派生当前的点，不再维护独立的 points 状态
  const points = historyState.history[historyState.currentIndex];

  // 统一的保存坐标点和历史记录的函数
  const commitPoints = useCallback((newPointsOrUpdater: Point[] | ((prev: Point[]) => Point[])) => {
    setHistoryState(prevHistory => {
      const currentPoints = prevHistory.history[prevHistory.currentIndex];
      const newPoints = typeof newPointsOrUpdater === 'function' ? newPointsOrUpdater(currentPoints) : newPointsOrUpdater;
      
      // 只有点确实改变了才保存历史
      if (JSON.stringify(currentPoints) !== JSON.stringify(newPoints)) {
        // 截断 currentIndex 之后的历史 (如果我们在撤回后又做了新操作)
        const newHistory = prevHistory.history.slice(0, prevHistory.currentIndex + 1);
        newHistory.push(newPoints);
        return { history: newHistory, currentIndex: newHistory.length - 1 };
      }
      return prevHistory;
    });
  }, []);

  // 撤回和重做处理
  const handleUndo = useCallback(() => {
    setHistoryState(prev => {
      if (prev.currentIndex > 0) {
        return { ...prev, currentIndex: prev.currentIndex - 1 };
      }
      return prev;
    });
    setSelectedIndices([]);
    setActiveSelectTarget(null);
  }, []);

  const handleRedo = useCallback(() => {
    setHistoryState(prev => {
      if (prev.currentIndex < prev.history.length - 1) {
        return { ...prev, currentIndex: prev.currentIndex + 1 };
      }
      return prev;
    });
    setSelectedIndices([]);
    setActiveSelectTarget(null);
  }, []);

  // 监听快捷键 (撤销/重做)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 检查是否按下 Cmd (Mac) 或 Ctrl (Windows/Linux)
      if (e.metaKey || e.ctrlKey) {
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        } else if (e.key.toLowerCase() === 'y') {
          // Windows 习惯的重做快捷键
          e.preventDefault();
          handleRedo();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo]);

  // 镜像处理
  const handleMirrorHorizontal = () => {
    if (points.length === 0) return;
    const newPoints = points.map(p => ({ ...p, x: resolution.width - p.x }));
    commitPoints(newPoints);
  };

  const handleMirrorVertical = () => {
    if (points.length === 0) return;
    const newPoints = points.map(p => ({ ...p, y: resolution.height - p.y }));
    commitPoints(newPoints);
  };

  const handleReverseDirection = () => {
    if (points.length === 0) return;
    const newPoints = [...points].reverse();
    commitPoints(newPoints);
  };

  // 局部调整状态
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [activeSelectTarget, setActiveSelectTarget] = useState<'A' | 'B' | null>(null); // 当前正在选择哪个点
  const [segmentTargetCount, setSegmentTargetCount] = useState(10);
  
  // 导出相关状态
  const [pathData, setPathData] = useState<PathPoint[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [exportFilename, setExportFilename] = useState('path00001');

  // 画布和容器引用
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  // 自由缩放和平移状态
  const [userScale, setUserScale] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const lastMousePos = useRef<Point | null>(null);

  // 缩放画布以适应屏幕
  const updateSize = useCallback(() => {
    if (containerRef.current) {
      const { clientWidth, clientHeight } = containerRef.current;
      setContainerSize({ width: clientWidth, height: clientHeight });
    }
  }, []);

  useEffect(() => {
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, [updateSize]);

  // 计算基础视图变换（居中显示）
  const baseScale = containerSize.width > 0 
    ? Math.min((containerSize.width - 200) / resolution.width, (containerSize.height - 200) / resolution.height, 1) 
    : 1;
  const baseOffsetX = (containerSize.width - resolution.width * baseScale) / 2;
  const baseOffsetY = (containerSize.height - resolution.height * baseScale) / 2;

  // 最终应用的变换
  const scale = baseScale * userScale;
  const offsetX = baseOffsetX + panOffset.x;
  const offsetY = baseOffsetY + panOffset.y;

  // 监听并计算路径数据
  useEffect(() => {
    setPathData(calculateAngles(points));
  }, [points]);

  // 绘制画布
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // 将坐标系变换：原点平移到左下角，Y轴向上翻转
    ctx.translate(0, resolution.height);
    ctx.scale(1, -1);

    // 网格起始结束点(扩展到画布外，考虑到此时的坐标系已经变换)
    const startX = -offsetX / scale;
    const endX = (canvas.width - offsetX) / scale;
    const startY = (offsetY - canvas.height) / scale + resolution.height;
    const endY = offsetY / scale + resolution.height;

    // 绘制网格
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1 / scale;
    const gridSize = 100;
    
    const firstGridX = Math.floor(startX / gridSize) * gridSize;
    const firstGridY = Math.floor(startY / gridSize) * gridSize;

    for (let x = firstGridX; x <= endX; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
      ctx.stroke();
    }
    for (let y = firstGridY; y <= endY; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(startX, y);
      ctx.lineTo(endX, y);
      ctx.stroke();
    }

    // 绘制分辨率红框
    ctx.strokeStyle = 'rgba(255, 68, 68, 0.8)';
    ctx.lineWidth = 2 / scale;
    // 由于Y轴翻转，左下角原点画框相当于往右上画，宽和高为正即可
    ctx.strokeRect(0, 0, resolution.width, resolution.height);

    // 绘制正在画的临时线条（自由画线模式）
    if (tempPoints.length > 0) {
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 255, 255, 0.4)';
      ctx.lineWidth = 3 / scale;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.moveTo(tempPoints[0].x, tempPoints[0].y);
      for (let i = 1; i < tempPoints.length; i++) {
        ctx.lineTo(tempPoints[i].x, tempPoints[i].y);
      }
      ctx.stroke();
    }

    // 绘制平滑曲线（基于坐标点）
    if (points.length > 1) {
      // smooth 系数：0-1 之间，越大弧度越夸张圆润
      // 设置为 0.4 可以得到极其平滑和自然的物理弯曲效果
      const curvePoints = bezierSpline(points, 0.4, 50);
      ctx.beginPath();
      // 发光效果
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 10 / scale;
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 4 / scale;
      
      ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
      for (let i = 1; i < curvePoints.length; i++) {
        ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
      }
      ctx.stroke();
      
      // 清除发光，避免影响坐标点绘制
      ctx.shadowBlur = 0;
    }

    // 绘制坐标点和切线方向指示（代表鱼头）
    points.forEach((p, i) => {
      const isSelected = selectedIndices.includes(i);
      const isA = i === selectedIndices[0];
      const isB = i === selectedIndices[1];
      const isActiveA = activeSelectTarget === 'A' && isA;
      const isActiveB = activeSelectTarget === 'B' && isB;
      const isActive = isActiveA || isActiveB;
      
      const glowColorRgb = isActive ? '217, 70, 239' : '249, 115, 22'; // Fuchsia 或 Orange
      const fillColor = isActive ? '#d946ef' : (isSelected ? '#f97316' : (i === 0 ? '#00ff00' : i === points.length - 1 ? '#ff0055' : '#ffffff'));

      // 如果选中，使用多个半透明圆绘制稳定的发光效果，不受 shadowBlur 缩放或兼容性影响
      if (isSelected) {
        for (let g = 3; g >= 1; g--) {
          ctx.beginPath();
          ctx.fillStyle = `rgba(${glowColorRgb}, ${0.15})`;
          ctx.arc(p.x, p.y, (8 + g * 5) / scale, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // 绘制实心点
      ctx.beginPath();
      ctx.fillStyle = fillColor;
      ctx.arc(p.x, p.y, (isSelected ? 8 : 6) / scale, 0, Math.PI * 2);
      ctx.fill();
      
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2 / scale;
      ctx.stroke();

      // 绘制方向箭头
      if (pathData[i]) {
        // 由于画布Y轴已经翻转（Y向上为正），绘制时的角度计算也需要反转
        // 标准数学系下，Math.atan2(dy, dx) 得出的角度是逆时针为正，但在翻转后的Canvas中
        // 我们需要保持与之前的方向一致（之前的方向是基于左上角原点计算的，Y向下为正）。
        // 注意：计算角度时 dy 是取反计算的（参考 path.ts），为了正确在 canvas 绘制出来，我们需要用 -angleRad
        const angleRad = -pathData[i].angle * (Math.PI / 180);
        const arrowLen = 20 / scale;
        ctx.beginPath();
        ctx.strokeStyle = '#ffff00';
        ctx.lineWidth = 2 / scale;
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(
          p.x + Math.cos(angleRad) * arrowLen,
          p.y + Math.sin(angleRad) * arrowLen
        );
        ctx.stroke();
      }
    });

    ctx.restore();

  }, [points, tempPoints, pathData, containerSize, resolution, scale, offsetX, offsetY, selectedIndices, activeSelectTarget]);

  useEffect(() => {
    draw();
  }, [draw]);

  // 鼠标事件处理
  const getMousePos = (e: React.MouseEvent | React.TouchEvent): Point | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    
    let clientX, clientY;
    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = (e as React.MouseEvent).clientX;
      clientY = (e as React.MouseEvent).clientY;
    }

    const screenX = clientX - rect.left;
    const screenY = clientY - rect.top;

    // 将屏幕坐标转换为红框左下角为原点 (0,0) 的坐标系
    // 原始坐标原点在红框左上角，即 (0, 0)
    // 现原点在红框左下角，即 (0, resolution.height)
    // X坐标不变：x = (screenX - offsetX) / scale
    // Y坐标翻转并偏移：y = resolution.height - (screenY - offsetY) / scale
    return {
      x: (screenX - offsetX) / scale,
      y: resolution.height - (screenY - offsetY) / scale
    };
  };

  const handlePointerDown = (e: React.MouseEvent | React.TouchEvent) => {
    // 处理右键/中键拖拽平移
    if ('button' in e && (e.button === 2 || e.button === 1)) {
      e.preventDefault();
      setIsPanning(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    const pos = getMousePos(e);
    if (!pos) return;

    if (mode === 'freehand') {
      setIsDrawing(true);
      setTempPoints([pos]);
      setSelectedIndices([]); // 自由画线时清空选择
      setActiveSelectTarget(null);
    } else if (mode === 'keypoint') {
      commitPoints(prev => [...prev, pos]);
      setSelectedIndices([]);
      setActiveSelectTarget(null);
    } else if (mode === 'select' && activeSelectTarget) {
      // 只有在明确激活了选点按钮 (A 或 B) 时，才响应画布上的点选
      // 碰撞检测（点选坐标点）
      const HIT_RADIUS = 15 / scale;
      let hitIndex = -1;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        const d = Math.sqrt(Math.pow(p.x - pos.x, 2) + Math.pow(p.y - pos.y, 2));
        if (d <= HIT_RADIUS) {
          hitIndex = i;
          break;
        }
      }
      
      if (hitIndex !== -1) {
        setSelectedIndices(prev => {
          const newIndices = [...prev];
          if (activeSelectTarget === 'A') {
            newIndices[0] = hitIndex;
            // 如果 A 点选好了，自动切换焦点到 B 点（如果 B 还没选）
            if (newIndices[1] === undefined) {
              setActiveSelectTarget('B');
            } else {
              setActiveSelectTarget(null); // 都选好了就取消激活状态
            }
          } else if (activeSelectTarget === 'B') {
            newIndices[1] = hitIndex;
            setActiveSelectTarget(null); // 选完 B 点就取消激活状态
          }
          return newIndices;
        });
      }
    }
  };

  const handlePointerMove = (e: React.MouseEvent | React.TouchEvent) => {
    // 处理拖拽平移
    if (isPanning && 'clientX' in e && lastMousePos.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      setPanOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      return;
    }

    if (!isDrawing || mode !== 'freehand') return;
    const pos = getMousePos(e);
    if (!pos) return;

    setTempPoints(prev => [...prev, pos]);
  };

  const handlePointerUp = (e: React.MouseEvent | React.TouchEvent) => {
    // 结束拖拽平移
    if (isPanning) {
      setIsPanning(false);
      lastMousePos.current = null;
      return;
    }

    if (!isDrawing || mode !== 'freehand') return;
    setIsDrawing(false);

    if (tempPoints.length > 2) {
      // 对自由绘制的点进行抽稀，生成坐标点
      const simplified = douglasPeucker(tempPoints, smoothEpsilon);
      
      // 这里策略为：如果是第一次画则覆盖，否则追加并连接
      commitPoints(prev => prev.length === 0 ? simplified : [...prev, ...simplified]);
    }
    setTempPoints([]);
  };

  // 处理滚轮缩放
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    
    // 获取鼠标在容器中的相对位置
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // 缩放步长和范围
    const zoomFactor = 1.1;
    const isZoomIn = e.deltaY < 0;
    const newScale = isZoomIn ? userScale * zoomFactor : userScale / zoomFactor;
    
    // 限制缩放比例 (0.1x 到 10x)
    if (newScale < 0.1 || newScale > 10) return;

    // 调整平移偏移量，以鼠标位置为中心缩放
    // x_new = mouseX - (mouseX - offsetX) * (newScale / userScale)
    const scaleRatio = newScale / userScale;
    
    setPanOffset(prev => ({
      x: mouseX - baseOffsetX - (mouseX - baseOffsetX - prev.x) * scaleRatio,
      y: mouseY - baseOffsetY - (mouseY - baseOffsetY - prev.y) * scaleRatio
    }));
    
    setUserScale(newScale);
  }, [userScale, baseOffsetX, baseOffsetY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      // 禁用默认滚轮行为，并绑定自定义缩放事件
      canvas.addEventListener('wheel', handleWheel, { passive: false });
      // 禁用右键菜单
      canvas.addEventListener('contextmenu', e => e.preventDefault());
    }
    return () => {
      if (canvas) {
        canvas.removeEventListener('wheel', handleWheel);
        canvas.removeEventListener('contextmenu', e => e.preventDefault());
      }
    };
  }, [handleWheel]);

  const handleClear = () => {
    commitPoints([]);
    setTempPoints([]);
    setSelectedIndices([]);
    setActiveSelectTarget(null);
  };

  const handleApplySegment = () => {
    if (selectedIndices.length === 2) {
      const newPoints = resampleSegment(points, selectedIndices[0], selectedIndices[1], segmentTargetCount);
      commitPoints(newPoints);
      setSelectedIndices([]);
    }
  };

  const handleCopyData = () => {
    // 按照用户需求格式化数据为: [[x, y, angle], [x, y, angle], ...]
    const formattedData = pathData.map(p => [
      Number(p.x.toFixed(2)),
      Number(p.y.toFixed(2)),
      Number(p.angle.toFixed(2))
    ]);
    
    navigator.clipboard.writeText(JSON.stringify(formattedData));
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownloadData = (includeImage: boolean = false) => {
    if (pathData.length === 0) return;
    
    const fileName = exportFilename || 'path00001';

    // 1. 导出路径数据
    const formattedData = pathData.map(p => [
      Number(p.x.toFixed(2)),
      Number(p.y.toFixed(2)),
      Number(p.angle.toFixed(2))
    ]);
    
    const dataStr = JSON.stringify(formattedData);
    const dataBlob = new Blob([dataStr], { type: 'text/plain;charset=utf-8' });
    
    const dataUrl = URL.createObjectURL(dataBlob);
    const dataA = document.createElement('a');
    dataA.href = dataUrl;
    dataA.download = `${fileName}.dat`;
    document.body.appendChild(dataA);
    dataA.click();
    
    document.body.removeChild(dataA);
    URL.revokeObjectURL(dataUrl);

    // 2. 如果需要，导出画布截图
    if (includeImage) {
      const canvas = canvasRef.current;
      if (canvas) {
        const imageUrl = canvas.toDataURL('image/png');
        const imgA = document.createElement('a');
        imgA.href = imageUrl;
        imgA.download = `${fileName}.png`;
        document.body.appendChild(imgA);
        imgA.click();
        
        document.body.removeChild(imgA);
      }
    }
  };

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-300 flex flex-col font-sans overflow-hidden">
      {/* 顶部导航栏 */}
      <header className="h-16 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-6 shrink-0 z-10 relative">
        <div className="flex items-center gap-3 text-cyan-400">
          <Fish size={28} className="animate-pulse" />
          <h1 className="text-xl font-bold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500">
            Fish Path Editor
          </h1>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={handleUndo}
              disabled={historyState.currentIndex === 0}
              className="flex items-center justify-center p-1.5 text-slate-400 hover:text-cyan-400 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
              title="撤回"
            >
              <Undo size={16} />
            </button>
            <div className="w-px h-4 bg-slate-700 my-auto mx-1"></div>
            <button
              onClick={handleRedo}
              disabled={historyState.currentIndex === historyState.history.length - 1}
              className="flex items-center justify-center p-1.5 text-slate-400 hover:text-cyan-400 disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
              title="重做"
            >
              <Redo size={16} />
            </button>
          </div>

          <div className="flex bg-slate-800 p-1 rounded-lg border border-slate-700">
            <button
              onClick={() => { setMode('freehand'); setSelectedIndices([]); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md transition-all ${
                mode === 'freehand' ? 'bg-cyan-900/50 text-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PenTool size={16} />
              <span className="text-sm font-medium">自由画线</span>
            </button>
            <button
              onClick={() => { setMode('keypoint'); setSelectedIndices([]); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md transition-all ${
                mode === 'keypoint' ? 'bg-cyan-900/50 text-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MousePointer2 size={16} />
              <span className="text-sm font-medium">坐标点</span>
            </button>
            <button
              onClick={() => { setMode('select'); setActiveSelectTarget(null); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md transition-all ${
                mode === 'select' ? 'bg-cyan-900/50 text-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MousePointerClick size={16} />
              <span className="text-sm font-medium">选择/调整</span>
            </button>
          </div>
          
          <button
            onClick={handleClear}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-rose-900/30 text-slate-300 hover:text-rose-400 border border-slate-700 hover:border-rose-500/50 rounded-lg transition-colors"
          >
            <Trash2 size={16} />
            <span className="text-sm">清空画布</span>
          </button>
        </div>
      </header>

      {/* 主体区域 */}
      <main className="flex-1 flex overflow-hidden min-h-0">
        {/* 左侧控制面板 */}
        <aside className="w-72 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 z-10 shadow-2xl h-full">
          <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent min-h-0 flex flex-col">
            <div className="p-6 border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-2 mb-4 text-slate-200 font-semibold">
                <Settings size={18} className="text-cyan-500" />
                <h2>画布设置</h2>
              </div>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-slate-500 mb-1">分辨率宽 (Width)</label>
                  <input
                    type="number"
                    value={resolution.width}
                    onChange={(e) => setResolution(p => ({ ...p, width: Number(e.target.value) }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">分辨率高 (Height)</label>
                  <input
                    type="number"
                    value={resolution.height}
                    onChange={(e) => setResolution(p => ({ ...p, height: Number(e.target.value) }))}
                    className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-all"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 border-b border-slate-800 shrink-0">
              <h2 className="text-slate-200 font-semibold mb-4 text-sm">绘制与调整</h2>
              <div className="space-y-5">
                <div>
                  <label className="flex justify-between text-xs text-slate-500 mb-2">
                    <span>平滑强度 (Epsilon)</span>
                    <span className="text-cyan-400">{smoothEpsilon}</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={smoothEpsilon}
                    onChange={(e) => setSmoothEpsilon(Number(e.target.value))}
                    className="w-full accent-cyan-500"
                  />
                  <p className="text-[10px] text-slate-600 mt-2">
                    * 自由画线模式生效。值越大，生成的坐标点越少。
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <label className="flex justify-between text-xs text-slate-500 mb-2">
                    <span>全局增加坐标点数</span>
                    <span className="text-emerald-400">+{addPointsCount}</span>
                  </label>
                  <div className="flex gap-2 items-center">
                  <input
                    type="range"
                    min="1"
                    max="200"
                    value={addPointsCount}
                    onChange={(e) => setAddPointsCount(Number(e.target.value))}
                    className="flex-1 accent-emerald-500"
                  />
                </div>
                  <button
                    onClick={() => commitPoints(prev => resamplePath(prev, addPointsCount))}
                    disabled={points.length < 2}
                    className="w-full mt-3 py-2 px-4 bg-slate-800 hover:bg-emerald-900/30 text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/50 rounded-lg transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    全局均匀增加
                  </button>
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <h3 className="text-xs text-slate-400 mb-2">镜像与方向</h3>
                  <div className="flex gap-2 text-xs mb-2">
                    <button
                      onClick={handleMirrorHorizontal}
                      disabled={points.length === 0}
                      className="flex-1 flex items-center justify-center gap-1 py-2 px-2 bg-slate-800 hover:bg-cyan-900/30 text-slate-300 hover:text-cyan-400 border border-slate-700 hover:border-cyan-500/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="水平镜像"
                    >
                      <FlipHorizontal size={14} />
                      <span>左右</span>
                    </button>
                    <button
                      onClick={handleMirrorVertical}
                      disabled={points.length === 0}
                      className="flex-1 flex items-center justify-center gap-1 py-2 px-2 bg-slate-800 hover:bg-cyan-900/30 text-slate-300 hover:text-cyan-400 border border-slate-700 hover:border-cyan-500/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      title="垂直镜像"
                    >
                      <FlipVertical size={14} />
                      <span>上下</span>
                    </button>
                  </div>
                  <button
                    onClick={handleReverseDirection}
                    disabled={points.length === 0}
                    className="w-full flex items-center justify-center gap-2 py-2 px-2 bg-slate-800 hover:bg-cyan-900/30 text-slate-300 hover:text-cyan-400 border border-slate-700 hover:border-cyan-500/50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-xs"
                    title="反转路径首尾方向"
                  >
                    <Repeat size={14} />
                    <span>反转路径方向</span>
                  </button>
                </div>

                {mode === 'select' && (
                  <div className="pt-4 border-t border-slate-800 mt-4">
                    <h3 className="text-xs text-slate-400 mb-2">局部段落调整</h3>
                  <p className="text-[10px] text-slate-500 mb-3 leading-relaxed">
                    1. 点击下方按钮激活选点状态<br/>
                    2. 在右侧画布点击坐标点
                  </p>
                  <div className="flex gap-2 mb-3 text-xs text-slate-300">
                    <button 
                      onClick={() => setActiveSelectTarget('A')}
                      className={`flex-1 border rounded p-2 text-center transition-all ${
                        activeSelectTarget === 'A' 
                          ? 'bg-fuchsia-900/40 border-fuchsia-500 text-fuchsia-400 shadow-[0_0_10px_rgba(217,70,239,0.3)]' 
                          : 'bg-slate-950 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      选点 A: {selectedIndices[0] !== undefined ? selectedIndices[0] : '-'}
                    </button>
                    <button 
                      onClick={() => setActiveSelectTarget('B')}
                      className={`flex-1 border rounded p-2 text-center transition-all ${
                        activeSelectTarget === 'B' 
                          ? 'bg-fuchsia-900/40 border-fuchsia-500 text-fuchsia-400 shadow-[0_0_10px_rgba(217,70,239,0.3)]' 
                          : 'bg-slate-950 border-slate-700 hover:border-slate-500'
                      }`}
                    >
                      选点 B: {selectedIndices[1] !== undefined ? selectedIndices[1] : '-'}
                    </button>
                  </div>
                    
                    {selectedIndices.length === 2 && (
                      <p className="text-[10px] text-emerald-500 mb-2">
                        当前段落包含 {Math.abs(selectedIndices[0] - selectedIndices[1]) + 1} 个点
                      </p>
                    )}
                    
                    <label className="flex justify-between text-xs text-slate-500 mb-2">
                      <span>段落坐标点总数</span>
                      <span className="text-emerald-400">{segmentTargetCount}</span>
                    </label>
                    <input
                      type="range"
                      min="2"
                      max="200"
                      value={segmentTargetCount}
                      onChange={(e) => setSegmentTargetCount(Number(e.target.value))}
                      className="w-full accent-emerald-500 mb-3"
                    />
                    
                    <button
                      onClick={handleApplySegment}
                      disabled={selectedIndices.length !== 2}
                      className="w-full py-2 px-4 bg-slate-800 hover:bg-emerald-900/30 text-slate-300 hover:text-emerald-400 border border-slate-700 hover:border-emerald-500/50 rounded-lg transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      应用局部调整
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="p-6 flex flex-col shrink-0" style={{ height: '350px' }}>
              <div className="flex items-center justify-between mb-3 shrink-0">
                <h2 className="text-slate-200 font-semibold text-sm">导出路径数据</h2>
                <div className="flex gap-1.5">
                  <button
                    onClick={handleCopyData}
                    disabled={pathData.length === 0}
                    className="p-1.5 bg-slate-800 hover:bg-cyan-900/40 text-slate-400 hover:text-cyan-400 rounded border border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="复制数据"
                  >
                    {isCopied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                  </button>
                  <button
                    onClick={() => handleDownloadData(false)}
                    disabled={pathData.length === 0}
                    className="p-1.5 bg-slate-800 hover:bg-emerald-900/40 text-slate-400 hover:text-emerald-400 rounded border border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="仅下载 .dat 文件"
                  >
                    <FileDown size={14} />
                  </button>
                  <button
                    onClick={() => handleDownloadData(true)}
                    disabled={pathData.length === 0}
                    className="p-1.5 bg-slate-800 hover:bg-fuchsia-900/40 text-slate-400 hover:text-fuchsia-400 rounded border border-slate-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="下载 .dat 与 .png 文件"
                  >
                    <ImageDown size={14} />
                  </button>
                </div>
              </div>
              
              <div className="mb-3 flex items-center gap-2 shrink-0">
                <span className="text-xs text-slate-500 whitespace-nowrap">文件名</span>
                <input
                  type="text"
                  value={exportFilename}
                  onChange={(e) => setExportFilename(e.target.value)}
                  placeholder="path00001"
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500 transition-all"
                />
                <span className="text-xs text-slate-600">.dat</span>
              </div>
              
              <div className="flex-1 min-h-0 bg-slate-950 rounded-lg border border-slate-800 p-3 overflow-y-auto font-mono text-xs text-cyan-200/80 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                {pathData.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-slate-600 text-center">
                    暂无数据<br/>请在右侧画布绘制
                  </div>
                ) : (
                  <pre className="m-0 break-all whitespace-pre-wrap">
                    {JSON.stringify(
                      pathData.map(p => [
                        Number(p.x.toFixed(2)),
                        Number(p.y.toFixed(2)),
                        Number(p.angle.toFixed(2))
                      ])
                    )}
                  </pre>
                )}
              </div>
            </div>
          </div>
        </aside>

        {/* 中间画布区域 */}
        <div 
          ref={containerRef} 
          className="flex-1 relative bg-slate-950 overflow-hidden"
          style={{ cursor: isPanning ? 'grabbing' : mode === 'freehand' ? 'crosshair' : 'crosshair' }}
        >
          <canvas
            ref={canvasRef}
            width={containerSize.width}
            height={containerSize.height}
            onMouseDown={handlePointerDown}
            onMouseMove={handlePointerMove}
            onMouseUp={handlePointerUp}
            onMouseLeave={handlePointerUp}
            onTouchStart={handlePointerDown}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerUp}
            onTouchCancel={handlePointerUp}
            className="touch-none block" // 防止移动端滚动
          />
          
          {/* 比例提示及工具 */}
          <div className="absolute bottom-4 right-4 flex items-center gap-3">
            <div className="flex bg-slate-900/80 backdrop-blur border border-slate-800 rounded p-1">
              <button 
                onClick={() => setUserScale(1)}
                className="px-2 py-1 text-xs text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors"
                title="重置缩放"
              >
                1:1
              </button>
              <button 
                onClick={() => {
                  setUserScale(1);
                  setPanOffset({ x: 0, y: 0 });
                }}
                className="px-2 py-1 text-xs text-slate-400 hover:text-cyan-400 hover:bg-slate-800 rounded transition-colors border-l border-slate-700 ml-1"
                title="重置视图(回到中心)"
              >
                居中
              </button>
            </div>
            <div className="bg-slate-900/80 backdrop-blur border border-slate-800 px-3 py-1.5 rounded text-xs text-slate-400 font-mono pointer-events-none">
              Scale: {(scale * 100).toFixed(0)}% | Res: {resolution.width}x{resolution.height}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
