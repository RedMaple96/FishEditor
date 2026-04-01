/**
 * 路径与数学计算工具
 */

export interface Point {
  x: number;
  y: number;
}

export interface PathPoint extends Point {
  angle: number;
}

/**
 * 计算两点之间的距离
 */
export function getDistance(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Ramer-Douglas-Peucker 算法：用于对自由绘制的路径进行抽稀平滑
 * @param points 原始点集
 * @param epsilon 容差（平滑度，值越大越平滑但失真越多）
 * @returns 抽稀后的点集
 */
export function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) {
    return points;
  }

  let dmax = 0;
  let index = 0;
  const end = points.length - 1;

  for (let i = 1; i < end; i++) {
    const d = pointLineDistance(points[i], points[0], points[end]);
    if (d > dmax) {
      index = i;
      dmax = d;
    }
  }

  if (dmax > epsilon) {
    const recResults1 = douglasPeucker(points.slice(0, index + 1), epsilon);
    const recResults2 = douglasPeucker(points.slice(index, end + 1), epsilon);
    return recResults1.slice(0, -1).concat(recResults2);
  } else {
    return [points[0], points[end]];
  }
}

/**
 * 计算点到线段的距离
 */
function pointLineDistance(p: Point, p1: Point, p2: Point): number {
  const A = p.x - p1.x;
  const B = p.y - p1.y;
  const C = p2.x - p1.x;
  const D = p2.y - p1.y;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;

  let param = -1;
  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;
  if (param < 0) {
    xx = p1.x;
    yy = p1.y;
  } else if (param > 1) {
    xx = p2.x;
    yy = p2.y;
  } else {
    xx = p1.x + param * C;
    yy = p1.y + param * D;
  }

  const dx = p.x - xx;
  const dy = p.y - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * 对路径的指定段落进行重新采样（增加或减少坐标点）
 * @param points 完整路径点
 * @param startIndex 起始索引
 * @param endIndex 结束索引
 * @param targetCount 目标总点数（包含起止点）
 * @param smooth 平滑系数
 */
export function resampleSegment(points: Point[], startIndex: number, endIndex: number, targetCount: number, smooth: number = 0.35): Point[] {
  const start = Math.min(startIndex, endIndex);
  const end = Math.max(startIndex, endIndex);

  if (points.length < 2 || start >= end || targetCount < 2) return points;

  // 1. 获取完整的贝塞尔控制点信息，以保证曲率连续性
  const controls: { cp1: Point, cp2: Point }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 === points.length ? i + 1 : i + 2];

    const d01 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
    const d12 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    const d23 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

    let cp1x = p1.x; let cp1y = p1.y;
    let cp2x = p2.x; let cp2y = p2.y;

    if (d01 + d12 > 0) {
      const fa = smooth * d12 / (d01 + d12);
      cp1x = p1.x + (p2.x - p0.x) * fa;
      cp1y = p1.y + (p2.y - p0.y) * fa;
    }
    if (d12 + d23 > 0) {
      const fb = smooth * d12 / (d12 + d23);
      cp2x = p2.x - (p3.x - p1.x) * fb;
      cp2y = p2.y - (p3.y - p1.y) * fb;
    }

    if (i === 0) {
      cp1x = p1.x + (p2.x - p1.x) * smooth;
      cp1y = p1.y + (p2.y - p1.y) * smooth;
    }
    if (i === points.length - 2) {
      cp2x = p2.x - (p2.x - p1.x) * smooth;
      cp2y = p2.y - (p2.y - p1.y) * smooth;
    }

    controls.push({ cp1: { x: cp1x, y: cp1y }, cp2: { x: cp2x, y: cp2y } });
  }

  // 2. 将指定段落离散化为大量微小线段，用于计算弧长参数化
  const segments: { pt: Point, dist: number, accumDist: number, segIdx: number, t: number }[] = [];
  let totalLength = 0;
  
  for (let i = start; i < end; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const { cp1, cp2 } = controls[i];
    
    let lastPt = p1;
    const samples = 100;
    for (let j = 1; j <= samples; j++) {
      const t = j / samples;
      const pt = getBezierPoint(p1, cp1, cp2, p2, t);
      const d = Math.sqrt(Math.pow(pt.x - lastPt.x, 2) + Math.pow(pt.y - lastPt.y, 2));
      totalLength += d;
      segments.push({ pt, dist: d, accumDist: totalLength, segIdx: i, t });
      lastPt = pt;
    }
  }

  // 3. 基于弧长均匀插入新点
  const newSegmentPoints: Point[] = [points[start]];
  const stepLength = totalLength / (targetCount - 1);
  
  let currentTargetDist = stepLength;
  let segIndex = 0;

  for (let i = 1; i < targetCount - 1; i++) {
    while (segIndex < segments.length && segments[segIndex].accumDist < currentTargetDist) {
      segIndex++;
    }
    
    if (segIndex >= segments.length) break;

    const seg = segments[segIndex];
    const prevSeg = segIndex > 0 ? segments[segIndex - 1] : { pt: points[start], accumDist: 0 };
    
    const remain = currentTargetDist - prevSeg.accumDist;
    const ratio = seg.dist > 0 ? remain / seg.dist : 0;
    
    newSegmentPoints.push({
      x: prevSeg.pt.x + (seg.pt.x - prevSeg.pt.x) * ratio,
      y: prevSeg.pt.y + (seg.pt.y - prevSeg.pt.y) * ratio
    });

    currentTargetDist += stepLength;
  }

  // 保留终点
  newSegmentPoints.push(points[end]);

  // 4. 拼接完整路径
  return [
    ...points.slice(0, start),
    ...newSegmentPoints,
    ...points.slice(end + 1)
  ];
}

