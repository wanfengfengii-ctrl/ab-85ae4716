import { describe, expect, it } from 'vitest';
import { BoardSpec, Cell, Dir, DIR_ORDER, DIR_VECTORS, cellKey, manhattan } from './types';
import { JointRouter, routeJoint } from './router';
import { validateSolution } from './validate';
import { INFEASIBLE_BOARD, SMOKE_BOARD } from './fixtures';

/** 暴力枚举：对小规模板枚举两条全部简单路径，按目标序求最优，作为对拍预言机 */
function bruteForce(spec: BoardSpec) {
  const { rows, cols, blocked } = spec;
  const bset = new Set(blocked.map((b) => cellKey(b.r, b.c)));
  const key = (p: Cell) => cellKey(p.r, p.c);
  const adj = (a: Cell, b: Cell) =>
    Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;

  function allPaths(s: Cell, t: Cell): Cell[][] {
    const paths: Cell[][] = [];
    const seen = new Set<number>([key(s)]);
    const cur: Cell[] = [s];
    const cap = rows * cols;
    const dfs = () => {
      const p = cur[cur.length - 1];
      if (p.r === t.r && p.c === t.c) {
        paths.push(cur.slice());
        return;
      }
      if (cur.length >= cap) return;
      for (const v of Object.values(DIR_VECTORS)) {
        const n = { r: p.r + v.r, c: p.c + v.c };
        if (n.r < 0 || n.r >= rows || n.c < 0 || n.c >= cols) continue;
        const k = key(n);
        if (bset.has(k) || seen.has(k)) continue;
        seen.add(k);
        cur.push(n);
        dfs();
        cur.pop();
        seen.delete(k);
      }
    };
    dfs();
    return paths;
  }

  const dirsOf = (cells: Cell[]): Dir[] => {
    const out: Dir[] = [];
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1];
      const b = cells[i];
      const d = DIR_ORDER.find(
        (x) => a.r + DIR_VECTORS[x].r === b.r && a.c + DIR_VECTORS[x].c === b.c,
      )!;
      out.push(d);
    }
    return out;
  };

  const p1 = allPaths(spec.wire1.s, spec.wire1.t);
  const p2 = allPaths(spec.wire2.s, spec.wire2.t);
  const rankOf = (a: Cell[], b: Cell[]) => {
    const l1 = a.length - 1;
    const l2 = b.length - 1;
    return {
      mx: Math.max(l1, l2),
      sum: l1 + l2,
      d1: dirsOf(a),
      d2: dirsOf(b),
    };
  };
  const dirRank: Record<Dir, number> = { U: 0, D: 1, L: 2, R: 3 };
  const cmpDirs = (x: Dir[], y: Dir[]) => {
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] !== y[i]) return dirRank[x[i]] < dirRank[y[i]] ? -1 : 1;
    }
    return x.length - y.length;
  };
  let best: { mx: number; sum: number; d1: Dir[]; d2: Dir[] } | null = null;
  let bestPair: [Cell[], Cell[]] | null = null;
  for (const a of p1) {
    for (const b of p2) {
      // 不共享单元
      const setA = new Set(a.map(key));
      if (b.some((q) => setA.has(key(q)))) continue;
      // 不共享边：跨线任意单元不相邻
      let touch = false;
      for (const x of a) {
        for (const y of b) {
          if (adj(x, y)) {
            touch = true;
            break;
          }
        }
        if (touch) break;
      }
      if (touch) continue;
      const r = rankOf(a, b);
      if (
        !best ||
        r.mx < best.mx ||
        (r.mx === best.mx && r.sum < best.sum) ||
        (r.mx === best.mx &&
          r.sum === best.sum &&
          (cmpDirs(r.d1, best.d1) < 0 ||
            (cmpDirs(r.d1, best.d1) === 0 && cmpDirs(r.d2, best.d2) < 0)))
      ) {
        best = r;
        bestPair = [a, b];
      }
    }
  }
  return bestPair;
}

