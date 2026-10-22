/** Wrap to [0, 360). Used for sector IDs and 8-way facing labels, not scan progress. */
export function normalizeDegrees(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Wrap to (-180, 180]. Frame orientation lives here; 180 and -180 are the same heading. */
export function wrapSigned180(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return a;
}

/**
 * Shortest signed step from `fromDeg` to `toDeg` in [-180, 180].
 * 359° → 0° is +1°, not -359°. 179° → -179° is +2°.
 */
export function unwrapDelta(fromDeg: number, toDeg: number): number {
  let delta = toDeg - fromDeg;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function shortestAngleDiff(aDeg: number, bDeg: number): number {
  return Math.abs(unwrapDelta(aDeg, bDeg));
}

export function circularEma(currentDeg: number, nextDeg: number, alpha: number): number {
  const clamped = Math.min(1, Math.max(0, alpha));
  return wrapSigned180(currentDeg + unwrapDelta(currentDeg, nextDeg) * clamped);
}

export function nearestSector(rotationDeg: number, intervalDeg: number): number {
  const yaw = normalizeDegrees(rotationDeg);
  const sector = Math.round(yaw / intervalDeg) * intervalDeg;
  return normalizeDegrees(sector);
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

const GEOMETRY_EPSILON = 1e-9;

/** Euclidean distance between two 3D points. */
export function distance3D(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.hypot(dx, dy, dz);
}

/**
 * Interior angle at vertex B between segments BA and BC, in degrees [0, 180].
 * Returns NaN when vectors are zero-length or coordinates are non-finite.
 */
export function angleAtVertex(a: Vec3Like, b: Vec3Like, c: Vec3Like): number {
  if (
    !Number.isFinite(a.x) ||
    !Number.isFinite(a.y) ||
    !Number.isFinite(a.z) ||
    !Number.isFinite(b.x) ||
    !Number.isFinite(b.y) ||
    !Number.isFinite(b.z) ||
    !Number.isFinite(c.x) ||
    !Number.isFinite(c.y) ||
    !Number.isFinite(c.z)
  ) {
    return Number.NaN;
  }

  const bax = a.x - b.x;
  const bay = a.y - b.y;
  const baz = a.z - b.z;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const bcz = c.z - b.z;

  const baLen = Math.hypot(bax, bay, baz);
  const bcLen = Math.hypot(bcx, bcy, bcz);
  if (baLen < GEOMETRY_EPSILON || bcLen < GEOMETRY_EPSILON) {
    return Number.NaN;
  }

  const dot = bax * bcx + bay * bcy + baz * bcz;
  const cosTheta = Math.min(1, Math.max(-1, dot / (baLen * bcLen)));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}
