import { useMemo, useRef, useState } from 'react';
import { BoardSpec, Cell, Dir, cellKey } from '../core/types';
import { FullRouteResult } from '../core/router';
import { buildCellMap, unusedCells, CellKind } from '../core/board';

type Tool = 'block' | 's1' | 't1' | 's2' | 't2' | 'erase';

const TOOLS: Array<{ id: Tool; label: string; cls: string }> = [
  { id: 's1', label: '跳线1 起点', cls: 'tool-s1' },
  { id: 't1', label: '跳线1 终点', cls: 'tool-t1' },
  { id: 's2', label: '跳线2 起点', cls: 'tool-s2' },
  { id: 't2', label: '跳线2 终点', cls: 'tool-t2' },
  { id: 'block', label: '禁布单元', cls: 'tool-block' },
  { id: 'erase', label: '擦除', cls: 'tool-erase' },
];

const ARROW: Record<Dir, string> = { U: '↑', D: '↓', L: '←', R: '→' };
const DIR_CN: Record<Dir, string> = { U: '上', D: '下', L: '左', R: '右' };

interface EndPoints {
  s1?: Cell;
  t1?: Cell;
  s2?: Cell;
  t2?: Cell;
}

export default function App() {
  const [rows, setRows] = useState(8);
  const [cols, setCols] = useState(8);
  const [tool, setTool] = useState<Tool>('block');
  const [blocked, setBlocked] = useState<Set<number>>(() => new Set());
  const [ends, setEnds] = useState<EndPoints>({});
  const [result, setResult] = useState<FullRouteResult | null>(null);
  const [message, setMessage] = useState<{ type: 'info' | 'error' | 'ok'; text: string } | null>(
    null,
  );
  const [computing, setComputing] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  const spec: BoardSpec | null = useMemo(() => {
    if (!ends.s1 || !ends.t1 || !ends.s2 || !ends.t2) return null;
    return {
      rows,
      cols,
      blocked: [...blocked].map((k) => ({ r: Math.floor(k / 100), c: k % 100 })),
      wire1: { s: ends.s1, t: ends.t1 },
      wire2: { s: ends.s2, t: ends.t2 },
    };
  }, [rows, cols, blocked, ends]);

  const cellMap = useMemo(
    () => (spec ? buildCellMap(spec, result?.wire1, result?.wire2) : new Map<number, CellKind>()),
    [spec, result],
  );

  const unused = useMemo(
    () => (spec && result?.status === 'ok' ? unusedCells(spec, result.wire1, result.wire2) : []),
    [spec, result],
  );

  // 每个路径单元上叠加的方向箭头
  const arrowMap = useMemo(() => {
    const m = new Map<number, string>();
    if (result?.status === 'ok') {
      const put = (cells: Cell[], dirs: Dir[]) => {
        cells.forEach((p, i) => {
          if (i < dirs.length) m.set(cellKey(p.r, p.c), ARROW[dirs[i]]);
        });
      };
      put(result.wire1!.cells, result.wire1!.dirs);
      put(result.wire2!.cells, result.wire2!.dirs);
    }
    return m;
  }, [result]);

  const clearResult = (msg?: typeof message) => {
    setResult(null);
    if (msg) setMessage(msg);
  };

  const resize = (r: number, c: number) => {
    setRows(r);
    setCols(c);
    setBlocked(new Set());
    setEnds({});
    clearResult({ type: 'info', text: '板尺寸已改变，请重新布置禁布单元与端点' });
  };

  const onClickCell = (r: number, c: number) => {
    const k = cellKey(r, c);
    const nextBlocked = new Set(blocked);
    const nextEnds = { ...ends };
    const removeEnd = (cell?: Cell) => cell && cellKey(cell.r, cell.c) === k;
    switch (tool) {
      case 'block':
        nextBlocked.add(k);
        (['s1', 't1', 's2', 't2'] as const).forEach((id) => {
          if (removeEnd(nextEnds[id])) delete nextEnds[id];
        });
        break;
      case 'erase':
        nextBlocked.delete(k);
        (['s1', 't1', 's2', 't2'] as const).forEach((id) => {
          if (removeEnd(nextEnds[id])) delete nextEnds[id];
        });
        break;
      default: {
        const id = tool as 's1' | 't1' | 's2' | 't2';
        nextBlocked.delete(k);
        (['s1', 't1', 's2', 't2'] as const).forEach((other) => {
          if (other !== id && removeEnd(nextEnds[other])) delete nextEnds[other];
        });
        nextEnds[id] = { r, c };
      }
    }
    setBlocked(nextBlocked);
    setEnds(nextEnds);
    clearResult({ type: 'info', text: '板图已修改，旧路径已清除，请点击“生成联合布线”' });
  };

  const resetAll = () => {
    setBlocked(new Set());
    setEnds({});
    setResult(null);
    setMessage({ type: 'info', text: '已清空禁布单元与端点' });
  };

  const generate = () => {
    if (!spec) {
      clearResult({ type: 'error', text: '请先在板上标出两对（共四个）互不相同的端点' });
      return;
    }
    setComputing(true);
    setMessage({ type: 'info', text: '正在联合搜索两条跳线的最优共同敷设……' });
    setResult(null);
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./router.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    worker.onmessage = (e: MessageEvent<{ ok: boolean; result?: FullRouteResult; error?: string }>) => {
      setComputing(false);
      worker.terminate();
      workerRef.current = null;
      if (!e.data.ok) {
        setResult(null);
        setMessage({ type: 'error', text: `输入不合法：${e.data.error}` });
        return;
      }
      const res = e.data.result!;
      if (res.status === 'ok') {
        setResult(res);
        const longer = Math.max(res.wire1!.length, res.wire2!.length);
        const total = res.wire1!.length + res.wire2!.length;
        setMessage({
          type: 'ok',
          text: `联合布线成功（非单线贪心）：较长路径 ${longer}，总长度 ${total}，搜索节点 ${res.nodes ?? '-'}`,
        });
      } else if (res.status === 'timeout') {
        setResult(null);
        setMessage({ type: 'error', text: '联合搜索超时（30 秒），未得出结论，请简化板图后重试' });
      } else {
        // 无可同时敷设：清除旧路径并明确指出
        setResult(null);
        setMessage({
          type: 'error',
          text: '两条跳线无法共同通过当前板图：不存在满足互不共享单元与边的联合路径。旧路径已清除，请调整禁布单元或端点。',
        });
      }
    };
    worker.onerror = () => {
      setComputing(false);
      setResult(null);
      setMessage({ type: 'error', text: '布线计算发生内部错误' });
    };
    worker.postMessage({ spec });
  };

  const cells: React.ReactNode[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = cellKey(r, c);
      const kind = cellMap.get(k);
      const arrow = arrowMap.get(k);
      cells.push(
        <button
          key={k}
          type="button"
          className={['cell', kind ? `cell-${kind}` : 'cell-free'].join(' ')}
          onClick={() => onClickCell(r, c)}
          title={`(${r + 1}, ${c + 1})`}
          aria-label={`第 ${r + 1} 行第 ${c + 1} 列`}
        >
          {arrow ?? ''}
        </button>,
      );
    }
  }

  const dirsText = (dirs: Dir[]) => dirs.map((d) => DIR_CN[d]).join('、') || '(无)';

  return (
    <div className="page">
      <h1>返修板双跳线联合布线</h1>
      <p className="subtitle">
        两条跳线联合寻路（仅上下左右、各自不重复、互不共享单元与边），依次最小化
        <b> 较长路径长度 → 总长度 → 跳线1/跳线2 方向序列</b>，不按单条线路贪心。
      </p>

      <div className="toolbar">
        <label>
          行数
          <select value={rows} onChange={(e) => resize(Number(e.target.value), cols)}>
            {Array.from({ length: 5 }, (_, i) => i + 6).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          列数
          <select value={cols} onChange={(e) => resize(rows, Number(e.target.value))}>
            {Array.from({ length: 5 }, (_, i) => i + 6).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <div className="tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={['tool-btn', t.cls, tool === t.id ? 'active' : ''].join(' ')}
              onClick={() => setTool(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="primary" disabled={computing} onClick={generate}>
          {computing ? '联合搜索中…' : '生成联合布线'}
        </button>
        <button type="button" onClick={resetAll} disabled={computing}>
          清空布置
        </button>
      </div>

      {message && <div className={`message msg-${message.type}`}>{message.text}</div>}

      <div className="main">
        <div
          className="board"
          style={{ gridTemplateColumns: `repeat(${cols}, 44px)`, gridTemplateRows: `repeat(${rows}, 44px)` }}
        >
          {cells}
        </div>

        <div className="panel">
          <h2>布线结果</h2>
          {result?.status === 'ok' ? (
            <>
              <section className="wire wire1-box">
                <h3>跳线 1</h3>
                <div>长度：{result.wire1!.length}</div>
                <div>
                  经过单元（行,列）：
                  {result.wire1!.cells.map((p) => `(${p.r + 1},${p.c + 1})`).join(' → ')}
                </div>
                <div>方向序列：{dirsText(result.wire1!.dirs)}</div>
              </section>
              <section className="wire wire2-box">
                <h3>跳线 2</h3>
                <div>长度：{result.wire2!.length}</div>
                <div>
                  经过单元（行,列）：
                  {result.wire2!.cells.map((p) => `(${p.r + 1},${p.c + 1})`).join(' → ')}
                </div>
                <div>方向序列：{dirsText(result.wire2!.dirs)}</div>
              </section>
              <section className="wire">
                <h3>未使用区域</h3>
                <div>
                  共 {unused.length} 个单元：
                  <div className="unused-list">
                    {unused.map((p) => (
                      <span key={cellKey(p.r, p.c)} className="unused-chip">
                        ({p.r + 1},{p.c + 1})
                      </span>
                    ))}
                  </div>
                </div>
              </section>
            </>
          ) : (
            <p className="empty">尚未得到可共同敷设的两条跳线。</p>
          )}
          <h3>图例</h3>
          <ul className="legend">
            <li><span className="swatch cell-s1">1起</span> 跳线1起点</li>
            <li><span className="swatch cell-t1">1终</span> 跳线1终点</li>
            <li><span className="swatch cell-s2">2起</span> 跳线2起点</li>
            <li><span className="swatch cell-t2">2终</span> 跳线2终点</li>
            <li><span className="swatch cell-wire1" /> 跳线1走线</li>
            <li><span className="swatch cell-wire2" /> 跳线2走线</li>
            <li><span className="swatch cell-blocked" /> 禁布单元</li>
            <li><span className="swatch cell-free" /> 空白可布</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
