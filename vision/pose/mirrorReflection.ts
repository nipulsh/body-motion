import type { Point2D, WireframeProjection } from "./wireframe";

/**
 * Physical Smart Mirror setup, in inches and degrees. The display sits behind
 * two-way glass and the camera is mounted in the glass looking at the person.
 */
export interface MirrorGeometry {
  /** Visible picture width of the display behind the glass. */
  screenWidthIn: number;
  /** Visible picture height of the display behind the glass. */
  screenHeightIn: number;
  /** Floor to the bottom edge of the picture. */
  screenBottomIn: number;
  /** Picture center relative to the camera, as seen facing the mirror. Positive is right. */
  screenCenterOffsetIn: number;
  /** Floor to the camera lens. */
  cameraHeightIn: number;
  /** Downward tilt of the camera. 0 looks straight out of the glass. */
  cameraTiltDownDeg: number;
  /** Diagonal field of view of the camera. */
  cameraDiagonalFovDeg: number;
  /**
   * Glass to the person, used until a distance is measured from the shoulders.
   * The body is treated as a plane at the current distance.
   */
  userDistanceIn: number;
  /** Real distance between the two shoulder landmarks, used to measure distance each frame. */
  shoulderWidthIn: number;
  /** Eye height used until the eyes are detected (standing adult). */
  defaultEyeHeightIn: number;
  /**
   * In decoupled mirror mode: arm segment length multiplier (1.5 ≈ 1.5× the
   * user's measured upper arm and forearm) and squat depth follow gain
   * (10 cm descent → 15 cm wireframe shift at 1.5). Legacy mirror projection
   * also scales the whole skeleton about the eyes when landmarks are not decoupled.
   */
  wireframeScale: number;
  /**
   * How far the wireframe moves per inch the eyes drop below standing eye
   * level. 1 moves with the reflection; 1.5 moves 3" when the eyes drop 2",
   * so the wireframe leads the person down. Applies downward only.
   */
  eyeFollowGain: number;
  /**
   * Sensitivity of the camera video to sideways eye movement. 1 moves the video
   * as far as the eyes move; 0.5 half as far; 0 keeps it still.
   */
  videoFollowGainX: number;
  /** Same as `videoFollowGainX`, for up-down eye movement. */
  videoFollowGainY: number;
  /**
   * Zoom of the camera video (and the wireframe over it) about the picture
   * centre. 1 is the full camera view, 1.5 is 50% closer, 2 is twice as close.
   */
  videoZoom: number;
  /**
   * Margins of the video container, in pixels, in the directions seen on the
   * portrait TV. They shift the container without resizing it: a positive margin
   * pushes the video away from that edge (left 40 moves it 40px right, top 40
   * moves it 40px down), a negative one pulls it toward that edge. Opposite
   * margins cancel; the video's size never changes.
   */
  videoMarginTopPx: number;
  videoMarginRightPx: number;
  videoMarginBottomPx: number;
  videoMarginLeftPx: number;
  /**
   * Show the camera video behind the wireframe. False shows a plain black
   * background; the camera keeps running and the wireframe is still drawn.
   */
  showVideo: boolean;
}

const PORTRAIT_42_IN = {
  width: (42 * 9) / Math.hypot(16, 9),
  height: (42 * 16) / Math.hypot(16, 9),
};

/**
 * Site defaults: 42" 16:9 display in portrait (≈20.6" × 36.6"), bottom edge 19"
 * from the floor, camera at 42" tilted slightly down (EMEET webcam, 90° diagonal),
 * person 50–60" from the glass. Tilt and FOV are estimates; tune on site.
 */
export const DEFAULT_MIRROR_GEOMETRY: Readonly<MirrorGeometry> = {
  screenWidthIn: PORTRAIT_42_IN.width,
  screenHeightIn: PORTRAIT_42_IN.height,
  screenBottomIn: 19,
  screenCenterOffsetIn: 0,
  cameraHeightIn: 42,
  cameraTiltDownDeg: 8,
  cameraDiagonalFovDeg: 90,
  userDistanceIn: 55,
  shoulderWidthIn: 14.5,
  defaultEyeHeightIn: 63,
  wireframeScale: 1,
  eyeFollowGain: 1.5,
  videoFollowGainX: 0.25,
  videoFollowGainY: 0.6,
  videoZoom: 1.5,
  videoMarginTopPx: 0,
  videoMarginRightPx: 250,
  videoMarginBottomPx: 50,
  videoMarginLeftPx: 130,
  showVideo: false,
};

/** A point on the person (or on the glass): sideways inches as seen facing the mirror, height from the floor. */
export interface MirrorPoint {
  x: number;
  h: number;
}

export interface FrameSize {
  width: number;
  height: number;
}

const DEG = Math.PI / 180;

