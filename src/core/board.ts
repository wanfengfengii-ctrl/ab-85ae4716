import { BoardSpec, Cell, RoutedWire, cellKey } from './types';

/** 板上单元的展示/统计归属类型 */
export type CellKind =
  | 'free'
  | 'blocked'
  | 's1'
  | 't1'
  | 's2'
  | 't2'
  | 'wire1'
  | 'wire2';

/** 生成单元 -> 归属 的查表（含端点），路径单元优先级低于端点 */
export function buildCellMap(
  spec: BoardSpec,
  wire1?: RoutedWire,
  wire2?: RoutedWire,
): Map<number, CellKind> {
  const map = new Map<number, CellKind>();
  for (const b of spec.blocked) map.set(cellKey(b.r, b.c), 'blocked');
  const put = (p: Cell, k: CellKind) => map.set(cellKey(p.r, p.c), k);
  put(spec.wire1.s, 's1');
  put(spec.wire1.t, 't1');
  put(spec.wire2.s, 's2');
  put(spec.wire2.t, 't2');
  const fillWire = (wire: RoutedWire | undefined, k: CellKind) => {
    if (!wire) return;
    for (const p of wire.cells) {
      const key = cellKey(p.r, p.c);
      if (!map.has(key)) map.set(key, k);
    }
  };
  fillWire(wire1, 'wire1');
  fillWire(wire2, 'wire2');
  return map;
}

/** 未使用区域：非禁布且未被任一跳线（含端点）占用的单元 */
export function unusedCells(
  spec: BoardSpec,
  wire1?: RoutedWire,
  wire2?: RoutedWire,
): Cell[] {
  const used = buildCellMap(spec, wire1, wire2);
  const out: Cell[] = [];
  for (let r = 0; r < spec.rows; r++) {
    for (let c = 0; c < spec.cols; c++) {
      const k = cellKey(r, c);
      const kind = used.get(k);
      if (kind === undefined) out.push({ r, c });
    }
  }
  return out;
}
