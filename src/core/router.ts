import {
  BoardSpec,
  Cell,
  Dir,
  DIR_ORDER,
  RouteResult,
  cellKey,
  countFreeCells,
  sameCell,
} from './types';

/**
 * 双跳线联合布线器（联合最优，绝不按单条线路贪心）。
 *
 * 约束：
 *  - 仅上下左右移动；每条线路径单元不重复；
 *  - 两线互不共享单元（也不得占用对方端点）；
 *  - 互不共享边：任一属于 A 线的单元与任一属于 B 线的单元不得四邻接
 *    （含对方端点，因此物理上两条走线之间至少隔一个单元）。
 *
 * 优化目标（依次，字典序）：
 *   ① 较长路径长度 max(L1,L2)
 *   ② 路径总长度 L1+L2
 *   ③ 跳线 1 自起点展开的方向序列（U<D<L<R 字典序）
 *   ④ 跳线 2 的方向序列
 *
 * 算法：
 *  - 外层按 ①② 字典序枚举候选长度对 (L1,L2)（奇偶性受二分图约束）；
 *  - 内层以“严格交替伸展”的联合 DFS 作为可行性预言机
 *    feasible(固定前缀1, 固定前缀2)：第 k 轮先伸线 1 再伸线 2，
 *    联合解空间与 DFS 树一一对应，不会漏解；
 *  - 对可行长度对，用预言机逐位贪心钉死方向序列：先 U..R 试探线 1
 *    的每一位、再线 2 的每一位，由此得到 ③④ 字典序最小的联合解；
 *  - 预言机剪枝（全部为可证明的必要条件）：
 *      · 前后双向 BFS 距离与长度奇偶；
 *      · 精确长度层约束 dist前+dist后<=f 且同奇偶（含选向时的层过滤）；
 *      · 连通层域容量与二分图颜色计数；
 *      · Tarjan 割点：一条线的必经单元若与另一条线的必经单元重合
 *        或四邻接（被迫共享单元/边）则立即剪枝；
 *      · 剩余总单元数、终态禁共边/禁占端点的即时判定；
 *  - 自由位选向按“朝终点反向距离升序、U<D<L<R”作最近邻启发，
 *    只改变搜索顺序不影响完备性与最优性。
 */

const DR = [-1, 1, 0, 0];
const DC = [0, 0, -1, 1];

export interface RouteOptions {
  /** 整次联合搜索的时间上限（毫秒），超时返回 status='timeout' */
  timeoutMs?: number;
  /** 访问节点数回调（搜索量展示用） */
  onNodes?: (nodes: number) => void;
}

export type FullRouteResult = RouteResult & { nodes?: number };

class JointRouter {
  private readonly rows: number;
  private readonly cols: number;
  private readonly N: number;
  private readonly blocked: Uint8Array;
  /** 单元归属：0 空 / 1 跳线1 / 2 跳线2 */
  private readonly owner: Uint8Array;
  /** BFS 时间戳（Uint32 避免长搜索回绕） */
  private readonly mark: Uint32Array;
  private readonly markB: [Uint32Array, Uint32Array];
  private readonly dist: Int32Array;
  private readonly distB: [Int32Array, Int32Array];
  private readonly tinBuf: Int32Array;
  private readonly lowBuf: Int32Array;
  private readonly parBuf: Int32Array;
  private readonly frameV: Int32Array;
  private readonly frameEdge: Int32Array;
  private readonly hasTBuf: Uint8Array;
  private readonly tinTag: Uint32Array;
  private tinRun = 0;
  /** 必经点标记（mandTag 时间戳），供两线割点集合求交 */
  private readonly mand1: Uint32Array;
  private readonly mand2: Uint32Array;
  private mandTag = 0;
  /** 每条线最近一次 analyzeWire 的反向 BFS 时间戳（精确长度层剪枝用） */
  private readonly stampBOfWire = [0, 0];
  private readonly queue: Int32Array;

  private readonly s1: number;
  private readonly t1: number;
  private readonly s2: number;
  private readonly t2: number;
  private readonly totalFree: number;

  /** 预言机当前固定的方向前缀（-1 表示该位自由） */
  private fixed1: Int8Array = new Int8Array(0);
  private fixed2: Int8Array = new Int8Array(0);
  private dirs1: number[] = [];
  private dirs2: number[] = [];
  private L1 = 0;
  private L2 = 0;

