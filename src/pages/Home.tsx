import React, { useState, useRef, useEffect, useCallback } from 'react';
import { MousePointer2, MousePointerClick, PenTool, Trash2, Download, Settings, Copy, Check, Fish, Undo, Redo, FlipHorizontal, FlipVertical, Repeat, FileDown, ImageDown, Play, Square, ChevronDown, ChevronRight, Upload } from 'lucide-react';
import { Point, PathPoint, douglasPeucker, calculateAngles, bezierSpline, resamplePath, resampleSegment } from '../utils/path';

// 定义绘制模式
type DrawMode = 'freehand' | 'keypoint';

interface ImportedPath {
  id: string;
  name: string;
  data: PathPoint[];
  speed: number;
  isPlaying: boolean;
  color: string;
}

export default function Home() {
  // 画布尺寸设置
  const [resolution, setResolution] = useState({ width: 1280, height: 720 });
  const [isResolutionSettingsOpen, setIsResolutionSettingsOpen] = useState(false);
  const [isDrawSettingsOpen, setIsDrawSettingsOpen] = useState(true);
  const [isExportSettingsOpen, setIsExportSettingsOpen] = useState(true);
  const [isImportSettingsOpen, setIsImportSettingsOpen] = useState(false);
  
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
        // 如果点的数量变为 0，或者路径发生了根本改变，为了安全，重置游动进度
        if (newPoints.length === 0) {
           setIsPlaying(false);
           playProgressRef.current = 0;
        }

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
        setIsPlaying(false);
        playProgressRef.current = 0;
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
        setIsPlaying(false);
        playProgressRef.current = 0;
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
    setIsPlaying(false);
    playProgressRef.current = 0;
  };

  const handleMirrorVertical = () => {
    if (points.length === 0) return;
    const newPoints = points.map(p => ({ ...p, y: resolution.height - p.y }));
    commitPoints(newPoints);
    setIsPlaying(false);
    playProgressRef.current = 0;
  };

  const handleReverseDirection = () => {
    if (points.length === 0) return;
    const newPoints = [...points].reverse();
    commitPoints(newPoints);
    // 只要修改了路径，停止主路径的模拟游动并重置进度
    setIsPlaying(false);
    playProgressRef.current = 0;
  };

  // 局部调整状态
  const [selectedIndices, setSelectedIndices] = useState<number[]>([]);
  const [activeSelectTarget, setActiveSelectTarget] = useState<'A' | 'B' | null>(null); // 当前正在选择哪个点
  const [segmentTargetCount, setSegmentTargetCount] = useState(10);
  
  // 导出相关状态
  const [pathData, setPathData] = useState<PathPoint[]>([]);
  const [isCopied, setIsCopied] = useState(false);
  const [exportFilename, setExportFilename] = useState('path00001');

  // 模拟游动状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(10); // 游动速度（数值越大越快，1表示点到点1秒）
  const playProgressRef = useRef(0); // 当前播放进度（在 0 到 pathData.length - 1 之间）
  const lastTimeRef = useRef<number>(0);
  const animationFrameRef = useRef<number>();

  // 导入与多路径模拟状态
  const [importedPaths, setImportedPaths] = useState<ImportedPath[]>([]);
  const importedProgressesRef = useRef<Record<string, number>>({});
  
  // 处理上传的 .dat 文件
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    const newPaths: ImportedPath[] = [];
    const colors = ['#38bdf8', '#a3e635', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c'];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const text = await file.text();
        const json = JSON.parse(text);
        if (Array.isArray(json)) {
          const data: PathPoint[] = json.map((item: number[]) => ({
            x: item[0],
            y: item[1],
            angle: item[2]
          }));
          const id = Math.random().toString(36).substring(2, 9);
          newPaths.push({
            id,
            name: file.name,
            data,
            speed: 10,
            isPlaying: false,
            color: colors[Math.floor(Math.random() * colors.length)]
          });
          importedProgressesRef.current[id] = 0;
        }
      } catch (err) {
        console.error('解析文件失败:', file.name, err);
      }
    }

    setImportedPaths(prev => [...prev, ...newPaths]);
    e.target.value = ''; // reset input
  };

  const removeImportedPath = (id: string) => {
    setImportedPaths(prev => prev.filter(p => p.id !== id));
    delete importedProgressesRef.current[id];
  };

  const clearAllImportedPaths = () => {
    setImportedPaths([]);
    importedProgressesRef.current = {};
  };

  const updateImportedPath = (id: string, updates: Partial<ImportedPath>) => {
    setImportedPaths(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const playAllImportedPaths = () => {
    setImportedPaths(prev => prev.map(p => ({ ...p, isPlaying: true })));
  };

  const stopAllImportedPaths = () => {
    setImportedPaths(prev => prev.map(p => ({ ...p, isPlaying: false })));
    // 手动重置所有导入路径的进度
    Object.keys(importedProgressesRef.current).forEach(id => {
      importedProgressesRef.current[id] = 0;
    });
    draw(); // 强制重绘让鱼回到起点
  };

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

    // 绘制游动的模拟鱼
    if (isPlaying && pathData.length > 1) {
      const progress = playProgressRef.current;
      const index = Math.floor(progress);
      const nextIndex = Math.min(index + 1, pathData.length - 1);
      const t = progress - index; // 在两点之间的进度 (0 ~ 1)

      const p1 = pathData[index];
      const p2 = pathData[nextIndex];

      // 增加安全校验，防止因渲染帧过快导致的越界问题
      if (p1 && p2 && typeof p1.x === 'number' && typeof p2.x === 'number') {
        // 线性插值计算当前位置和角度
        const currentX = p1.x + (p2.x - p1.x) * t;
        const currentY = p1.y + (p2.y - p1.y) * t;
        
        // 处理角度的插值（考虑到 360 度循环的情况）
        let a1 = p1.angle;
        let a2 = p2.angle;
        let diff = a2 - a1;
        while (diff < -180) diff += 360;
        while (diff > 180) diff -= 360;
        const currentAngle = a1 + diff * t;

        // 绘制鱼本体
        ctx.save();
        ctx.translate(currentX, currentY);
        // Canvas 翻转系下，角度取反
        ctx.rotate(-currentAngle * (Math.PI / 180));
        
        // 发光外圈
        ctx.beginPath();
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 15 / scale;
        ctx.fillStyle = '#fbbf24';
        
        // 画一个简单的鱼的形状（水滴状/椭圆）
        ctx.ellipse(0, 0, 15 / scale, 8 / scale, 0, 0, Math.PI * 2);
        ctx.fill();
        
        // 画鱼尾巴
        ctx.beginPath();
        ctx.moveTo(-10 / scale, 0);
        ctx.lineTo(-20 / scale, -8 / scale);
        ctx.lineTo(-20 / scale, 8 / scale);
        ctx.closePath();
        ctx.fill();
        
        // 清除发光画眼睛
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(8 / scale, -3 / scale, 2 / scale, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.restore();
      }
    }

    // 绘制导入的多条路径和模拟鱼
    importedPaths.forEach(ip => {
      if (ip.data.length < 2) return;

      // 绘制路径线条
      ctx.beginPath();
      ctx.shadowColor = ip.color;
      ctx.shadowBlur = 5 / scale;
      ctx.strokeStyle = ip.color;
      ctx.lineWidth = 2 / scale;
      ctx.globalAlpha = 0.5; // 让导入的路径半透明
      
      ctx.moveTo(ip.data[0].x, ip.data[0].y);
      for (let i = 1; i < ip.data.length; i++) {
        ctx.lineTo(ip.data[i].x, ip.data[i].y);
      }
      ctx.stroke();
      ctx.globalAlpha = 1.0;
      ctx.shadowBlur = 0;

      // 绘制导入路径上的模拟鱼
      if (ip.isPlaying && ip.data && ip.data.length > 1) {
        const progress = importedProgressesRef.current[ip.id] || 0;
        const index = Math.floor(progress);
        const nextIndex = Math.min(index + 1, ip.data.length - 1);
        const t = progress - index;

        const p1 = ip.data[index];
        const p2 = ip.data[nextIndex];

        // 增加安全校验，防止异常数据导致 p1 或 p2 为 undefined 报错
        if (p1 && p2 && typeof p1.x === 'number' && typeof p2.x === 'number') {
          const currentX = p1.x + (p2.x - p1.x) * t;
          const currentY = p1.y + (p2.y - p1.y) * t;
          
          let a1 = p1.angle;
          let a2 = p2.angle;
          let diff = a2 - a1;
          while (diff < -180) diff += 360;
          while (diff > 180) diff -= 360;
          const currentAngle = a1 + diff * t;

          ctx.save();
          ctx.translate(currentX, currentY);
          ctx.rotate(-currentAngle * (Math.PI / 180));
          
          ctx.beginPath();
          ctx.shadowColor = ip.color;
          ctx.shadowBlur = 15 / scale;
          ctx.fillStyle = ip.color;
          
          ctx.ellipse(0, 0, 15 / scale, 8 / scale, 0, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.beginPath();
          ctx.moveTo(-10 / scale, 0);
          ctx.lineTo(-20 / scale, -8 / scale);
          ctx.lineTo(-20 / scale, 8 / scale);
          ctx.closePath();
          ctx.fill();
          
          ctx.shadowBlur = 0;
          ctx.fillStyle = '#000';
          ctx.beginPath();
          ctx.arc(8 / scale, -3 / scale, 2 / scale, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.restore();
        }
      }
    });

    ctx.restore();

  }, [points, tempPoints, pathData, containerSize, resolution, scale, offsetX, offsetY, selectedIndices, activeSelectTarget, isPlaying, importedPaths]);

  // 为了能在 requestAnimationFrame 回调中获取最新状态而不重新绑定
  const stateRef = useRef({ isPlaying, playSpeed, pathDataLength: pathData.length, importedPaths });
  useEffect(() => {
    stateRef.current = { isPlaying, playSpeed, pathDataLength: pathData.length, importedPaths };
  }, [isPlaying, playSpeed, pathData.length, importedPaths]);

  // 处理游动动画帧
  const animatePlay = useCallback((time: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = time;
    const deltaTime = (time - lastTimeRef.current) / 1000; // 转换为秒
    lastTimeRef.current = time;

    const state = stateRef.current;

    // 更新主路径鱼的进度
    if (state.isPlaying) {
      const progressDelta = deltaTime * state.playSpeed;
      playProgressRef.current += progressDelta;
      if (playProgressRef.current >= state.pathDataLength - 1) {
        playProgressRef.current = 0;
      }
    }

    // 更新导入路径鱼的进度
    state.importedPaths.forEach(ip => {
      if (ip.isPlaying && ip.data && ip.data.length > 1) {
        if (importedProgressesRef.current[ip.id] === undefined) {
          importedProgressesRef.current[ip.id] = 0;
        }
        importedProgressesRef.current[ip.id] += deltaTime * ip.speed;
        if (importedProgressesRef.current[ip.id] >= ip.data.length - 1) {
          importedProgressesRef.current[ip.id] = 0;
        }
      }
    });

    draw(); // 强制触发重绘
    animationFrameRef.current = requestAnimationFrame(animatePlay);
  }, [draw]);

  useEffect(() => {
    const hasAnyPlaying = isPlaying || importedPaths.some(p => p.isPlaying);
    
    if (hasAnyPlaying) {
      lastTimeRef.current = performance.now();
      if (animationFrameRef.current === undefined) {
        animationFrameRef.current = requestAnimationFrame(animatePlay);
      }
    } else {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
      
      // 停止时重置主路径进度，使其下一次从头开始
      if (!isPlaying) {
        playProgressRef.current = 0;
      }
      // 停止时重置所有未在播放的导入路径进度
      importedPaths.forEach(ip => {
        if (!ip.isPlaying) {
          importedProgressesRef.current[ip.id] = 0;
        }
      });
      
      draw(); // 恢复静止状态的重绘
    }
    return () => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [isPlaying, importedPaths, animatePlay, draw]);

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

    if (activeSelectTarget) {
      // 在任何模式下，只要激活了选点按钮 (A 或 B) 时，才响应画布上的点选
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
    } else if (mode === 'freehand') {
      setIsDrawing(true);
      setTempPoints([pos]);
      setSelectedIndices([]); // 自由画线时清空选择
      setActiveSelectTarget(null);
    } else if (mode === 'keypoint') {
      commitPoints(prev => [...prev, pos]);
      setSelectedIndices([]);
      setActiveSelectTarget(null);
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
    setIsPlaying(false);
    playProgressRef.current = 0;
  };

  const handleApplySegment = () => {
    if (selectedIndices.length === 2) {
      const newPoints = resampleSegment(points, selectedIndices[0], selectedIndices[1], segmentTargetCount);
      commitPoints(newPoints);
      setSelectedIndices([]);
      setIsPlaying(false);
      playProgressRef.current = 0;
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
              onClick={() => { setMode('freehand'); setSelectedIndices([]); setActiveSelectTarget(null); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md transition-all ${
                mode === 'freehand' ? 'bg-cyan-900/50 text-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <PenTool size={16} />
              <span className="text-sm font-medium">自由画线</span>
            </button>
            <button
              onClick={() => { setMode('keypoint'); setSelectedIndices([]); setActiveSelectTarget(null); }}
              className={`flex items-center gap-2 px-4 py-1.5 rounded-md transition-all ${
                mode === 'keypoint' ? 'bg-cyan-900/50 text-cyan-400 shadow-[0_0_10px_rgba(0,255,255,0.2)]' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <MousePointer2 size={16} />
              <span className="text-sm font-medium">坐标点</span>
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
            <div className="border-b border-slate-800 shrink-0 flex flex-col">
              <button 
                onClick={() => setIsImportSettingsOpen(!isImportSettingsOpen)}
                className="w-full p-6 flex items-center justify-between text-slate-200 font-semibold hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Upload size={18} className="text-pink-500" />
                  <h2>导入与多路径模拟</h2>
                </div>
                {isImportSettingsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>
              
              {isImportSettingsOpen && (
                <div className="px-6 pb-6 flex flex-col flex-1 min-h-[200px]">
                  <label className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-slate-800 hover:bg-pink-900/30 text-slate-300 hover:text-pink-400 border border-slate-700 hover:border-pink-500/50 rounded-lg transition-colors text-xs cursor-pointer mb-4 shrink-0">
                    <Upload size={14} />
                    <span>上传 .dat 路径文件 (支持多选)</span>
                    <input 
                      type="file" 
                      accept=".dat" 
                      multiple 
                      onChange={handleFileUpload}
                      className="hidden" 
                    />
                  </label>

                  <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent pr-2">
                    {importedPaths.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center mt-4">暂无导入的路径</p>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2 mb-2 bg-slate-800/50 p-2 rounded border border-slate-700/50">
                          <span className="text-xs text-slate-400">全部操作：</span>
                          <div className="flex gap-2">
                            <button
                              onClick={playAllImportedPaths}
                              className="p-1.5 bg-amber-900/40 hover:bg-amber-900/60 text-amber-400 rounded transition-colors"
                              title="全部开始"
                            >
                              <Play size={12} />
                            </button>
                            <button
                              onClick={stopAllImportedPaths}
                              className="p-1.5 bg-rose-900/40 hover:bg-rose-900/60 text-rose-400 rounded transition-colors"
                              title="全部停止"
                            >
                              <Square size={12} />
                            </button>
                            <button
                              onClick={clearAllImportedPaths}
                              className="p-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded transition-colors ml-2"
                              title="全部删除"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                        {importedPaths.map(ip => (
                          <div key={ip.id} className="bg-slate-950 border border-slate-800 rounded p-3">
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: ip.color }}></div>
                                <span className="text-xs text-slate-300 truncate" title={ip.name}>{ip.name}</span>
                              </div>
                              <button 
                                onClick={() => removeImportedPath(ip.id)}
                                className="text-slate-500 hover:text-red-400 transition-colors shrink-0 ml-2"
                                title="删除"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                            
                            <div className="flex items-center gap-3">
                              <div className="flex-1">
                                <label className="flex justify-between text-[10px] text-slate-500 mb-1">
                                  <span>速度</span>
                                  <span className="text-amber-400">{ip.speed}</span>
                                </label>
                                <input
                                  type="range"
                                  min="1"
                                  max="100"
                                  step="1"
                                  value={ip.speed}
                                  onChange={(e) => updateImportedPath(ip.id, { speed: Number(e.target.value) })}
                                  className="w-full accent-amber-500 h-1"
                                />
                              </div>
                              
                              <button
                                onClick={() => {
                                  if (ip.isPlaying) {
                                    importedProgressesRef.current[ip.id] = 0;
                                  }
                                  updateImportedPath(ip.id, { isPlaying: !ip.isPlaying });
                                }}
                                className={`shrink-0 p-1.5 rounded transition-colors ${
                                  ip.isPlaying 
                                    ? 'bg-rose-900/40 text-rose-400 hover:bg-rose-900/60' 
                                    : 'bg-amber-900/40 text-amber-400 hover:bg-amber-900/60'
                                }`}
                                title={ip.isPlaying ? "停止模拟" : "开始模拟"}
                              >
                                {ip.isPlaying ? <Square size={12} /> : <Play size={12} />}
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="border-b border-slate-800 shrink-0">
              <button 
                onClick={() => setIsResolutionSettingsOpen(!isResolutionSettingsOpen)}
                className="w-full p-6 flex items-center justify-between text-slate-200 font-semibold hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Settings size={18} className="text-cyan-500" />
                  <h2>画布设置</h2>
                </div>
                {isResolutionSettingsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>
              
              {isResolutionSettingsOpen && (
                <div className="px-6 pb-6 space-y-4">
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
              )}
            </div>

            <div className="border-b border-slate-800 shrink-0">
              <button 
                onClick={() => setIsDrawSettingsOpen(!isDrawSettingsOpen)}
                className="w-full p-6 flex items-center justify-between text-slate-200 font-semibold hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <PenTool size={18} className="text-emerald-500" />
                  <h2>绘制与调整</h2>
                </div>
                {isDrawSettingsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>
              
              {isDrawSettingsOpen && (
                <div className="px-6 pb-6 space-y-5">
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

                  <div className="pt-4 border-t border-slate-800">
                    <h3 className="text-xs text-slate-400 mb-2">模拟游动</h3>
                    <label className="flex justify-between text-xs text-slate-500 mb-2">
                      <span>游动速度</span>
                      <span className="text-amber-400">{playSpeed}</span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="100"
                      step="1"
                      value={playSpeed}
                      onChange={(e) => setPlaySpeed(Number(e.target.value))}
                      className="w-full accent-amber-500 mb-3"
                    />
                    <p className="text-[10px] text-slate-600 mb-3 leading-relaxed">
                      * 速度为 1 表示游过相邻两点耗时 1 秒。值为 10 表示耗时 1/10 秒。
                    </p>
                    <button
                      onClick={() => {
                        if (isPlaying) {
                          playProgressRef.current = 0;
                        }
                        setIsPlaying(!isPlaying);
                      }}
                      disabled={pathData.length < 2}
                      className={`w-full flex items-center justify-center gap-2 py-2 px-4 border rounded-lg transition-colors text-xs disabled:opacity-50 disabled:cursor-not-allowed ${
                        isPlaying 
                          ? 'bg-rose-900/40 text-rose-400 border-rose-500/50 hover:bg-rose-900/60' 
                          : 'bg-amber-900/40 text-amber-400 border-amber-500/50 hover:bg-amber-900/60'
                      }`}
                    >
                      {isPlaying ? (
                        <>
                          <Square size={14} />
                          <span>停止模拟</span>
                        </>
                      ) : (
                        <>
                          <Play size={14} />
                          <span>开始模拟</span>
                        </>
                      )}
                    </button>
                  </div>

                  <div className="pt-4 border-t border-slate-800">
                    <h3 className="text-xs text-slate-400 mb-2">局部区域调整</h3>
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
                        当前区域包含 {Math.abs(selectedIndices[0] - selectedIndices[1]) + 1} 个点
                      </p>
                    )}
                    
                    <label className="flex justify-between text-xs text-slate-500 mb-2">
                      <span>区域坐标点总数</span>
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
                </div>
              )}
            </div>

            <div className="border-b border-slate-800 shrink-0">
              <button 
                onClick={() => setIsExportSettingsOpen(!isExportSettingsOpen)}
                className="w-full p-6 flex items-center justify-between text-slate-200 font-semibold hover:bg-slate-800/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Download size={18} className="text-amber-500" />
                  <h2>导出路径数据</h2>
                </div>
                {isExportSettingsOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
              </button>
              
              {isExportSettingsOpen && (
                <div className="px-6 pb-6">
                  <div className="flex items-center justify-between mb-3 shrink-0">
                    <div className="flex gap-1.5 w-full justify-end">
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

                  <div className="flex items-center gap-2 mb-3 shrink-0">
                    <label className="text-xs text-slate-500 whitespace-nowrap">文件名</label>
                    <input
                      type="text"
                      value={exportFilename}
                      onChange={(e) => setExportFilename(e.target.value)}
                      placeholder="path00001"
                      className="flex-1 bg-slate-950 border border-slate-700 rounded p-1.5 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                    />
                    <span className="text-xs text-slate-500">.dat</span>
                  </div>

                  <div className="bg-slate-950 rounded border border-slate-800 p-3 overflow-y-auto flex-1 min-h-[150px] max-h-[300px] scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                    {pathData.length === 0 ? (
                      <p className="text-slate-500 text-sm text-center mt-10">暂无数据</p>
                    ) : (
                      <pre className="text-[10px] text-cyan-300 font-mono break-all whitespace-pre-wrap">
                        {JSON.stringify(pathData.map(p => [Number(p.x.toFixed(2)), Number(p.y.toFixed(2)), Number(p.angle.toFixed(2))]))}
                      </pre>
                    )}
                  </div>
                </div>
              )}
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