/**
 * Offset from the camera, per inch of distance from the glass, of the point
 * a camera ray hits. Null when the ray never reaches a plane in front.
 */
function rayPerInch(
  point: Point2D,
  frame: FrameSize,
  geometry: MirrorGeometry,
): MirrorPoint | null {
  if (frame.width <= 0 || frame.height <= 0) return null;
  const halfFov = (geometry.cameraDiagonalFovDeg * DEG) / 2;
  const focal = Math.hypot(frame.width, frame.height) / 2 / Math.tan(halfFov);
  const right = ((point.x - 0.5) * frame.width) / focal;
  const down = ((point.y - 0.5) * frame.height) / focal;
  const tilt = geometry.cameraTiltDownDeg * DEG;
  const dirUp = -Math.sin(tilt) - down * Math.cos(tilt);
  const dirOut = Math.cos(tilt) - down * Math.sin(tilt);
  if (dirOut <= 1e-6) return null;
  // The camera faces the person, so its right is the viewer's left.
  return { x: -right / dirOut, h: dirUp / dirOut };
}

/**
 * Where a normalized camera landmark sits on the person, by casting the camera
 * ray onto the body plane `distanceIn` from the glass. Null when the ray never
 * reaches that plane.
 */
export function cameraToBody(
  point: Point2D,
  frame: FrameSize,
  geometry: MirrorGeometry,
  distanceIn: number = geometry.userDistanceIn,
): MirrorPoint | null {
  const ray = rayPerInch(point, frame, geometry);
  if (!ray) return null;
  return {
    x: distanceIn * ray.x,
    h: geometry.cameraHeightIn + distanceIn * ray.h,
  };
}

/**
 * Distance from the glass at which two image points are `realSeparationIn`
 * apart on the body plane (e.g. the shoulders). Null when it cannot be measured.
 */
export function distanceFromSeparation(
  a: Point2D,
  b: Point2D,
  realSeparationIn: number,
  frame: FrameSize,
  geometry: MirrorGeometry,
): number | null {
  const rayA = rayPerInch(a, frame, geometry);
  const rayB = rayPerInch(b, frame, geometry);
  if (!rayA || !rayB || realSeparationIn <= 0) return null;
  const perInch = Math.hypot(rayA.x - rayB.x, rayA.h - rayB.h);
  if (perInch <= 1e-9) return null;
  return realSeparationIn / perInch;
}

/**
 * Where the viewer sees a body point on the glass. In a flat mirror the
 * reflection of P seen from eye E (both at the same distance) crosses the
 * glass halfway between them.
 */
export function reflectOnGlass(
  body: MirrorPoint,
  eye: MirrorPoint,
): MirrorPoint {
  return { x: (body.x + eye.x) / 2, h: (body.h + eye.h) / 2 };
}

/**
 * Enlarge (or shrink) a glass position about where the eyes themselves appear
 * on the glass. The eyes reflect onto the glass at the eye position.
 */
export function scaleAboutEye(
  glass: MirrorPoint,
  eye: MirrorPoint,
  scale: number,
): MirrorPoint {
  return {
    x: eye.x + (glass.x - eye.x) * scale,
    h: eye.h + (glass.h - eye.h) * scale,
  };
}

/**
 * How far the viewer's eye reflection sits below their own standing eye
 * level, in display pixels. The eyes reflect onto the glass at their own
 * height, so this is the eye drop itself. Never negative.
 */
export function eyeDropPx(
  eye: MirrorPoint,
  standingEyeHeightIn: number,
  geometry: MirrorGeometry,
  canvasHeight: number,
): number {
  const dropIn = Math.max(0, standingEyeHeightIn - eye.h);
  return (dropIn / geometry.screenHeightIn) * canvasHeight;
}

/**
 * Signed vertical follow for a camera preview: positive when the eyes sit below
 * their standing height, negative when above. Uses the same smoothed eye body
 * position as mirror wireframe placement (`MirrorViewer.eye`).
 */
export function eyeVerticalFollowPx(
  eye: MirrorPoint,
  standingEyeHeightIn: number,
  geometry: MirrorGeometry,
  canvasHeight: number,
): number {
  if (canvasHeight <= 0 || geometry.screenHeightIn <= 0) return 0;
  return (
    ((standingEyeHeightIn - eye.h) / geometry.screenHeightIn) * canvasHeight
  );
}

/**
 * Signed sideways follow for a camera preview: positive moves the picture right
 * as seen facing the mirror, negative left. The eyes reflect onto the glass at
 * their own sideways position, so this is where they sit relative to the
 * picture center.
 */
export function eyeHorizontalFollowPx(
  eye: MirrorPoint,
  geometry: MirrorGeometry,
  canvasWidth: number,
): number {
  if (canvasWidth <= 0 || geometry.screenWidthIn <= 0) return 0;
  return (
    ((eye.x - geometry.screenCenterOffsetIn) / geometry.screenWidthIn) *
    canvasWidth
  );
}