/**
 * 计算路径中每个点的旋转角度（基于相邻点的切线）
 * 注意：在我们的坐标系中，Y轴向上为正。
 * @param points 路径坐标点
 * @returns 包含角度的路径点集
 */
export function calculateAngles(points: Point[]): PathPoint[] {
  if (points.length === 0) return [];
  if (points.length === 1) return [{ ...points[0], angle: 0 }];

  return points.map((p, i) => {
    let dx = 0;
    let dy = 0;

    if (i === 0) {
      // 起点：使用下一个点
      dx = points[1].x - p.x;
      dy = points[1].y - p.y;
    } else if (i === points.length - 1) {
      // 终点：使用上一个点
      dx = p.x - points[i - 1].x;
      dy = p.y - points[i - 1].y;
    } else {
      // 中间点：使用前后点的差值（中心差分）
      dx = points[i + 1].x - points[i - 1].x;
      dy = points[i + 1].y - points[i - 1].y;
    }

    // Math.atan2 范围为 -PI 到 PI，将其转换为 0-360 度
    // 因为现在 Y轴是向上的正坐标，所以我们直接取反 dy 的符号来获得与传统计算机视觉相同的角度定义（向下为正，顺时针增加）
    // 或者，如果我们希望按照数学系（逆时针为正），则不需要取反。这里我们保持输出数据的角度与视觉一致：
    // 即当鱼头朝向右下角时，角度为正值（顺时针）
    let angle = Math.atan2(-dy, dx) * (180 / Math.PI);
    if (angle < 0) {
      angle += 360;
    }

    return { ...p, angle };
  });
}

/**
 * 贝塞尔曲线长度和采样辅助函数
 */
function getBezierPoint(p0: Point, cp1: Point, cp2: Point, p3: Point, t: number): Point {
  const t1 = 1 - t;
  const t1_2 = t1 * t1;
  const t1_3 = t1_2 * t1;
  const t2 = t * t;
  const t3 = t2 * t;

  return {
    x: t1_3 * p0.x + 3 * t1_2 * t * cp1.x + 3 * t1 * t2 * cp2.x + t3 * p3.x,
    y: t1_3 * p0.y + 3 * t1_2 * t * cp1.y + 3 * t1 * t2 * cp2.y + t3 * p3.y
  };
}