describe('联合布线器', () => {
  it('固定板图（双窄门）应联合布线成功，且解合法、非各自贪心', () => {
    const res = routeJoint(SMOKE_BOARD, { timeoutMs: 20000 });
    expect(res.status).toBe('ok');
    expect(validateSolution(SMOKE_BOARD, res)).toEqual([]);
    // 墙只有 (2,4)、(6,4) 两个窄门；线2(行1)走北门长度 9，
    // 线1(行3)受不共享边限制只能绕南门，长度 13；联合最优较长线长为 13
    expect(Math.max(res.wire1!.length, res.wire2!.length)).toBe(13);
    const usedDoors = new Set<number>();
    for (const p of [...res.wire1!.cells, ...res.wire2!.cells]) {
      if (p.c === 4) usedDoors.add(p.r);
    }
    expect([...usedDoors].sort((a, b) => a - b)).toEqual([2, 6]);
  });

  it('唯一窄门板图应判定不可同敷', () => {
    const res = routeJoint(INFEASIBLE_BOARD, { timeoutMs: 20000 });
    expect(res.status).toBe('infeasible');
  });

  it('拒绝非法配置：端点落在禁布单元、端点重合', () => {
    expect(() =>
      routeJoint({ ...SMOKE_BOARD, blocked: [{ r: 3, c: 0 }] }),
    ).toThrow();
    expect(() =>
      routeJoint({
        ...SMOKE_BOARD,
        wire2: { s: SMOKE_BOARD.wire1.s, t: SMOKE_BOARD.wire2.t },
      }),
    ).toThrow();
  });

  it('拒绝行列数超出 6..10', () => {
    expect(() => routeJoint({ ...SMOKE_BOARD, rows: 5 })).toThrow();
    expect(() => routeJoint({ ...SMOKE_BOARD, cols: 11 })).toThrow();
  });

  it('曼哈顿最短路情形：两条线在开阔板上均可直行且互不贴边', () => {
    const spec: BoardSpec = {
      rows: 6,
      cols: 6,
      blocked: [],
      wire1: { s: { r: 0, c: 0 }, t: { r: 0, c: 5 } },
      wire2: { s: { r: 5, c: 0 }, t: { r: 5, c: 5 } },
    };
    const res = routeJoint(spec);
    expect(res.status).toBe('ok');
    expect(validateSolution(spec, res)).toEqual([]);
    expect(res.wire1!.length).toBe(manhattan(spec.wire1.s, spec.wire1.t));
    expect(res.wire2!.length).toBe(manhattan(spec.wire2.s, spec.wire2.t));
  });

  it('方向序列最小化：开阔板最优解两条线均应全 R', () => {
    const spec: BoardSpec = {
      rows: 6,
      cols: 6,
      blocked: [],
      wire1: { s: { r: 0, c: 0 }, t: { r: 0, c: 5 } },
      wire2: { s: { r: 5, c: 0 }, t: { r: 5, c: 5 } },
    };
    const res = routeJoint(spec);
    expect(res.wire1!.dirs).toEqual(['R', 'R', 'R', 'R', 'R']);
    expect(res.wire2!.dirs).toEqual(['R', 'R', 'R', 'R', 'R']);
  });
});

describe('与暴力枚举对拍（小规模随机板）', () => {
  // 手工构造若干 4x4 小板（绕过 6..10 的界面校验，直接构造 Router）
  const cases: BoardSpec[] = [
    {
      rows: 4,
      cols: 4,
      blocked: [{ r: 1, c: 2 }, { r: 2, c: 2 }],
      wire1: { s: { r: 0, c: 0 }, t: { r: 0, c: 3 } },
      wire2: { s: { r: 3, c: 0 }, t: { r: 3, c: 3 } },
    },
    {
      rows: 4,
      cols: 4,
      blocked: [],
      wire1: { s: { r: 0, c: 0 }, t: { r: 3, c: 3 } },
      wire2: { s: { r: 3, c: 0 }, t: { r: 0, c: 3 } },
    },
    {
      rows: 4,
      cols: 5,
      blocked: [
        { r: 0, c: 2 },
        { r: 3, c: 2 },
      ],
      wire1: { s: { r: 0, c: 0 }, t: { r: 3, c: 4 } },
      wire2: { s: { r: 3, c: 0 }, t: { r: 0, c: 4 } },
    },
  ];

  for (const spec of cases) {
    it(`对拍 ${spec.rows}x${spec.cols} 板`, () => {
      const expected = bruteForce(spec);
      const res = new JointRouter(spec).run({ timeoutMs: 15000 });
      if (expected === null) {
        expect(res.status).toBe('infeasible');
      } else {
        expect(res.status).toBe('ok');
        expect(validateSolution(spec, res)).toEqual([]);
        const [ea, eb] = expected;
        expect(res.wire1!.length).toBe(ea.length - 1);
        expect(res.wire2!.length).toBe(eb.length - 1);
        const d1 = res.wire1!.dirs;
        const d2 = res.wire2!.dirs;
        const ed1 = bruteDirs(ea);
        const ed2 = bruteDirs(eb);
        expect(d1).toEqual(ed1);
        expect(d2).toEqual(ed2);
      }
    });
  }

  function bruteDirs(cells: Cell[]): Dir[] {
    const out: Dir[] = [];
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1];
      const b = cells[i];
      out.push(
        DIR_ORDER.find(
          (x) => a.r + DIR_VECTORS[x].r === b.r && a.c + DIR_VECTORS[x].c === b.c,
        )!,
      );
    }
    return out;
  }
});