  private stamp = 0;
  private nodeCount = 0;
  private deadline = Number.POSITIVE_INFINITY;
  private timedOut = false;
  private onNodes?: (nodes: number) => void;

  constructor(spec: BoardSpec) {
    this.rows = spec.rows;
    this.cols = spec.cols;
    this.N = spec.rows * spec.cols;
    this.blocked = new Uint8Array(this.N);
    for (const b of spec.blocked) this.blocked[b.r * this.cols + b.c] = 1;
    this.owner = new Uint8Array(this.N);
    this.mark = new Uint32Array(this.N);
    this.markB = [new Uint32Array(this.N), new Uint32Array(this.N)];
    this.dist = new Int32Array(this.N);
    this.distB = [new Int32Array(this.N), new Int32Array(this.N)];
    this.tinBuf = new Int32Array(this.N);
    this.lowBuf = new Int32Array(this.N);
    this.parBuf = new Int32Array(this.N);
    this.frameV = new Int32Array(this.N);
    this.frameEdge = new Int32Array(this.N);
    this.hasTBuf = new Uint8Array(this.N);
    this.tinTag = new Uint32Array(this.N);
    this.mand1 = new Uint32Array(this.N);
    this.mand2 = new Uint32Array(this.N);
    const blockedSet = new Set(spec.blocked.map((b) => cellKey(b.r, b.c)));
    this.totalFree = countFreeCells(spec.rows, spec.cols, blockedSet);
    this.queue = new Int32Array(this.totalFree);

    this.s1 = this.idx(spec.wire1.s);
    this.t1 = this.idx(spec.wire1.t);
    this.s2 = this.idx(spec.wire2.s);
    this.t2 = this.idx(spec.wire2.t);
  }

  private idx(cell: Cell): number {
    return cell.r * this.cols + cell.c;
  }

  /** 校验板图配置；合法返回 null，否则返回中文错误信息 */
  static validate(spec: BoardSpec): string | null {
    const { rows, cols, blocked, wire1, wire2 } = spec;
    if (!Number.isInteger(rows) || rows < 6 || rows > 10)
      return '行数需为 6 至 10 的整数';
    if (!Number.isInteger(cols) || cols < 6 || cols > 10)
      return '列数需为 6 至 10 的整数';
    const inBoard = (p: Cell) =>
      p.r >= 0 && p.r < rows && p.c >= 0 && p.c < cols;
    const ends = [wire1.s, wire1.t, wire2.s, wire2.t];
    for (const p of ends) {
      if (!inBoard(p)) return '存在落在板外的端点';
    }
    const bset = new Set<number>();
    for (const b of blocked) {
      if (!inBoard(b)) return '存在落在板外的禁布单元';
      const k = b.r * cols + b.c;
      if (bset.has(k)) return '禁布单元存在重复';
      bset.add(k);
    }
    for (const p of ends) {
      if (bset.has(p.r * cols + p.c)) return '端点不能落在禁布单元上';
    }
    for (let i = 0; i < ends.length; i++) {
      for (let j = i + 1; j < ends.length; j++) {
        if (sameCell(ends[i], ends[j])) return '四个端点必须互不相同';
      }
    }
    // 分属两条线的端点初始即四邻接 => 必然共享边，直接判定不可行配置
    const cross: Array<[Cell, Cell]> = [
      [wire1.s, wire2.s],
      [wire1.s, wire2.t],
      [wire1.t, wire2.s],
      [wire1.t, wire2.t],
    ];
    for (const [a, b] of cross) {
      if (Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1)
        return '两条跳线的端点彼此相邻，必然共享边，请调整端点';
    }
    if (sameCell(wire1.s, wire1.t) || sameCell(wire2.s, wire2.t))
      return '每条跳线的起点与终点必须不同';
    return null;
  }