/**
 * 在现有的贝塞尔曲线上均匀插值（增加关键点）
 * @param points 原始关键点
 * @param count 要增加的点数
 * @param smooth 平滑系数
 * @returns 包含新增点的完整关键点集合
 */
export function resamplePath(points: Point[], addCount: number, smooth: number = 0.35): Point[] {
  if (points.length < 2 || addCount <= 0) return points;

  // 1. 获取完整的贝塞尔控制点信息
  const controls: { cp1: Point, cp2: Point }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 === points.length ? i + 1 : i + 2];

    const d01 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
    const d12 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    const d23 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

    let cp1x = p1.x; let cp1y = p1.y;
    let cp2x = p2.x; let cp2y = p2.y;

    if (d01 + d12 > 0) {
      const fa = smooth * d12 / (d01 + d12);
      cp1x = p1.x + (p2.x - p0.x) * fa;
      cp1y = p1.y + (p2.y - p0.y) * fa;
    }
    if (d12 + d23 > 0) {
      const fb = smooth * d12 / (d12 + d23);
      cp2x = p2.x - (p3.x - p1.x) * fb;
      cp2y = p2.y - (p3.y - p1.y) * fb;
    }

    if (i === 0) {
      cp1x = p1.x + (p2.x - p1.x) * smooth;
      cp1y = p1.y + (p2.y - p1.y) * smooth;
    }
    if (i === points.length - 2) {
      cp2x = p2.x - (p2.x - p1.x) * smooth;
      cp2y = p2.y - (p2.y - p1.y) * smooth;
    }

    controls.push({ cp1: { x: cp1x, y: cp1y }, cp2: { x: cp2x, y: cp2y } });
  }

  // 2. 将整条路径离散化为大量微小线段，用于计算弧长参数化
  const segments: { pt: Point, dist: number, accumDist: number, segIdx: number, t: number }[] = [];
  let totalLength = 0;
  
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const { cp1, cp2 } = controls[i];
    
    let lastPt = p1;
    // 采用固定高密度采样（每段100步）来估算弧长
    const samples = 100;
    for (let j = 1; j <= samples; j++) {
      const t = j / samples;
      const pt = getBezierPoint(p1, cp1, cp2, p2, t);
      const d = Math.sqrt(Math.pow(pt.x - lastPt.x, 2) + Math.pow(pt.y - lastPt.y, 2));
      totalLength += d;
      segments.push({ pt, dist: d, accumDist: totalLength, segIdx: i, t });
      lastPt = pt;
    }
  }

  // 3. 基于弧长均匀插入新点
  const result: Point[] = [points[0]]; // 保留起点
  const targetCount = points.length + addCount;
  const stepLength = totalLength / (targetCount - 1);
  
  let currentTargetDist = stepLength;
  let segIndex = 0;

  for (let i = 1; i < targetCount - 1; i++) {
    // 找到刚好超过目标距离的线段
    while (segIndex < segments.length && segments[segIndex].accumDist < currentTargetDist) {
      segIndex++;
    }
    
    if (segIndex >= segments.length) break;

    const seg = segments[segIndex];
    const prevSeg = segIndex > 0 ? segments[segIndex - 1] : { pt: points[0], accumDist: 0 };
    
    // 线性插值估算精确坐标
    const remain = currentTargetDist - prevSeg.accumDist;
    const ratio = seg.dist > 0 ? remain / seg.dist : 0;
    
    result.push({
      x: prevSeg.pt.x + (seg.pt.x - prevSeg.pt.x) * ratio,
      y: prevSeg.pt.y + (seg.pt.y - prevSeg.pt.y) * ratio
    });

    currentTargetDist += stepLength;
  }

  // 保留终点
  result.push(points[points.length - 1]);
  return result;
}

