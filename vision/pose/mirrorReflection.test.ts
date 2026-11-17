import { describe, expect, it } from 'vitest';
import type { PoseLandmark } from '../types';
import { drawHandWireframes } from '../hand/handWireframe';
import { blankLandmarks, setLandmark } from '../test/fixtures';
import { recordingContext } from '../test/recordingContext';
import type { PoseLandmarkName } from './landmarks';
import {
  cameraToBody,
  createMirrorProjection,
  DEFAULT_MIRROR_GEOMETRY,
  distanceFromSeparation,
  eyeDropPx,
  eyeDisplacementPx,
  eyeHorizontalFollowPx,
  eyeVerticalFollowPx,
  eyeFollowExtraDropIn,
  glassToCanvas,
  reflectOnGlass,
  scaleAboutEye,
  type MirrorGeometry,
  type MirrorPoint,
} from './mirrorReflection';
import { drawPoseWireframe } from './wireframe';

const FRAME = { width: 1280, height: 720 };
const CANVAS_W = 1080;
const CANVAS_H = 1920;
/**
 * Wide enough that the test camera sees the whole body, head to floor.
 * Scale 1 checks the exact reflection; the 1.5× default has its own tests.
 */
const GEOMETRY: MirrorGeometry = {
  ...DEFAULT_MIRROR_GEOMETRY,
  cameraDiagonalFovDeg: 120,
  cameraTiltDownDeg: 10,
  wireframeScale: 1,
  videoFollowGainX: 1,
  videoFollowGainY: 1,
};
const PX_PER_IN = CANVAS_H / GEOMETRY.screenHeightIn;

/** Inverse of `cameraToBody`: where a body point appears in the camera image. */
function bodyToCamera(body: MirrorPoint, geometry: MirrorGeometry = GEOMETRY) {
  const tilt = (geometry.cameraTiltDownDeg * Math.PI) / 180;
  const focal =
    Math.hypot(FRAME.width, FRAME.height) / 2 / Math.tan((geometry.cameraDiagonalFovDeg * Math.PI) / 360);
  const right = -body.x;
  const up = body.h - geometry.cameraHeightIn;
  const out = geometry.userDistanceIn;
  const forward = -up * Math.sin(tilt) + out * Math.cos(tilt);
  const down = -up * Math.cos(tilt) - out * Math.sin(tilt);
  return {
    x: 0.5 + ((right / forward) * focal) / FRAME.width,
    y: 0.5 + ((down / forward) * focal) / FRAME.height,
  };
}

type Body = Partial<Record<PoseLandmarkName, MirrorPoint>>;

/** Upright adult, 55" from the glass. Inches: x sideways, h from the floor. */
const STANDING: Body = {
  leftEye: { x: -1.3, h: 63 },
  rightEye: { x: 1.3, h: 63 },
  leftShoulder: { x: -7, h: 56 },
  rightShoulder: { x: 7, h: 56 },
  leftHip: { x: -4, h: 38 },
  rightHip: { x: 4, h: 38 },
  leftKnee: { x: -4, h: 20 },
  rightKnee: { x: 4, h: 20 },
  leftAnkle: { x: -4, h: 3 },
  rightAnkle: { x: 4, h: 3 },
};

/** Deep squat: head and torso drop, knees come forward and down, feet stay on the floor. */
const SQUATTING: Body = {
  leftEye: { x: -1.3, h: 33 },
  rightEye: { x: 1.3, h: 33 },
  leftShoulder: { x: -7, h: 26 },
  rightShoulder: { x: 7, h: 26 },
  leftHip: { x: -5, h: 15 },
  rightHip: { x: 5, h: 15 },
  leftKnee: { x: -8, h: 14 },
  rightKnee: { x: 8, h: 14 },
  leftAnkle: { x: -4, h: 3 },
  rightAnkle: { x: 4, h: 3 },
};

function cameraPose(body: Body): PoseLandmark[] {
  const landmarks = blankLandmarks(0);
  for (const [name, point] of Object.entries(body) as Array<[PoseLandmarkName, MirrorPoint]>) {
    setLandmark(landmarks, name, { ...bodyToCamera(point), visibility: 0.95 });
  }
  return landmarks;
}