  /** BFS：start 到 target 的最短距离；禁布单元与 forbidden 单元不可走，不可达 -1 */
  private bfsDistance(start: number, target: number, forbidden: number): number {
    const stamp = ++this.stamp;
    this.mark[start] = stamp;
    this.dist[start] = 0;
    let qh = 0;
    let qt = 0;
    this.queue[qt++] = start;
    while (qh < qt) {
      const v = this.queue[qh++];
      const r = (v / this.cols) | 0;
      const c = v - r * this.cols;
      if (v === target) return this.dist[v];
      const nd = this.dist[v] + 1;
      for (let d = 0; d < 4; d++) {
        const nr = r + DR[d];
        const nc = c + DC[d];
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const u = nr * this.cols + nc;
        if (this.mark[u] === stamp) continue;
        if (this.blocked[u] || u === forbidden) continue;
        this.mark[u] = stamp;
        this.dist[u] = nd;
        this.queue[qt++] = u;
      }
    }
    return -1;
  }

  /**
   * 分析某条线在当前局面下的合法域并剪枝：
   *  - 前向 BFS（head 起）与反向 BFS（target 起）的交集才是可能出现在
   *    完整 s->t 路径上的单元，据此做可达距离/奇偶/容量/颜色剪枝；
   *  - 在交集域上做 Tarjan 割点分析，标出“本线任意 head->target 路径都
   *    必经的内部单元”（写入 outMand，打上 tag）。
   *  返回 false 表示当前局面已不可能完成该线。
   */
  private analyzeWire(
    head: number,
    target: number,
    wire: number,
    f: number,
    outMand: Uint32Array,
    tag: number,
  ): boolean {
    const otherWire = wire === 1 ? 2 : 1;
    const otherTarget = wire === 1 ? this.t2 : this.t1;
    const distB = this.distB[wire - 1];
    const markBArr = this.markB[wire - 1];

    const stampF = ++this.stamp;
    const stampB = ++this.stamp;
    // 前向 BFS
    this.mark[head] = stampF;
    this.dist[head] = 0;
    let qh = 0;
    let qt = 0;
    this.queue[qt++] = head;
    while (qh < qt) {
      const v = this.queue[qh++];
      const r = (v / this.cols) | 0;
      const c = v - r * this.cols;
      const nd = this.dist[v] + 1;
      for (let k = 0; k < 4; k++) {
        const nr = r + DR[k];
        const nc = c + DC[k];
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const u = nr * this.cols + nc;
        if (this.mark[u] === stampF) continue;
        if (!this.passable(u, head, wire, otherWire, otherTarget)) continue;
        this.mark[u] = stampF;
        this.dist[u] = nd;
        this.queue[qt++] = u;
      }
    }
    if (this.mark[target] !== stampF) return false;
    const dF = this.dist[target];
    if (dF > f || ((f - dF) & 1) !== 0) return false;

    // 反向 BFS（同一张合法域图）；head 是余下端子路径的终点哨兵：
    // 只标记可达、不从它继续扩展（本线前缀格不可重复经过）
    markBArr[target] = stampB;
    distB[target] = 0;
    qh = 0;
    qt = 0;
    this.queue[qt++] = target;
    while (qh < qt) {
      const v = this.queue[qh++];
      const r = (v / this.cols) | 0;
      const c = v - r * this.cols;
      const nd = distB[v] + 1;
      for (let k = 0; k < 4; k++) {
        const nr = r + DR[k];
        const nc = c + DC[k];
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const u = nr * this.cols + nc;
        if (markBArr[u] === stampB) continue;
        if (u === head) {
          markBArr[u] = stampB;
          distB[u] = nd;
          continue;
        }
        if (!this.passable(u, target, wire, otherWire, otherTarget)) continue;
        markBArr[u] = stampB;
        distB[u] = nd;
        this.queue[qt++] = u;
      }
    }
    if (markBArr[head] !== stampB) return false;
    this.stampBOfWire[wire - 1] = stampB;

    // 交集域统计，并施加“恰为 f 边路径”的层松弛：
    // 单元 u 可能落在某条长度 f 的 head->target 路径上，当且仅当
    // dist[u]+distB[u] <= f 且与 f 同奇偶（绕路必须成对加 2）。
    const hr = (head / this.cols) | 0;
    const headParity = (hr + (head - hr * this.cols)) & 1;
    let size = 0;
    let sameColor = 0;
    let oppColor = 0;
    for (let u = 0; u < this.N; u++) {
      if (this.mark[u] !== stampF || markBArr[u] !== stampB) continue;
      const g = this.dist[u] + distB[u];
      if (g > f || ((f - g) & 1) !== 0) {
        // 排除出 Tarjan 域：把反向标记撤掉（前向标记本帧独有，无需处理）
        markBArr[u] = 0;
        continue;
      }
      size++;
      const r = (u / this.cols) | 0;
      const c = u - r * this.cols;
      if (((r + c) & 1) === headParity) sameColor++;
      else oppColor++;
    }
    if (size < f + 1) return false;
    const needOpp = (f + 1) >> 1;
    const needSameExtra = f >> 1;
    if (oppColor < needOpp || sameColor - 1 < needSameExtra) return false;

    // Tarjan 割点（迭代版），只在交集域上遍历
    const tinRun = ++this.tinRun;
    let timer = 0;
    this.tinTag[head] = tinRun;
    this.tinBuf[head] = ++timer;
    this.lowBuf[head] = this.tinBuf[head];
    this.parBuf[head] = -1;
    this.hasTBuf[head] = head === target ? 1 : 0;
    let sp = 0;
    this.frameV[sp] = head;
    this.frameEdge[sp] = 0;
    sp++;
    while (sp > 0) {
      const v = this.frameV[sp - 1];
      const e = this.frameEdge[sp - 1];
      if (e < 4) {
        this.frameEdge[sp - 1] = e + 1;
        const r = (v / this.cols) | 0;
        const nr = r + DR[e];
        const nc = (v - r * this.cols) + DC[e];
        if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
        const u = nr * this.cols + nc;
        if (this.mark[u] !== stampF || markBArr[u] !== stampB) continue;
        if (this.tinTag[u] === tinRun) {
          if (u !== this.parBuf[v] && this.tinBuf[u] < this.lowBuf[v]) {
            this.lowBuf[v] = this.tinBuf[u]; // 无向图回边
          }
          continue;
        }
        this.tinTag[u] = tinRun;
        this.tinBuf[u] = ++timer;
        this.lowBuf[u] = this.tinBuf[u];
        this.parBuf[u] = v;
        this.hasTBuf[u] = u === target ? 1 : 0;
        this.frameV[sp] = u;
        this.frameEdge[sp] = 0;
        sp++;
      } else {
        sp--;
        const p = this.parBuf[v];
        if (p >= 0) {
          if (this.lowBuf[v] < this.lowBuf[p]) this.lowBuf[p] = this.lowBuf[v];
          // v 是 p 的 DFS 子节点；若 v 子树含 target 且 low[v]>=tin[p]，
          // 则删除 p 会切断 head 到 target，p 为必经点（排除两端点）
          if (
            this.hasTBuf[v] === 1 &&
            this.lowBuf[v] >= this.tinBuf[p] &&
            p !== head &&
            p !== target
          ) {
            outMand[p] = tag;
          }
          if (this.hasTBuf[v] === 1) this.hasTBuf[p] = 1;
        }
      }
    }
    return true;
  }

