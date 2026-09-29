/**
 * 固定板图联合布线冒烟（verify 服务在健康检查通过后运行）。
 * 退出码：全部断言通过 0，否则 1。
 */
import { INFEASIBLE_BOARD, SMOKE_BOARD } from '../core/fixtures';
import { routeJoint } from '../core/router';
import { unusedCells } from '../core/board';
import { validateSolution } from '../core/validate';
import { Cell, Dir } from '../core/types';

let failures = 0;
function check(cond: boolean, message: string) {
  if (cond) {
    console.log(`  PASS  ${message}`);
  } else {
    console.error(`  FAIL  ${message}`);
    failures++;
  }
}

const fmt = (cells: Cell[]) =>
  cells.map((p) => `(${p.r},${p.c})`).join(' -> ');
const fmtDirs = (dirs: Dir[]) => dirs.join('') || '(空)';

console.log('== 冒烟 1：8x8 双窄门固定板图，联合布线 ==');
const r1 = routeJoint(SMOKE_BOARD, { timeoutMs: 30000 });
check(r1.status === 'ok', `布线状态为 ok（实际：${r1.status}）`);
if (r1.status === 'ok') {
  const problems = validateSolution(SMOKE_BOARD, r1);
  check(problems.length === 0, `解合法（无共享单元/边、无禁布、方向一致）${problems.length ? '：' + problems.join('；') : ''}`);
  console.log(`  跳线1 长度=${r1.wire1!.length}  方向=${fmtDirs(r1.wire1!.dirs)}`);
  console.log(`         经过单元: ${fmt(r1.wire1!.cells)}`);
  console.log(`  跳线2 长度=${r1.wire2!.length}  方向=${fmtDirs(r1.wire2!.dirs)}`);
  console.log(`         经过单元: ${fmt(r1.wire2!.cells)}`);
  const unused = unusedCells(SMOKE_BOARD, r1.wire1, r1.wire2);
  console.log(`  未使用区域单元数=${unused.length}：${unused.map((p) => `(${p.r},${p.c})`).join(' ')}`);
  const longer = Math.max(r1.wire1!.length, r1.wire2!.length);
  const total = r1.wire1!.length + r1.wire2!.length;
  console.log(`  优化指标：较长路径=${longer}，总长度=${total}，搜索节点=${r1.nodes ?? '-'}`);
  // 固定断言：两条线必须分走两个窄门 (2,4)/(6,4)，联合最优较长线为 13
  const doors = new Set<number>();
  for (const p of [...r1.wire1!.cells, ...r1.wire2!.cells]) {
    if (p.c === 4) doors.add(p.r);
  }
  check(doors.size === 2 && doors.has(2) && doors.has(6), '两线分走窄门 (2,4) 与 (6,4)');
  check(longer === 13, `较长路径长度为 13（实际：${longer}）`);
}

console.log('== 冒烟 2：6x6 唯一窄门板图，必须判定不可同敷 ==');
const r2 = routeJoint(INFEASIBLE_BOARD, { timeoutMs: 30000 });
check(r2.status === 'infeasible', `判定 infeasible（实际：${r2.status}）`);

if (failures > 0) {
  console.error(`\n冒烟失败：${failures} 项断言未通过`);
  process.exit(1);
}
console.log('\n冒烟全部通过');
