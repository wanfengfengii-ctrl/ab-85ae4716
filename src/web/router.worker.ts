import { FullRouteResult, routeJoint } from '../core/router';
import { BoardSpec } from '../core/types';

// 该模块运行于 Web Worker；用最小结构化类型避免 DOM/Worker lib 对 self 的声明冲突
interface WorkerScope {
  onmessage: ((ev: MessageEvent<{ spec: BoardSpec }>) => void) | null;
  postMessage(message: unknown): void;
}

const scope = globalThis as unknown as WorkerScope;

scope.onmessage = (e) => {
  const { spec } = e.data;
  try {
    const result: FullRouteResult = routeJoint(spec, { timeoutMs: 30000 });
    scope.postMessage({ ok: true, result });
  } catch (err) {
    scope.postMessage({ ok: false, error: (err as Error).message });
  }
};
