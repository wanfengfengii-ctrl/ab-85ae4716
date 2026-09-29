# 返修板双跳线联合布线（Dual Joint Router）

航电单层返修板上补两条互不干扰的跳线时，若各自走最短路径，常会争抢同一
狭窄通道而把另一条线逼入无路可走的境地。本应用在浏览器中绘制 6–10 行、
6–10 列的方格板，标出禁布单元与两对端点，由**联合搜索**（而非单线贪心）
同时寻找两条路径，并查看每条跳线经过的单元、长度、方向序列与未使用区域。

## 布线规则与优化目标

- 两条跳线均只能上下左右移动，且各自不重复经过单元；
- 两线**互不共享单元**（也不占用对方端点），并且**互不共享边**——任一属于
  A 线的单元与任一属于 B 线的单元不得四邻接，物理上两线之间至少隔一格；
- 在所有合法联合敷设中，依次最小化：
  1. **较长路径长度** `max(L1, L2)`
  2. **路径总长度** `L1 + L2`
  3. **跳线 1** 自起点展开的方向序列（`U < D < L < R` 字典序）
  4. **跳线 2** 的方向序列
- 不存在可同时敷设的方案时，界面清除旧路径并明确提示
  “两条跳线无法共同通过当前板图”。

## 算法（联合最优，不做单线贪心）

- 外层按目标 ①② 的字典序枚举候选长度对（长度奇偶受方格二分图约束）；
- 内层用“严格交替伸展”的联合 DFS 作为可行性预言机；
- 对可行长度对，用预言机逐位贪心钉死跳线 1、再跳线 2 的方向序列，得到
  ③④ 字典序最小的联合解；
- 剪枝均为可证明的必要条件：前后双向 BFS 距离与奇偶、精确长度层约束、
  层域容量与二分图颜色计数、Tarjan 割点（两线必经单元重合/相邻即无解）、
  禁共边与禁占端点即时判定。

核心算法与 React 完全解耦（`src/core/`），并配有：

- 单元测试（Vitest），含在 4×4/4×5 小板上与**暴力枚举最优解对拍**；
- 固定板图联合布线冒烟脚本（`src/smoke/smoke.ts`）。

## 本地开发

```bash
npm install
npm run dev       # 开发服务器
npm run test      # 单元测试
npm run build     # tsc 类型检查 + 生产构建
npm run smoke     # 固定板图联合布线冒烟
npm run verify    # 测试 + 构建 + 冒烟（与容器 verify 服务一致）
```

## Docker / Docker Compose

```bash
# 构建并启动 Web（宿主机端口由 WEB_PORT 决定，默认 8080）
WEB_PORT=9000 docker compose up --build -d
curl -s http://localhost:9000/healthz   # -> ok
```

- `web`：nginx 托管构建产物，监听容器内 80，带 `/healthz` 健康检查；
- `verify`：**一次性服务**，通过 `depends_on: condition: service_healthy`
  等 `web` 健康后运行 `npm run verify`（代码测试 → 类型检查与构建 →
  固定板图联合布线冒烟），以容器退出码报告结果（0 为全部通过）：

```bash
docker compose up --build        # 观察 verify-1 退出码 0
docker compose logs verify       # 查看测试与冒烟输出
```

## 目录结构

```
src/
  core/            纯 TypeScript 联合布线核心
    types.ts       板/端点/路径类型
    router.ts      联合 DFS、分支定界、割点与层剪枝
    board.ts       单元归属、未使用区域
    validate.ts    解的独立合法性校验
    fixtures.ts    冒烟用固定板图（双窄门可解 / 单窄门不可解）
    router.test.ts 单元测试 + 小规模暴力对拍
  web/             React 界面与 Web Worker
  smoke/           固定板图联合布线冒烟（退出码报告）
Dockerfile         base / verify / build / nginx runtime 多阶段
nginx.conf         静态托管 + /healthz
docker-compose.yml web（可配 WEB_PORT、健康检查）+ verify 一次性服务
```
