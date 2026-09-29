/** 核心数据类型：方格板、端点对、联合布线解 */

/** 方向：上下左右（按登记顺序展开方向序列时使用） */
export type Dir = 'U' | 'D' | 'L' | 'R';

export interface Cell {
  r: number;
  c: number;
}

/** 一对跳线端点（登记顺序即 wire1 -> wire2，优化顺序敏感） */
export interface WireEndpoints {
  /** 起点 */
  s: Cell;
  /** 终点 */
  t: Cell;
}

export interface BoardSpec {
  rows: number; // 6..10
  cols: number; // 6..10
  /** 禁布单元集合，"r,c" 形式 */
  blocked: Cell[];
  wire1: WireEndpoints;
  wire2: WireEndpoints;
}

export interface RoutedWire {
  /** 路径经过的全部单元（含起终点），不重复 */
  cells: Cell[];
  /** 路径长度：经过的边数 = cells.length - 1 */
  length: number;
  /** 按登记顺序（从起点出发）展开的方向序列 */
  dirs: Dir[];
}

export type RouteStatus = 'ok' | 'infeasible' | 'timeout';

export interface RouteResult {
  status: RouteStatus;
  wire1?: RoutedWire;
  wire2?: RoutedWire;
}

export const DIR_VECTORS: Record<Dir, Cell> = {
  U: { r: -1, c: 0 },
  D: { r: 1, c: 0 },
  L: { r: 0, c: -1 },
  R: { r: 0, c: 1 },
};

/** 方向序列的字典序：U < D < L < R（固定全序即可，保证唯一的最小方向序列） */
export const DIR_ORDER: Dir[] = ['U', 'D', 'L', 'R'];

export function cellKey(r: number, c: number): number {
  return r * 100 + c;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.r === b.r && a.c === b.c;
}

export function manhattan(a: Cell, b: Cell): number {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
}

/** 统计 board 上可用（非禁布）单元数 */
export function countFreeCells(rows: number, cols: number, blocked: ReadonlySet<number>): number {
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!blocked.has(cellKey(r, c))) n++;
    }
  }
  return n;
}
