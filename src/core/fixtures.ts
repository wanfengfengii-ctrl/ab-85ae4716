import { BoardSpec } from './types';

/**
 * 冒烟用固定板图：8x8。
 * 第 4 列是一道禁布墙，仅在 (2,4)、(6,4) 留两个窄门。
 * 两条跳线的端点都在板身中部，各自最短路都会争抢北门 (2,4)，
 * 必须联合求解——其中一条绕走南门，且两条走线全程不能贴边。
 */
export const SMOKE_BOARD: BoardSpec = {
  rows: 8,
  cols: 8,
  blocked: [
    { r: 0, c: 4 },
    { r: 1, c: 4 },
    { r: 3, c: 4 },
    { r: 4, c: 4 },
    { r: 5, c: 4 },
    { r: 7, c: 4 },
  ],
  wire1: { s: { r: 3, c: 0 }, t: { r: 3, c: 7 } },
  wire2: { s: { r: 1, c: 0 }, t: { r: 1, c: 7 } },
};

/**
 * 不可同敷固定板图：6x6。
 * 第 4 列整列封堵，只留 (3,4) 唯一一个窄门，
 * 南北两条跳线都必须占用该门，联合判定必然失败。
 */
export const INFEASIBLE_BOARD: BoardSpec = {
  rows: 6,
  cols: 6,
  blocked: [
    { r: 0, c: 4 },
    { r: 1, c: 4 },
    { r: 2, c: 4 },
    { r: 4, c: 4 },
    { r: 5, c: 4 },
  ],
  wire1: { s: { r: 0, c: 0 }, t: { r: 0, c: 5 } },
  wire2: { s: { r: 5, c: 0 }, t: { r: 5, c: 5 } },
};
