/**
 * Real ten-pin dimensions (USBC specifications), in meters and kilograms.
 *
 * World frame shared by physics and rendering: x to the bowler's right, y up,
 * the lane runs toward -z. The foul line is z = 0.
 */

const INCH = 0.0254;
const FOOT = 12 * INCH;

export const LANE = {
  width: 41.5 * INCH,
  halfWidth: (41.5 * INCH) / 2,
  boards: 39,
  /** Foul line to the centre of the head pin spot. */
  foulLineToHeadPin: 60 * FOOT,
  /** Head pin spot to the pit edge (tail plank). */
  headPinToPitEdge: 34.1875 * INCH,
  /** A typical house oil pattern: slick for 40 ft, dry after. */
  oilLength: 40 * FOOT,
  gutterWidth: 9.25 * INCH,
  gutterDepth: 1.875 * INCH,
  /** Kickback to kickback across the pin deck. */
  kickbackSpan: 60 * INCH,
} as const;

export const HEAD_PIN_Z = -LANE.foulLineToHeadPin;
export const PIT_EDGE_Z = HEAD_PIN_Z - LANE.headPinToPitEdge;
export const OIL_END_Z = -LANE.oilLength;

export const PIN_SPACING = 12 * INCH;
const ROW_SPACING = PIN_SPACING * Math.sin(Math.PI / 3);

/** Pin spots 1..10 (index 0 is pin 1). Pin 7 is the bowler's left corner, pin 10 the right. */
export const PIN_SPOTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 0, z: HEAD_PIN_Z },
  { x: -PIN_SPACING / 2, z: HEAD_PIN_Z - ROW_SPACING },
  { x: PIN_SPACING / 2, z: HEAD_PIN_Z - ROW_SPACING },
  { x: -PIN_SPACING, z: HEAD_PIN_Z - 2 * ROW_SPACING },
  { x: 0, z: HEAD_PIN_Z - 2 * ROW_SPACING },
  { x: PIN_SPACING, z: HEAD_PIN_Z - 2 * ROW_SPACING },
  { x: -1.5 * PIN_SPACING, z: HEAD_PIN_Z - 3 * ROW_SPACING },
  { x: -0.5 * PIN_SPACING, z: HEAD_PIN_Z - 3 * ROW_SPACING },
  { x: 0.5 * PIN_SPACING, z: HEAD_PIN_Z - 3 * ROW_SPACING },
  { x: 1.5 * PIN_SPACING, z: HEAD_PIN_Z - 3 * ROW_SPACING },
];

export const BALL = {
  /** 8.5 in, a standard ball. */
  radius: (8.5 * INCH) / 2,
  /** 15 lb. */
  mass: 6.8,
} as const;

/** Where the ball is laid on the lane at release, just past the foul line. */
export const BALL_RELEASE_Z = -0.35;

export const PIN = {
  height: 15 * INCH,
  /** 3 lb 6 oz .. 3 lb 10 oz. */
  mass: 1.55,
  /** Neck: the lower body hull ends here and the head hull begins. */
  neckHeight: 10 * INCH,
} as const;

/** Pin contour: [height, diameter] in inches, base to crown. */
const PIN_CONTOUR_INCHES: ReadonlyArray<readonly [number, number]> = [
  [0, 2.031],
  [0.75, 2.828],
  [2.25, 3.906],
  [3.375, 4.51],
  [4.5, 4.766],
  [5.875, 4.563],
  [7.25, 3.927],
  [8.625, 2.973],
  [9.375, 2.348],
  [10, 1.797],
  [10.875, 1.87],
  [11.75, 2.209],
  [12.625, 2.476],
  [13.5, 2.547],
  [14.375, 2.0],
  [14.75, 1.4],
  [14.95, 0.6],
  [15, 0],
];

/** Pin profile as { r, h } in meters, base to crown. */
export const PIN_PROFILE: ReadonlyArray<{ r: number; h: number }> = PIN_CONTOUR_INCHES.map(
  ([h, d]) => ({ h: h * INCH, r: (d * INCH) / 2 }),
);

/** Radius of the pin profile at a height, linearly interpolated. */
export function pinRadiusAt(h: number): number {
  const p = PIN_PROFILE;
  if (h <= p[0].h) return p[0].r;
  for (let i = 1; i < p.length; i += 1) {
    if (h <= p[i].h) {
      const a = p[i - 1];
      const b = p[i];
      const t = (h - a.h) / (b.h - a.h);
      return a.r + (b.r - a.r) * t;
    }
  }
  return p[p.length - 1].r;
}
