import {
  BoardSpec,
  Cell,
  Dir,
  DIR_VECTORS,
  RouteResult,
  cellKey,
  sameCell,
} from './types';

/** 校验问题：每条给出问题描述，无问题返回空数组 */
export function validateSolution(spec: BoardSpec, result: RouteResult): string[] {
  const problems: string[] = [];
  if (result.status !== 'ok' || !result.wire1 || !result.wire2) {
    problems.push('结果状态不是 ok');
    return problems;
  }
  const blockedSet = new Set(spec.blocked.map((b) => cellKey(b.r, b.c)));
  const checkWire = (
    name: string,
    cells: Cell[],
    dirs: Dir[],
    s: Cell,
    t: Cell,
    other: Cell[],
  ) => {
    if (cells.length < 2) {
      problems.push(`${name}：路径至少需要起点与终点`);
      return;
    }
    if (!sameCell(cells[0], s) || !sameCell(cells[cells.length - 1], t))
      problems.push(`${name}：路径端点与登记端点不一致`);
    if (dirs.length !== cells.length - 1)
      problems.push(`${name}：方向序列长度与路径不一致`);
    const seen = new Set<number>();
    for (let i = 0; i < cells.length; i++) {
      const p = cells[i];
      if (p.r < 0 || p.r >= spec.rows || p.c < 0 || p.c >= spec.cols)
        problems.push(`${name}：路径越界 ${p.r},${p.c}`);
      const k = cellKey(p.r, p.c);
      if (blockedSet.has(k)) problems.push(`${name}：经过禁布单元 ${p.r},${p.c}`);
      if (seen.has(k)) problems.push(`${name}：重复经过单元 ${p.r},${p.c}`);
      seen.add(k);
      if (i > 0) {
        const prev = cells[i - 1];
        const dist = Math.abs(prev.r - p.r) + Math.abs(prev.c - p.c);
        if (dist !== 1) problems.push(`${name}：第 ${i} 步不是上下左右相邻移动`);
        const expected = prev;
        const v = DIR_VECTORS[dirs[i - 1]];
        if (p.r !== expected.r + v.r || p.c !== expected.c + v.c)
          problems.push(`${name}：第 ${i} 个方向与路径不符`);
      }
    }
    for (const q of other) {
      if (seen.has(cellKey(q.r, q.c)))
        problems.push(`${name}：与另一条跳线共享单元 ${q.r},${q.c}`);
    }
  };

  checkWire('跳线1', result.wire1.cells, result.wire1.dirs, spec.wire1.s, spec.wire1.t, [
    spec.wire2.s,
    spec.wire2.t,
    ...result.wire2.cells,
  ]);
  checkWire('跳线2', result.wire2.cells, result.wire2.dirs, spec.wire2.s, spec.wire2.t, [
    spec.wire1.s,
    spec.wire1.t,
    ...result.wire1.cells,
  ]);

  // 不共享边：两线任意单元之间不得四邻接
  const set1 = new Set(result.wire1.cells.map((p) => cellKey(p.r, p.c)));
  for (const p of result.wire2.cells) {
    for (const v of Object.values(DIR_VECTORS)) {
      if (set1.has(cellKey(p.r + v.r, p.c + v.c))) {
        problems.push(
          `跳线1与跳线2在 ${p.r + v.r},${p.c + v.c} 与 ${p.r},${p.c} 之间共享边`,
        );
      }
    }
  }

  if (result.wire1.length !== result.wire1.cells.length - 1)
    problems.push('跳线1：长度字段错误');
  if (result.wire2.length !== result.wire2.cells.length - 1)
    problems.push('跳线2：长度字段错误');

  return problems;
}