/**
 * Pixels to move a camera preview so it travels the same distance as the eyes
 * did since `start` (where the eyes were when the video began). Positive x is
 * right and positive y is down, as seen facing the mirror. Scaled per axis by
 * `videoFollowGainX` / `videoFollowGainY`.
 */
export function eyeDisplacementPx(
  eye: MirrorPoint,
  start: MirrorPoint,
  geometry: MirrorGeometry,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  if (geometry.screenWidthIn <= 0 || geometry.screenHeightIn <= 0)
    return { x: 0, y: 0 };
  return {
    x:
      ((eye.x - start.x) / geometry.screenWidthIn) *
      canvasWidth *
      geometry.videoFollowGainX,
    y:
      ((start.h - eye.h) / geometry.screenHeightIn) *
      canvasHeight *
      geometry.videoFollowGainY,
  };
}

/**
 * `eye`, measured with the body `fromDistanceIn` from the glass, moved to where the same camera
 * ray meets the body plane `toDistanceIn` away. Two eye positions compared at one distance differ
 * only by how the eyes moved, not by a change in the measured distance.
 */
export function eyeAtDistance(
  eye: MirrorPoint,
  fromDistanceIn: number,
  toDistanceIn: number,
  geometry: MirrorGeometry,
): MirrorPoint {
  if (
    !(fromDistanceIn > 0) ||
    !(toDistanceIn > 0) ||
    !Number.isFinite(fromDistanceIn) ||
    !Number.isFinite(toDistanceIn)
  ) {
    return eye;
  }
  const scale = toDistanceIn / fromDistanceIn;
  return {
    x: eye.x * scale,
    h: geometry.cameraHeightIn + (eye.h - geometry.cameraHeightIn) * scale,
  };
}

/**
 * `offset` (screen pixels) without any part that carries the picture further `up` than where it
 * started. `up` is a screen unit vector, the way the body points on screen; null leaves `offset`
 * as it is. The picture may follow the patient down, never lift above their standing place.
 */
export function withoutRise(offset: Point2D, up: Point2D | null): Point2D {
  if (!up) return offset;
  const rise = offset.x * up.x + offset.y * up.y;
  return rise > 0
    ? { x: offset.x - rise * up.x, y: offset.y - rise * up.y }
    : offset;
}

/** What the mirror knows about the person in front of it this frame. */
export interface MirrorViewer {
  /** Smoothed eye position (the mirror viewpoint). */
  eye: MirrorPoint;
  /** This person's eye height when standing upright. */
  standingEyeHeightIn: number;
  /** Current distance from the glass. */
  distanceIn: number;
  /** True once the eyes have actually been detected, so `eye` is not the fallback position. */
  eyeDetected?: boolean;
}

/** Glass position to display pixels. Points off the picture land outside the canvas. */
export function glassToCanvas(
  glass: MirrorPoint,
  canvasWidth: number,
  canvasHeight: number,
  geometry: MirrorGeometry,
): Point2D {
  const left = geometry.screenCenterOffsetIn - geometry.screenWidthIn / 2;
  const top = geometry.screenBottomIn + geometry.screenHeightIn;
  return {
    x: ((glass.x - left) / geometry.screenWidthIn) * canvasWidth,
    y: ((top - glass.h) / geometry.screenHeightIn) * canvasHeight,
  };
}

/**
 * Extra downward shift of the whole wireframe, in inches, so it moves
 * `eyeFollowGain` times as far as the eyes drop below standing eye level.
 * The reflection already moves 1x with the eyes; this adds the rest.
 */
export function eyeFollowExtraDropIn(
  eye: MirrorPoint,
  standingEyeHeightIn: number,
  geometry: MirrorGeometry,
): number {
  const drop = Math.max(0, standingEyeHeightIn - eye.h);
  return Math.max(0, geometry.eyeFollowGain - 1) * drop;
}

/**
 * Camera landmark → the pixel where the viewer sees that body part in the
 * mirror, shifted down by `extraDropIn` (see `eyeFollowExtraDropIn`).
 */
export function createMirrorProjection(
  eye: MirrorPoint,
  frame: FrameSize,
  canvasWidth: number,
  canvasHeight: number,
  geometry: MirrorGeometry,
  distanceIn: number = geometry.userDistanceIn,
  extraDropIn = 0,
): WireframeProjection {
  return (point) => {
    const body = cameraToBody(point, frame, geometry, distanceIn);
    if (!body) return null;
    const glass = scaleAboutEye(
      reflectOnGlass(body, eye),
      eye,
      geometry.wireframeScale,
    );
    return glassToCanvas(
      { x: glass.x, h: glass.h - extraDropIn },
      canvasWidth,
      canvasHeight,
      geometry,
    );
  };
}