function eyeOf(body: Body): MirrorPoint {
  return { x: (body.leftEye!.x + body.rightEye!.x) / 2, h: body.leftEye!.h };
}

function drawMirror(body: Body) {
  const drawn = recordingContext(CANVAS_W, CANVAS_H);
  const project = createMirrorProjection(eyeOf(body), FRAME, CANVAS_W, CANVAS_H, GEOMETRY);
  drawPoseWireframe(drawn.ctx, cameraPose(body), { project });
  return { ...drawn, project };
}

/** Canvas point where the viewer sees `point` in the mirror. */
function seen(point: MirrorPoint, eye: MirrorPoint): { x: number; y: number } {
  return glassToCanvas(reflectOnGlass(point, eye), CANVAS_W, CANVAS_H, GEOMETRY);
}

describe('camera to body', () => {
  it('puts the image center at camera height when the camera is level', () => {
    const level = { ...GEOMETRY, cameraTiltDownDeg: 0 };
    const center = cameraToBody({ x: 0.5, y: 0.5 }, FRAME, level)!;
    expect(center.x).toBeCloseTo(0);
    expect(center.h).toBeCloseTo(level.cameraHeightIn);
  });

  it('accounts for the downward camera tilt', () => {
    const center = cameraToBody({ x: 0.5, y: 0.5 }, FRAME, GEOMETRY)!;
    const drop = GEOMETRY.userDistanceIn * Math.tan((GEOMETRY.cameraTiltDownDeg * Math.PI) / 180);
    expect(center.h).toBeCloseTo(GEOMETRY.cameraHeightIn - drop);
  });

  it('recovers body positions, with image-left as the viewer’s right', () => {
    for (const point of Object.values(STANDING)) {
      const back = cameraToBody(bodyToCamera(point!), FRAME, GEOMETRY)!;
      expect(back.x).toBeCloseTo(point!.x, 6);
      expect(back.h).toBeCloseTo(point!.h, 6);
    }
    expect(bodyToCamera({ x: 10, h: 42 }).x).toBeLessThan(0.5);
  });
});

