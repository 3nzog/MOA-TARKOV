import { describe, expect, it } from 'vitest';
import { apply, headingDelta, homography, invert, spreadPoints, type CalPoint, type Mat3 } from './artCalibration';

const perspective: Mat3 = [0.8, -0.3, 400, 0.2, 0.9, 300, 0.0004, -0.0002, 1];
const pts = (m: Mat3, game: [number, number][]): CalPoint[] =>
  game.map(([gx, gz]) => {
    const [px, py] = apply(m, gx, gz);
    return { gx, gz, px, py };
  });

describe('art map calibration', () => {
  it('4 clicks recover a perspective mapping (3D renders) exactly', () => {
    const H = homography(pts(perspective, [[-300, -200], [400, -250], [380, 300], [-280, 260]]))!;
    for (const [x, z] of [[0, 0], [123, -45], [-250, 200], [350, 280]]) {
      const [ex, ey] = apply(perspective, x, z);
      const [gx, gy] = apply(H, x, z);
      expect(gx).toBeCloseTo(ex, 4);
      expect(gy).toBeCloseTo(ey, 4);
    }
  });

  it('more clicks are averaged, and slightly off clicks stay close', () => {
    const p = pts(perspective, [[-300, -200], [400, -250], [380, 300], [-280, 260], [0, 0], [100, -100]]);
    p[0].px += 3;
    p[3].py -= 2;
    const H = homography(p)!;
    const [ex, ey] = apply(perspective, 50, 50);
    const [gx, gy] = apply(H, 50, 50);
    expect(Math.hypot(gx - ex, gy - ey)).toBeLessThan(6);
  });

  it('the inverse goes back from picture to game', () => {
    const H = homography(pts(perspective, [[-300, -200], [400, -250], [380, 300], [-280, 260]]))!;
    const Hinv = invert(H)!;
    const [px, py] = apply(H, 77, -33);
    const [x, z] = apply(Hinv, px, py);
    expect(x).toBeCloseTo(77, 6);
    expect(z).toBeCloseTo(-33, 6);
  });

  it('points in a line, or fewer than 4, define nothing', () => {
    expect(homography(pts(perspective, [[0, 0], [10, 10], [20, 20], [30, 30]]))).toBeNull();
    expect(homography(pts(perspective, [[0, 0], [10, 0], [0, 10]]))).toBeNull();
  });

  it('heading: a picture drawn like the vector map needs no extra turn', () => {
    // Vector map with rotation 180: +x is drawn pointing left (-180°).
    const flipped: Mat3 = [-1, 0, 500, 0, 1, 500, 0, 0, 1];
    expect(((headingDelta(flipped, 0, 0, 180) % 360) + 360) % 360).toBeCloseTo(0, 6);
    // A picture turned 90° from it.
    const turned: Mat3 = [0, -1, 500, 1, 0, 500, 0, 0, 1];
    expect(((headingDelta(turned, 0, 0, 180) % 360) + 360) % 360).toBeCloseTo(270, 6);
  });

  it('reference exits are spread over the map', () => {
    const items = [
      { x: 0, z: 0, n: 'c' }, { x: 10, z: 5, n: 'c2' },
      { x: -500, z: -400, n: 'sw' }, { x: 500, z: -400, n: 'se' }, { x: 500, z: 400, n: 'ne' }, { x: -500, z: 400, n: 'nw' },
    ];
    const picked = spreadPoints(items, 4).map((p) => p.n).sort();
    expect(picked).toEqual(['ne', 'nw', 'se', 'sw']);
  });
});
