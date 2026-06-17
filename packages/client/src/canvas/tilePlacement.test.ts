/** Unit tests for `findFreeTilePosition` — the one-shot placement rule
 *  for new canvas tiles.
 *
 *  Single code path: viewport-center cascade. A new tile opens at the
 *  viewport center; if that snapped position is taken, it cascades
 *  diagonally until a free spot is found. Size inheritance is handled
 *  separately by the canvas effect via `consumeInheritSize`. */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_TILE_H,
  DEFAULT_TILE_W,
  findFreeTilePosition,
} from "./tilePlacement";

function pos(x: number, y: number) {
  return { x, y };
}

describe("findFreeTilePosition", () => {
  it("centers on viewport when no tiles exist", () => {
    const result = findFreeTilePosition(500, 400, []);
    expect(result.x).toBe(500 - DEFAULT_TILE_W / 2);
    expect(result.y).toBe(400 - DEFAULT_TILE_H / 2);
  });

  it("cascades diagonally when viewport center is taken", () => {
    const cx = 500;
    const cy = 400;
    const baseX = cx - DEFAULT_TILE_W / 2;
    const baseY = cy - DEFAULT_TILE_H / 2;
    const existing = [pos(baseX, baseY)];
    const result = findFreeTilePosition(cx, cy, existing);
    expect(result.x).not.toBe(baseX);
    expect(result.y).not.toBe(baseY);
  });

  it("cascades through multiple blockers", () => {
    const cx = 500;
    const cy = 400;
    const baseX = cx - DEFAULT_TILE_W / 2;
    const baseY = cy - DEFAULT_TILE_H / 2;
    const step = 48;
    const existing = [
      pos(baseX, baseY),
      pos(baseX + step, baseY + step),
      pos(baseX + 2 * step, baseY + 2 * step),
    ];
    const result = findFreeTilePosition(cx, cy, existing);
    expect(result.x).toBe(baseX + 3 * step);
    expect(result.y).toBe(baseY + 3 * step);
  });
});