describe('mirror reflection', () => {
  it('shows a body point halfway between it and the eye on the glass', () => {
    expect(reflectOnGlass({ x: 0, h: 0 }, { x: 0, h: 63 })).toEqual({ x: 0, h: 31.5 });
    expect(reflectOnGlass({ x: 8, h: 40 }, { x: 2, h: 60 })).toEqual({ x: 5, h: 50 });
  });

  it('maps the glass to display pixels from the picture edges', () => {
    const bottom = GEOMETRY.screenBottomIn;
    const top = bottom + GEOMETRY.screenHeightIn;
    expect(glassToCanvas({ x: -GEOMETRY.screenWidthIn / 2, h: top }, CANVAS_W, CANVAS_H, GEOMETRY)).toEqual({
      x: 0,
      y: 0,
    });
    const corner = glassToCanvas({ x: GEOMETRY.screenWidthIn / 2, h: bottom }, CANVAS_W, CANVAS_H, GEOMETRY);
    expect(corner.x).toBeCloseTo(CANVAS_W);
    expect(corner.y).toBeCloseTo(CANVAS_H);
  });

  it('places each joint where the viewer sees it, not where the camera sees it', () => {
    const { arcs } = drawMirror(STANDING);
    const eye = eyeOf(STANDING);
    const hip = seen(STANDING.leftHip!, eye);
    expect(arcs.some((arc) => Math.abs(arc.x - hip.x) < 1e-6 && Math.abs(arc.y - hip.y) < 1e-6)).toBe(true);
    // Camera placement would differ: the camera sees the hip elsewhere on the display.
    const hipImage = bodyToCamera(STANDING.leftHip!);
    expect(Math.abs((1 - hipImage.y) * CANVAS_H - hip.y)).toBeGreaterThan(50);
  });

  it('shows the legs when standing', () => {
    const { arcs, lines } = drawMirror(STANDING);
    const ankle = seen(STANDING.leftAnkle!, eyeOf(STANDING));
    expect(ankle.y).toBeLessThan(CANVAS_H);
    expect(arcs.some((arc) => Math.abs(arc.y - ankle.y) < 1e-6)).toBe(true);
    expect(lines.some((line) => Math.abs(line.y2 - ankle.y) < 1e-6 || Math.abs(line.y1 - ankle.y) < 1e-6)).toBe(
      true,
    );
  });

  it('squatting moves the wireframe down onto the upper body and drops the legs off the mirror', () => {
    const standing = drawMirror(STANDING);
    const squat = drawMirror(SQUATTING);
    const squatEye = eyeOf(SQUATTING);

    // Standing, the shoulders' reflection is above the top of the display (glass 59.5" > 55.6").
    const shoulderStanding = seen(STANDING.leftShoulder!, eyeOf(STANDING));
    expect(shoulderStanding.y).toBeLessThan(0);
    expect(standing.arcs.some((arc) => Math.abs(arc.y - shoulderStanding.y) < 1e-6)).toBe(false);
    // Squatting, the upper body follows the reflection down onto the display.
    const shoulderSquat = seen(SQUATTING.leftShoulder!, squatEye);
    expect(shoulderSquat.y).toBeGreaterThan(0);
    expect(shoulderSquat.y).toBeGreaterThan(shoulderStanding.y);
    expect(squat.arcs.some((arc) => Math.abs(arc.y - shoulderSquat.y) < 1e-6)).toBe(true);

    // The feet's reflection is now below the bottom of the picture: not drawn.
    const ankleSquat = seen(SQUATTING.leftAnkle!, squatEye);
    expect(ankleSquat.y).toBeGreaterThan(CANVAS_H);
    expect(squat.arcs.every((arc) => arc.y <= CANVAS_H)).toBe(true);
    const ankleX = seen(SQUATTING.leftAnkle!, squatEye).x;
    expect(squat.arcs.some((arc) => Math.abs(arc.x - ankleX) < 1e-6)).toBe(false);
    // Knees are still in the mirror, so the thighs stay drawn.
    const knee = seen(SQUATTING.leftKnee!, squatEye);
    expect(knee.y).toBeLessThan(CANVAS_H);
    expect(squat.arcs.some((arc) => Math.abs(arc.x - knee.x) < 1e-6 && Math.abs(arc.y - knee.y) < 1e-6)).toBe(true);
    // Every stroke stays on the display; the shin is cut at the bottom edge.
    for (const line of squat.lines) {
      expect(Math.max(line.y1, line.y2)).toBeLessThanOrEqual(CANVAS_H + 1e-6);
    }
    expect(squat.lines.some((line) => Math.abs(Math.max(line.y1, line.y2) - CANVAS_H) < 1e-6)).toBe(true);
  });

  it('keeps the wireframe size constant: half body size on the glass', () => {
    const eye = eyeOf(STANDING);
    const left = seen(STANDING.leftShoulder!, eye);
    const right = seen(STANDING.rightShoulder!, eye);
    expect(Math.abs(right.x - left.x)).toBeCloseTo((14 / 2) * PX_PER_IN, 6);

    const lowerEye = { x: eye.x, h: eye.h - 10 };
    const left2 = seen(STANDING.leftShoulder!, lowerEye);
    const right2 = seen(STANDING.rightShoulder!, lowerEye);
    expect(Math.abs(right2.x - left2.x)).toBeCloseTo(Math.abs(right.x - left.x), 6);
  });

  it('moves the reflection sideways with the person', () => {
    const shifted: Body = Object.fromEntries(
      Object.entries(STANDING).map(([name, p]) => [name, { x: p!.x + 10, h: p!.h }]),
    );
    const before = seen(STANDING.leftShoulder!, eyeOf(STANDING));
    const after = seen(shifted.leftShoulder!, eyeOf(shifted));
    expect(after.x - before.x).toBeCloseTo(10 * PX_PER_IN, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('does not draw a body part the camera did not see', () => {
    const landmarks = cameraPose(STANDING);
    setLandmark(landmarks, 'leftAnkle', { x: 0.4, y: 1.3, visibility: 0.95 });
    const drawn = recordingContext(CANVAS_W, CANVAS_H);
    const project = createMirrorProjection(eyeOf(STANDING), FRAME, CANVAS_W, CANVAS_H, GEOMETRY);
    drawPoseWireframe(drawn.ctx, landmarks, { project });

    const imageBottom = cameraToBody({ x: 0.4, y: 1 }, FRAME, GEOMETRY)!;
    const edge = seen(imageBottom, eyeOf(STANDING));
    const shin = drawn.lines.find((line) => Math.abs(line.y2 - edge.y) < 1e-3 || Math.abs(line.y1 - edge.y) < 1e-3);
    expect(shin).toBeDefined();
    expect(drawn.arcs.filter((arc) => arc.y > edge.y + 1e-3)).toEqual([]);
  });

  it('seats the hand on the reflected wrist', () => {
    const landmarks = cameraPose(STANDING);
    const wrist = bodyToCamera({ x: -12, h: 40 });
    setLandmark(landmarks, 'leftWrist', { ...wrist, visibility: 0.9 });
    const hand = {
      landmarks: Array.from({ length: 21 }, (_, index) => ({ x: 0.2 + index * 0.003, y: 0.2, visibility: 0 })),
      handedness: 'Left' as const,
    };
    const project = createMirrorProjection(eyeOf(STANDING), FRAME, CANVAS_W, CANVAS_H, GEOMETRY);
    const fingers = recordingContext(CANVAS_W, CANVAS_H);
    drawHandWireframes(fingers.ctx, [hand], {
      project,
      sourceWidth: FRAME.width,
      sourceHeight: FRAME.height,
      poseLandmarks: landmarks,
    });
    const expected = project(wrist)!;
    expect(
      fingers.lines.some((line) => Math.abs(line.x1 - expected.x) < 1e-6 && Math.abs(line.y1 - expected.y) < 1e-6),
    ).toBe(true);
  });
});

describe('wireframe scale', () => {
  it('defaults to the true reflection size', () => {
    expect(DEFAULT_MIRROR_GEOMETRY.wireframeScale).toBe(1);
  });

  it('enlarges about the eyes, so the head stays put and limbs spread 1.5×', () => {
    const eye = eyeOf(STANDING);
    expect(scaleAboutEye(eye, eye, 1.5)).toEqual(eye);

    const scaled = { ...GEOMETRY, wireframeScale: 1.5 };
    const exact = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, GEOMETRY);
    const big = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, scaled);
    const eyeOnCanvas = glassToCanvas(eye, CANVAS_W, CANVAS_H, GEOMETRY);

    for (const name of ['leftHip', 'rightHip', 'leftKnee'] as const) {
      const image = bodyToCamera(STANDING[name]!);
      const a = exact(image)!;
      const b = big(image)!;
      expect(b.x - eyeOnCanvas.x).toBeCloseTo((a.x - eyeOnCanvas.x) * 1.5, 6);
      expect(b.y - eyeOnCanvas.y).toBeCloseTo((a.y - eyeOnCanvas.y) * 1.5, 6);
    }
    const hips = (project: typeof exact) =>
      Math.abs(project(bodyToCamera(STANDING.rightHip!))!.x - project(bodyToCamera(STANDING.leftHip!))!.x);
    expect(hips(big)).toBeCloseTo(hips(exact) * 1.5, 6);
  });

  it('keeps the same 1.5× size as the person moves', () => {
    const scaled = { ...GEOMETRY, wireframeScale: 1.5 };
    const width = (body: Body) => {
      const project = createMirrorProjection(eyeOf(body), FRAME, CANVAS_W, CANVAS_H, scaled);
      return Math.abs(
        project(bodyToCamera(body.rightShoulder!))!.x - project(bodyToCamera(body.leftShoulder!))!.x,
      );
    };
    expect(width(STANDING)).toBeCloseTo(14 * 0.5 * 1.5 * PX_PER_IN, 6);
    expect(width(SQUATTING)).toBeCloseTo(width(STANDING), 6);
  });
});

describe('eyeDropPx', () => {
  it('is the eye drop below this viewer’s own standing eye level, in display pixels', () => {
    // A shorter viewer (56") standing still does not push the panel down.
    expect(eyeDropPx({ x: 0, h: 56 }, 56, GEOMETRY, CANVAS_H)).toBe(0);
    expect(eyeDropPx({ x: 0, h: 46 }, 56, GEOMETRY, CANVAS_H)).toBeCloseTo(10 * PX_PER_IN, 6);
  });

  it('matches how far the eyes’ reflection moves on the display', () => {
    const stand = eyeOf(STANDING);
    const squat = eyeOf(SQUATTING);
    const moved =
      glassToCanvas(squat, CANVAS_W, CANVAS_H, GEOMETRY).y - glassToCanvas(stand, CANVAS_W, CANVAS_H, GEOMETRY).y;
    expect(eyeDropPx(squat, stand.h, GEOMETRY, CANVAS_H)).toBeCloseTo(moved, 6);
  });

  it('never goes negative', () => {
    expect(eyeDropPx({ x: 0, h: 70 }, 63, GEOMETRY, CANVAS_H)).toBe(0);
  });
});

describe('eyeHorizontalFollowPx', () => {
  it('is signed: right when the eyes move right of picture center, left when left', () => {
    const pxPerIn = CANVAS_W / GEOMETRY.screenWidthIn;
    expect(eyeHorizontalFollowPx({ x: 3, h: 63 }, GEOMETRY, CANVAS_W)).toBeCloseTo(3 * pxPerIn, 6);
    expect(eyeHorizontalFollowPx({ x: -3, h: 63 }, GEOMETRY, CANVAS_W)).toBeCloseTo(-3 * pxPerIn, 6);
  });
});

describe('eyeVerticalFollowPx', () => {
  it('is signed: down when eyes drop, up when eyes rise above standing', () => {
    expect(eyeVerticalFollowPx({ x: 0, h: 61 }, 63, GEOMETRY, CANVAS_H)).toBeCloseTo(2 * PX_PER_IN, 6);
    expect(eyeVerticalFollowPx({ x: 0, h: 65 }, 63, GEOMETRY, CANVAS_H)).toBeCloseTo(-2 * PX_PER_IN, 6);
  });
});

describe('viewer distance', () => {
  /** Image position of a body point when the person stands `distanceIn` from the glass. */
  const atDistance = (body: MirrorPoint, distanceIn: number) =>
    bodyToCamera(body, { ...GEOMETRY, userDistanceIn: distanceIn });

  it('places points on the plane at the given distance', () => {
    for (const distanceIn of [45, 55, 65]) {
      const back = cameraToBody(atDistance({ x: 6, h: 50 }, distanceIn), FRAME, GEOMETRY, distanceIn)!;
      expect(back.x).toBeCloseTo(6, 6);
      expect(back.h).toBeCloseTo(50, 6);
    }
  });

  it('measures the distance from the shoulder width in the image', () => {
    for (const distanceIn of [45, 50, 55, 60, 65]) {
      const left = atDistance({ x: -GEOMETRY.shoulderWidthIn / 2, h: 56 }, distanceIn);
      const right = atDistance({ x: GEOMETRY.shoulderWidthIn / 2, h: 56 }, distanceIn);
      expect(distanceFromSeparation(left, right, GEOMETRY.shoulderWidthIn, FRAME, GEOMETRY)).toBeCloseTo(
        distanceIn,
        6,
      );
    }
  });

  it('keeps the wireframe on the reflection away from the default distance', () => {
    const distanceIn = 62;
    const eye = { x: 0, h: 63 };
    const hip = { x: -4, h: 38 };
    const project = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, GEOMETRY, distanceIn);
    const drawn = project(atDistance(hip, distanceIn))!;
    const expected = seen(hip, eye);
    expect(drawn.x).toBeCloseTo(expected.x, 6);
    expect(drawn.y).toBeCloseTo(expected.y, 6);
    // Assuming the default 55" instead would misplace it.
    const assumed = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, GEOMETRY)(atDistance(hip, distanceIn))!;
    expect(Math.hypot(assumed.x - expected.x, assumed.y - expected.y)).toBeGreaterThan(10);
  });
});