/**
 * 贝塞尔曲线平滑算法：生成一条经过所有关键点、具有全局自然曲率的平滑路径。
 * 通过计算控制点，将一系列线段转化为平滑相切的三阶贝塞尔曲线。
 * 
 * @param points 关键点
 * @param smooth 曲线的平滑系数 (0-1之间，默认 0.35)
 * @param steps 每段贝塞尔曲线的插值点数
 * @returns 平滑插值后的点集
 */
export function bezierSpline(points: Point[], smooth: number = 0.35, steps: number = 50): Point[] {
  if (points.length < 2) return points;
  if (points.length === 2) {
    // 只有两个点时退化为直线插值
    const result: Point[] = [];
    for (let t = 0; t <= 1; t += 1 / steps) {
      result.push({
        x: points[0].x + (points[1].x - points[0].x) * t,
        y: points[0].y + (points[1].y - points[0].y) * t
      });
    }
    return result;
  }

  const curvePoints: Point[] = [];
  const controls: { cp1: Point, cp2: Point }[] = [];

  // 1. 计算每个点的控制点
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 === points.length ? i + 1 : i + 2];

    // 计算相邻线段的长度
    const d01 = Math.sqrt(Math.pow(p1.x - p0.x, 2) + Math.pow(p1.y - p0.y, 2));
    const d12 = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    const d23 = Math.sqrt(Math.pow(p3.x - p2.x, 2) + Math.pow(p3.y - p2.y, 2));

    // 计算控制点的偏移向量
    let cp1x = p1.x;
    let cp1y = p1.y;
    let cp2x = p2.x;
    let cp2y = p2.y;

    if (d01 + d12 > 0) {
      // p1 的前向控制点
      const fa = smooth * d12 / (d01 + d12);
      cp1x = p1.x + (p2.x - p0.x) * fa;
      cp1y = p1.y + (p2.y - p0.y) * fa;
    }
    
    if (d12 + d23 > 0) {
      // p2 的后向控制点
      const fb = smooth * d12 / (d12 + d23);
      cp2x = p2.x - (p3.x - p1.x) * fb;
      cp2y = p2.y - (p3.y - p1.y) * fb;
    }

    // 边界条件处理：起点和终点的控制点
    if (i === 0) {
      cp1x = p1.x + (p2.x - p1.x) * smooth;
      cp1y = p1.y + (p2.y - p1.y) * smooth;
    }
    if (i === points.length - 2) {
      cp2x = p2.x - (p2.x - p1.x) * smooth;
      cp2y = p2.y - (p2.y - p1.y) * smooth;
    }

    controls.push({ cp1: { x: cp1x, y: cp1y }, cp2: { x: cp2x, y: cp2y } });
  }

  // 2. 生成贝塞尔曲线上的点
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const { cp1, cp2 } = controls[i];

    // 根据两点间距离动态调整步数
    const dist = Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
    const dynamicSteps = Math.max(steps, Math.floor(dist)); // 每像素至少1个点

    for (let t = 0; t <= 1; t += 1 / dynamicSteps) {
      const t1 = 1 - t;
      const t1_2 = t1 * t1;
      const t1_3 = t1_2 * t1;
      const t2 = t * t;
      const t3 = t2 * t;

      // 三阶贝塞尔公式
      const x = t1_3 * p1.x + 3 * t1_2 * t * cp1.x + 3 * t1 * t2 * cp2.x + t3 * p2.x;
      const y = t1_3 * p1.y + 3 * t1_2 * t * cp1.y + 3 * t1 * t2 * cp2.y + t3 * p2.y;

      // 避免重复推入点
      if (curvePoints.length === 0 || 
          Math.abs(curvePoints[curvePoints.length - 1].x - x) > 0.1 || 
          Math.abs(curvePoints[curvePoints.length - 1].y - y) > 0.1) {
        curvePoints.push({ x, y });
      }
    }
  }

  // 确保最后一个点一定被包含
  curvePoints.push(points[points.length - 1]);
  return curvePoints;
}