  /** 单元 u 在当前局面下对 wire 是否可通行（start 为本线 BFS 起点，特许通过） */
  private passable(
    u: number,
    start: number,
    wire: number,
    otherWire: number,
    otherTarget: number,
  ): boolean {
    if (this.blocked[u]) return false;
    if (u === otherTarget) return false; // 对方终点必属对方
    const own = this.owner[u];
    if (own === otherWire) return false;
    if (own === wire && u !== start) return false; // 本线既占单元不可重复
    if (u === start) return true;
    // 与对方线（含对方终点）四邻接则不允许（不共享边）
    const r = (u / this.cols) | 0;
    const c = u - r * this.cols;
    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
      const v = nr * this.cols + nc;
      if (v === otherTarget || this.owner[v] === otherWire) return false;
    }
    return true;
  }

  /** 联合 DFS：在 (L1,L2) 与固定前缀下是否存在合法联合敷设 */
  private feasibleDfs(): boolean {
    if ((++this.nodeCount & 4095) === 0) {
      this.onNodes?.(this.nodeCount);
      if (Date.now() > this.deadline) {
        this.timedOut = true;
      }
    }
    if (this.timedOut) return true; // 中止信号向上传递

    const n1 = this.dirs1.length;
    const n2 = this.dirs2.length;
    if (n1 === this.L1 && n2 === this.L2) return true;

    // 剩余总单元数量
    const used = n1 + n2 + 2;
    const f1 = this.L1 - n1;
    const f2 = this.L2 - n2;
    if (used + f1 + f2 > this.totalFree) return false;

    const head1 = this.headAt(this.s1, this.dirs1);
    const head2 = this.headAt(this.s2, this.dirs2);

    // 联合松弛：双向可达域（距离/奇偶/容量/颜色）+ 必经点（割点）
    if (f1 > 0 || f2 > 0) {
      const tag = ++this.mandTag;
      if (f1 > 0 && !this.analyzeWire(head1, this.t1, 1, f1, this.mand1, tag)) return false;
      if (f2 > 0 && !this.analyzeWire(head2, this.t2, 2, f2, this.mand2, tag)) return false;
      if (f1 > 0 && f2 > 0) {
        // 两线必经单元重合（抢单元）或四邻接（被迫共享边）均不可行
        for (let u = 0; u < this.N; u++) {
          if (this.mand1[u] !== tag) continue;
          if (this.mand2[u] === tag) return false;
          const r = (u / this.cols) | 0;
          const c = u - r * this.cols;
          for (let d = 0; d < 4; d++) {
            const nr = r + DR[d];
            const nc = c + DC[d];
            if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
            if (this.mand2[nr * this.cols + nc] === tag) return false;
          }
        }
      }
    }

    const w1Done = n1 === this.L1;
    const w2Done = n2 === this.L2;
    if (w1Done && w2Done) return true;

    // 严格交替（一线先走完则只伸另一线）；前缀位被固定时只走固定方向
    if (!w1Done && (w2Done || n1 === n2)) {
      const forced = n1 < this.fixed1.length ? this.fixed1[n1] : -1;
      return this.extend(head1, this.t1, 1, f1, this.dirs1, forced);
    }
    const forced = n2 < this.fixed2.length ? this.fixed2[n2] : -1;
    return this.extend(head2, this.t2, 2, f2, this.dirs2, forced);
  }

  /**
   * 让 wire 从 head 伸出一格。
   *  - 固定前缀位（forced>=0）：只考虑该方向；
   *  - 自由位：收集全部合法候选，按“到终点的反向距离升序、同距按
   *    U<D<L<R”枚举（最近邻启发，不影响完备性）。
   * 注意：所有基于 analyzeWire 共享数组（markB/distB）的过滤必须在本节点
   * 任何递归之前一次性完成——子树递归会覆盖这些数组与时间戳，回溯后不可
   * 再据此复查兄弟候选；执行阶段只依赖会随回溯正确恢复的 owner 局面。
   */
  private extend(
    head: number,
    target: number,
    wire: number,
    remain: number,
    dirs: number[],
    forced: number,
  ): boolean {
    const r = (head / this.cols) | 0;
    const c = head - r * this.cols;
    const otherWire = wire === 1 ? 2 : 1;
    const otherTarget = wire === 1 ? this.t2 : this.t1;
    const stampB = this.stampBOfWire[wire - 1];
    const distB = this.distB[wire - 1];
    const markBArr = this.markB[wire - 1];

    // 递归前一次性确定本节点全部合法候选方向（此时分析数组仍有效）
    const cand: number[] = [];
    const dirsToTry = forced >= 0 ? [forced] : [0, 1, 2, 3];
    const freeRb = new Int32Array(4);
    for (const d of dirsToTry) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr < 0 || nr >= this.rows || nc < 0 || nc >= this.cols) continue;
      const u = nr * this.cols + nc;
      if (this.blocked[u]) continue;
      if (this.owner[u] !== 0) continue; // 不共享单元 / 不重复
      if (u === otherTarget) continue; // 不得占用对方端点
      if (u === target && remain !== 1) continue; // 终点只能最后一步进
      // 精确长度层约束：任何长度恰为 remain 的路径，下一步必在
      // distB<=remain-1 且同奇偶的反向层中
      if (markBArr[u] !== stampB) continue;
      const rb = distB[u];
      if (rb > remain - 1 || (((remain - 1 - rb) & 1) !== 0)) continue;
      if (this.adjacentToOther(nr, nc, otherWire, otherTarget)) continue;
      freeRb[d] = rb;
      cand.push(d);
    }
    if (forced < 0) cand.sort((a, b) => (freeRb[a] !== freeRb[b] ? freeRb[a] - freeRb[b] : a - b));

    for (const d of cand) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      const u = nr * this.cols + nc;
      // 以下检查只依赖随回溯恢复的 owner 局面（候选在递归前已通过全部
      // 静态/层过滤，此处无需、也不可再读共享分析数组）
      this.owner[u] = wire;
      dirs.push(d);
      const ok = this.feasibleDfs();
      if (ok) {
        if (!this.timedOut) return true;
        dirs.pop();
        this.owner[u] = 0;
        return true; // 超时中止向上传递
      }
      dirs.pop();
      this.owner[u] = 0;
      if (this.timedOut) return true;
    }
    return false;
  }

  /** 候选格四邻中是否有对方线单元或对方终点（不共享边） */
  private adjacentToOther(
    nr: number,
    nc: number,
    otherWire: number,
    otherTarget: number,
  ): boolean {
    for (let d = 0; d < 4; d++) {
      const ar = nr + DR[d];
      const ac = nc + DC[d];
      if (ar < 0 || ar >= this.rows || ac < 0 || ac >= this.cols) continue;
      const u = ar * this.cols + ac;
      if (u === otherTarget) return true;
      if (this.owner[u] === otherWire) return true;
    }
    return false;
  }

  private headAt(start: number, dirs: number[]): number {
    let r = (start / this.cols) | 0;
    let c = start - r * this.cols;
    for (const d of dirs) {
      r += DR[d];
      c += DC[d];
    }
    return r * this.cols + c;
  }

  private replay(start: number, dirs: number[]): Cell[] {
    const cells: Cell[] = [];
    let r = (start / this.cols) | 0;
    let c = start - r * this.cols;
    cells.push({ r, c });
    for (const d of dirs) {
      r += DR[d];
      c += DC[d];
      cells.push({ r, c });
    }
    return cells;
  }

  /** 以当前 (L1,L2) 与给定前缀调用一次预言机；结束后复位局面 */
  private oracle(prefix1: number[], prefix2: number[]): boolean {
    this.owner.fill(0);
    this.owner[this.s1] = 1;
    this.owner[this.s2] = 2;
    this.dirs1 = [];
    this.dirs2 = [];
    this.fixed1 = Int8Array.from(prefix1);
    this.fixed2 = Int8Array.from(prefix2);
    const ok = this.feasibleDfs();
    const result = ok && !this.timedOut;
    return result;
  }

  run(options: RouteOptions = {}): FullRouteResult {
    this.deadline =
      options.timeoutMs != null ? Date.now() + options.timeoutMs : Number.POSITIVE_INFINITY;
    this.onNodes = options.onNodes;

    // 静态兜底：跨线端点两两之间不得四邻接（否则必然共享边）
    const cross: Array<[number, number]> = [
      [this.s1, this.s2],
      [this.s1, this.t2],
      [this.t1, this.s2],
      [this.t1, this.t2],
    ];
    for (const [a, b] of cross) {
      const ar = (a / this.cols) | 0;
      const ac = a - ar * this.cols;
      const br = (b / this.cols) | 0;
      const bc = b - br * this.cols;
      if (Math.abs(ar - br) + Math.abs(ac - bc) <= 1) {
        return { status: 'infeasible', nodes: this.nodeCount };
      }
    }

    // 长度下界（避开禁布与对方端点的最短路）；二分图决定候选长度奇偶
    const d1 = this.bfsDistance(this.s1, this.t1, this.t2);
    if (d1 < 0) return { status: 'infeasible', nodes: this.nodeCount };
    const d2 = this.bfsDistance(this.s2, this.t2, this.t1);
    if (d2 < 0) return { status: 'infeasible', nodes: this.nodeCount };

    // 候选长度对
    const pairs: Array<[number, number]> = [];
    for (let l1 = d1; l1 + d2 + 2 <= this.totalFree; l1++) {
      if (((l1 - d1) & 1) !== 0) continue;
      for (let l2 = d2; l1 + l2 + 2 <= this.totalFree; l2++) {
        if (((l2 - d2) & 1) !== 0) continue;
        pairs.push([l1, l2]);
      }
    }
    pairs.sort((a, b) => {
      const ma = Math.max(a[0], a[1]);
      const mb = Math.max(b[0], b[1]);
      if (ma !== mb) return ma - mb;
      const sa = a[0] + a[1];
      const sb = b[0] + b[1];
      if (sa !== sb) return sa - sb;
      return 0; // 同一 (max,sum) 下方向序列由后续贪心决定，与 l1/l2 大小无关
    });

    // 同一 (max,sum) 排名下可能同时存在 (L1,L2) 与 (L2,L1) 两个长度对，
    // 需各求出最优方向序列后再按 ③④ 字典序比较，不能命中即返回。
    let best:
      | (NonNullable<FullRouteResult['wire1']> extends never
          ? never
          : { w1: NonNullable<FullRouteResult['wire1']>; w2: NonNullable<FullRouteResult['wire2']> })
      | null = null;
    let bestRank: [number, number] | null = null;

    for (const [l1, l2] of pairs) {
      if (this.timedOut) break;
      const rank: [number, number] = [Math.max(l1, l2), l1 + l2];
      if (bestRank !== null && (rank[0] > bestRank[0] || rank[1] > bestRank[1])) break;

      this.L1 = l1;
      this.L2 = l2;
      if (!this.oracle([], [])) {
        if (this.timedOut) break;
        continue;
      }
      // 该长度对可行：逐位贪心钉死跳线 1 的方向序列
      const p1: number[] = [];
      let possible = true;
      for (let k = 0; k < l1; k++) {
        let chosen = -1;
        for (let d = 0; d < 4; d++) {
          if (this.timedOut) break;
          p1.push(d);
          if (this.oracle(p1, [])) {
            chosen = d;
            break;
          }
          p1.pop();
        }
        if (this.timedOut || chosen < 0) {
          possible = false;
          break;
        }
      }
      if (!possible) break;
      // 再逐位贪心钉死跳线 2
      const p2: number[] = [];
      for (let k = 0; k < l2; k++) {
        let chosen = -1;
        for (let d = 0; d < 4; d++) {
          if (this.timedOut) break;
          p2.push(d);
          if (this.oracle(p1, p2)) {
            chosen = d;
            break;
          }
          p2.pop();
        }
        if (this.timedOut || chosen < 0) {
          possible = false;
          break;
        }
      }
      if (!possible) break;

      // 最终一致性确认（固定全部方向）
      if (!this.oracle(p1, p2)) {
        if (this.timedOut) break;
        continue;
      }
      const cells1 = this.replay(this.s1, p1);
      const cells2 = this.replay(this.s2, p2);
      const w1: NonNullable<FullRouteResult['wire1']> = {
        cells: cells1,
        length: cells1.length - 1,
        dirs: p1.map((d) => DIR_ORDER[d]),
      };
      const w2: NonNullable<FullRouteResult['wire2']> = {
        cells: cells2,
        length: cells2.length - 1,
        dirs: p2.map((d) => DIR_ORDER[d]),
      };
      if (best === null || this.lexLess(w1, w2, best.w1, best.w2)) {
        best = { w1, w2 };
        bestRank = rank;
      }
    }
    if (this.timedOut) return { status: 'timeout', nodes: this.nodeCount };
    if (best) {
      return { status: 'ok', wire1: best.w1, wire2: best.w2, nodes: this.nodeCount };
    }
    return { status: 'infeasible', nodes: this.nodeCount };
  }

  /** 方向序列字典序比较：先跳线 1，再跳线 2（U<D<L<R） */
  private lexLess(
    a1: { dirs: Dir[] },
    a2: { dirs: Dir[] },
    b1: { dirs: Dir[] },
    b2: { dirs: Dir[] },
  ): boolean {
    const c = this.cmpDirs(a1.dirs, b1.dirs);
    if (c !== 0) return c < 0;
    return this.cmpDirs(a2.dirs, b2.dirs) < 0;
  }

  private cmpDirs(a: Dir[], b: Dir[]): number {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    }
    return a.length - b.length;
  }
}

export function routeJoint(spec: BoardSpec, options: RouteOptions = {}): FullRouteResult {
  const err = JointRouter.validate(spec);
  if (err) throw new Error(err);
  return new JointRouter(spec).run(options);
}

export { JointRouter };