describe('eye follow gain', () => {
  it('defaults to 1.5: the wireframe moves 3" when the eyes drop 2"', () => {
    expect(DEFAULT_MIRROR_GEOMETRY.eyeFollowGain).toBe(1.5);
    expect(eyeFollowExtraDropIn({ x: 0, h: 61 }, 63, DEFAULT_MIRROR_GEOMETRY)).toBeCloseTo(1, 9);
  });

  it('adds nothing when standing, above standing height, or with gain 1', () => {
    expect(eyeFollowExtraDropIn({ x: 0, h: 63 }, 63, DEFAULT_MIRROR_GEOMETRY)).toBe(0);
    expect(eyeFollowExtraDropIn({ x: 0, h: 66 }, 63, DEFAULT_MIRROR_GEOMETRY)).toBe(0);
    expect(eyeFollowExtraDropIn({ x: 0, h: 50 }, 63, { ...DEFAULT_MIRROR_GEOMETRY, eyeFollowGain: 1 })).toBe(0);
  });

  /** Canvas y of the wireframe head (the eye landmark) for a viewer whose eyes are at `eyeH`. */
  function headY(eyeH: number, standingH: number, geometry: MirrorGeometry) {
    const eye = { x: 0, h: eyeH };
    const extra = eyeFollowExtraDropIn(eye, standingH, geometry);
    const project = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, geometry, geometry.userDistanceIn, extra);
    return project(bodyToCamera(eye, geometry))!.y;
  }

  it('moves the wireframe 3" down when the eyes drop 2" from standing', () => {
    const geometry = { ...GEOMETRY, eyeFollowGain: 1.5 };
    const moved = headY(61, 63, geometry) - headY(63, 63, geometry);
    expect(moved).toBeCloseTo(3 * PX_PER_IN, 6);
  });

  it('scales with the drop: 10" of eye drop moves the wireframe 15"', () => {
    const geometry = { ...GEOMETRY, eyeFollowGain: 1.5 };
    expect(headY(53, 63, geometry) - headY(63, 63, geometry)).toBeCloseTo(15 * PX_PER_IN, 6);
    // Gain 1 is the plain reflection: it moves exactly with the eyes.
    const plain = { ...GEOMETRY, eyeFollowGain: 1 };
    expect(headY(53, 63, plain) - headY(63, 63, plain)).toBeCloseTo(10 * PX_PER_IN, 6);
  });

  it('shifts the whole wireframe without changing its size or posture', () => {
    const eye = eyeOf(SQUATTING);
    const image = (name: PoseLandmarkName) => bodyToCamera(SQUATTING[name]!);
    const without = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, GEOMETRY, GEOMETRY.userDistanceIn, 0);
    const withDrop = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, GEOMETRY, GEOMETRY.userDistanceIn, 4);
    for (const name of ['leftShoulder', 'rightShoulder', 'leftHip', 'leftKnee'] as const) {
      const a = without(image(name))!;
      const b = withDrop(image(name))!;
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.y - a.y).toBeCloseTo(4 * PX_PER_IN, 6);
    }
  });

  it('pushes the legs off the bottom of the mirror sooner', () => {
    const eye = eyeOf(SQUATTING);
    const knee = bodyToCamera(SQUATTING.leftKnee!);
    const without = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, GEOMETRY)(knee)!;
    const extra = eyeFollowExtraDropIn(eye, eyeOf(STANDING).h, { ...GEOMETRY, eyeFollowGain: 1.5 });
    const withDrop = createMirrorProjection(eye, FRAME, CANVAS_W, CANVAS_H, GEOMETRY, GEOMETRY.userDistanceIn, extra)(
      knee,
    )!;
    expect(without.y).toBeLessThan(CANVAS_H);
    expect(withDrop.y).toBeGreaterThan(without.y);
  });
});

describe('eyeDisplacementPx', () => {
  it('is zero at the start point and equals the eye travel after that', () => {
    const start = { x: 2, h: 60 };
    expect(eyeDisplacementPx(start, start, GEOMETRY, CANVAS_W, CANVAS_H)).toEqual({ x: 0, y: 0 });
    const moved = eyeDisplacementPx({ x: 5, h: 57 }, start, GEOMETRY, CANVAS_W, CANVAS_H);
    expect(moved.x).toBeCloseTo(3 * (CANVAS_W / GEOMETRY.screenWidthIn), 6);
    expect(moved.y).toBeCloseTo(3 * PX_PER_IN, 6);
  });

  it('scales each axis by its own sensitivity', () => {
    const start = { x: 0, h: 60 };
    const geometry = { ...GEOMETRY, videoFollowGainX: 0.5, videoFollowGainY: 0 };
    const moved = eyeDisplacementPx({ x: 4, h: 56 }, start, geometry, CANVAS_W, CANVAS_H);
    expect(moved.x).toBeCloseTo(2 * (CANVAS_W / GEOMETRY.screenWidthIn), 6);
    expect(moved.y).toBe(0);
  });
});
