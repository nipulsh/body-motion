import { describe, expect, it } from 'vitest';
import { drawHandWireframes, HAND_WIREFRAME_SEGMENTS } from '../hand/handWireframe';
import { blankLandmarks, setLandmark } from '../test/fixtures';
import {
  drawPoseWireframe,
  fitLandmarkToCanvas,
  mapNormalizedToContainCanvas,
  jointRadiusForVisibility,
  toWireframePoint,
  WIREFRAME_JOINTS,
  WIREFRAME_MIN_VISIBILITY,
  WIREFRAME_SEGMENTS,
} from './wireframe';

describe('fitLandmarkToCanvas', () => {
  it('letterboxes a landscape camera into a portrait viewport without stretching', () => {
    const top = fitLandmarkToCanvas({ x: 0.5, y: 0 }, 900, 1600, 1600, 900);
    const bottom = fitLandmarkToCanvas({ x: 0.5, y: 1 }, 900, 1600, 1600, 900);
    const span = bottom.y - top.y;

    expect(top.x).toBeCloseTo(450);
    expect(span).toBeCloseTo(900 / (1600 / 900));
    expect(span).toBeLessThan(1600);
    expect((top.y + bottom.y) / 2).toBeCloseTo(800);
  });

  it('centers a portrait camera inside a wider viewport', () => {
    const left = fitLandmarkToCanvas({ x: 0, y: 0.5 }, 1600, 900, 900, 1600);
    const right = fitLandmarkToCanvas({ x: 1, y: 0.5 }, 1600, 900, 900, 1600);

    expect(right.x - left.x).toBeCloseTo(900 * (900 / 1600));
    expect((left.x + right.x) / 2).toBeCloseTo(800);
    expect(left.y).toBeCloseTo(450);
  });

  it('matches mapNormalizedToContainCanvas helper', () => {
    const viaHelper = mapNormalizedToContainCanvas(0.25, 0.75, 400, 800, 1920, 1080);
    const direct = fitLandmarkToCanvas({ x: 0.25, y: 0.75 }, 400, 800, 1920, 1080);
    expect(viaHelper).toEqual(direct);
  });

  it('keeps the existing unmirrored image x axis unless mirrorX is set', () => {
    const plain = fitLandmarkToCanvas({ x: 0.25, y: 0.5 }, 200, 200, 640, 480);
    const mirrored = fitLandmarkToCanvas({ x: 0.25, y: 0.5 }, 200, 200, 640, 480, true);

    expect(plain.x).toBeLessThan(100);
    expect(mirrored.x).toBeGreaterThan(100);
    expect(plain.x + mirrored.x).toBeCloseTo(200);
  });
});

const POSENET_LIMBS = [
  ['leftHip', 'leftShoulder'],
  ['leftElbow', 'leftShoulder'],
  ['leftElbow', 'leftWrist'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightShoulder'],
  ['rightElbow', 'rightShoulder'],
  ['rightElbow', 'rightWrist'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['leftShoulder', 'rightShoulder'],
  ['leftHip', 'rightHip'],
] as const;

const FACE_JOINTS = ['nose', 'leftEye', 'rightEye', 'leftEar', 'rightEar'] as const;

function hasArmSegment(
  segments: readonly (readonly [string, string])[],
  a: string,
  b: string,
): boolean {
  return segments.some(([from, to]) => (from === a && to === b) || (from === b && to === a));
}

describe('PoseNet stick figure', () => {
  it('draws the same limb connections as PoseNet and leaves the face unconnected', () => {
    for (const limb of POSENET_LIMBS) {
      expect(hasArmSegment(WIREFRAME_SEGMENTS, limb[0], limb[1])).toBe(true);
    }
    expect(WIREFRAME_MIN_VISIBILITY).toBe(0.2);

    for (const name of FACE_JOINTS) {
      expect(WIREFRAME_JOINTS).toContain(name);
      expect(WIREFRAME_SEGMENTS.some(([from, to]) => from === name || to === name)).toBe(false);
    }
  });

  it('strokes limbs and draws face points as dots only', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'nose', { x: 0.5, y: 0.1, visibility: 0.9 });
    setLandmark(landmarks, 'leftEye', { x: 0.45, y: 0.08, visibility: 0.9 });
    setLandmark(landmarks, 'rightEye', { x: 0.55, y: 0.08, visibility: 0.9 });
    setLandmark(landmarks, 'leftEar', { x: 0.4, y: 0.1, visibility: 0.9 });
    setLandmark(landmarks, 'rightEar', { x: 0.6, y: 0.1, visibility: 0.9 });
    setLandmark(landmarks, 'leftShoulder', { x: 0.3, y: 0.4, visibility: 0.9 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.7, y: 0.4, visibility: 0.9 });

    const { ctx, lines, arcs } = recordingContext();
    drawPoseWireframe(ctx, landmarks);

    expect(lines).toEqual([{ x1: 30, y1: 40, x2: 70, y2: 40 }]);
    const faceDots = arcs.filter((arc) => arc.y < 20);
    expect(faceDots).toHaveLength(FACE_JOINTS.length);
    expect(lines.some((line) => line.y1 < 20 || line.y2 < 20)).toBe(false);
  });

  it('draws a more visible joint larger than a dimmer one', () => {
    expect(jointRadiusForVisibility(10, 1)).toBe(10);
    expect(jointRadiusForVisibility(10, 0.4)).toBe(4);

    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.2, y: 0.5, visibility: 1 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.8, y: 0.5, visibility: 0.4 });

    const { ctx, arcs } = recordingContext();
    drawPoseWireframe(ctx, landmarks, { jointRadius: 10 });

    const bright = arcs.find((arc) => arc.x === 20);
    const dim = arcs.find((arc) => arc.x === 80);
    expect(bright?.radius).toBe(10);
    expect(dim?.radius).toBe(4);
    expect(bright!.radius).toBeGreaterThan(dim!.radius);
  });

  it('uses the same stroke and joint color for finger bones', () => {
    const body = recordingContext();
    const fingers = recordingContext();
    drawPoseWireframe(body.ctx, []);
    drawHandWireframes(fingers.ctx, []);
    expect(fingers.ctx.strokeStyle).toBe(body.ctx.strokeStyle);
    expect(fingers.ctx.fillStyle).toBe(body.ctx.fillStyle);
    expect(fingers.ctx.lineWidth).toBe(body.ctx.lineWidth);
  });

  it('skips parts below the drawing visibility floor', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.2, y: 0.5, visibility: WIREFRAME_MIN_VISIBILITY });
    setLandmark(landmarks, 'rightShoulder', { x: 0.8, y: 0.5, visibility: WIREFRAME_MIN_VISIBILITY - 0.01 });

    const { ctx, arcs } = recordingContext();
    drawPoseWireframe(ctx, landmarks);

    expect(arcs.map((arc) => arc.x)).toEqual([20]);
  });
});

describe('arm wireframe length', () => {
  it('includes shoulder–elbow and elbow–wrist on both arms', () => {
    expect(hasArmSegment(WIREFRAME_SEGMENTS, 'leftShoulder', 'leftElbow')).toBe(true);
    expect(hasArmSegment(WIREFRAME_SEGMENTS, 'leftElbow', 'leftWrist')).toBe(true);
    expect(hasArmSegment(WIREFRAME_SEGMENTS, 'rightShoulder', 'rightElbow')).toBe(true);
    expect(hasArmSegment(WIREFRAME_SEGMENTS, 'rightElbow', 'rightWrist')).toBe(true);
    expect(hasArmSegment(WIREFRAME_SEGMENTS, 'leftWrist', 'leftIndex')).toBe(true);
    expect(hasArmSegment(WIREFRAME_SEGMENTS, 'rightWrist', 'rightIndex')).toBe(true);
  });

  it('draws each forearm from the elbow to the wrist, including a weakly scored wrist', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.4, y: 0.3, visibility: 0.9 });
    setLandmark(landmarks, 'leftElbow', { x: 0.22, y: 0.48, visibility: 0.9 });
    setLandmark(landmarks, 'leftWrist', { x: 0.08, y: 0.72, visibility: 0.05 });
    setLandmark(landmarks, 'leftIndex', { x: 0.04, y: 0.86, visibility: 0.05 });
    setLandmark(landmarks, 'rightShoulder', { x: 0.6, y: 0.3, visibility: 0.9 });
    setLandmark(landmarks, 'rightElbow', { x: 0.78, y: 0.48, visibility: 0.9 });
    setLandmark(landmarks, 'rightWrist', { x: 0.92, y: 0.72, visibility: 0.05 });
    setLandmark(landmarks, 'rightIndex', { x: 0.96, y: 0.86, visibility: 0.05 });

    const { ctx, lines } = recordingContext();
    drawPoseWireframe(ctx, landmarks);

    expect(lines).toContainEqual({ x1: 22, y1: 48, x2: 40, y2: 30 });
    expect(lines).toContainEqual({ x1: 22, y1: 48, x2: 8, y2: 72 });
    expect(lines).toContainEqual({ x1: 8, y1: 72, x2: 4, y2: 86 });
    expect(lines).toContainEqual({ x1: 78, y1: 48, x2: 60, y2: 30 });
    expect(lines).toContainEqual({ x1: 78, y1: 48, x2: 92, y2: 72 });
    expect(lines).toContainEqual({ x1: 92, y1: 72, x2: 96, y2: 86 });

    const leftForearm = lines.find((line) => line.x1 === 22 && line.y1 === 48 && line.x2 === 8 && line.y2 === 72);
    expect(Math.hypot(leftForearm!.x2 - leftForearm!.x1, leftForearm!.y2 - leftForearm!.y1)).toBeCloseTo(
      Math.hypot(14, 24),
    );
  });

  it('does not invent a forearm when the wrist landmark is absent', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftShoulder', { x: 0.4, y: 0.3, visibility: 0.9 });
    setLandmark(landmarks, 'leftElbow', { x: 0.22, y: 0.48, visibility: 0.9 });
    setLandmark(landmarks, 'leftWrist', { x: 0.08, y: 0.72, visibility: 0 });

    const { ctx, lines } = recordingContext();
    drawPoseWireframe(ctx, landmarks);

    expect(lines).toContainEqual({ x1: 22, y1: 48, x2: 40, y2: 30 });
    expect(lines.some((line) => line.x2 === 8 && line.y2 === 72)).toBe(false);
  });

  it('draws a wrist reported only by presence', () => {
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftElbow', { x: 0.22, y: 0.48, visibility: 0.9 });
    setLandmark(landmarks, 'leftWrist', { x: 0.08, y: 0.72, visibility: 0, presence: 0.4 });

    const { ctx, lines } = recordingContext();
    drawPoseWireframe(ctx, landmarks);

    expect(lines).toContainEqual({ x1: 22, y1: 48, x2: 8, y2: 72 });
  });
});

/** MediaPipe hand bones: thumb, index, middle, ring, pinky, plus palm links. */
const FINGER_BONES = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
] as const;

describe('finger wireframe', () => {
  it('connects each finger from the palm through the tip on both hands', () => {
    expect(HAND_WIREFRAME_SEGMENTS).toEqual(FINGER_BONES);
    expect(HAND_WIREFRAME_SEGMENTS).toContainEqual([3, 4]);
    expect(HAND_WIREFRAME_SEGMENTS).toContainEqual([7, 8]);
    expect(HAND_WIREFRAME_SEGMENTS).toContainEqual([11, 12]);
    expect(HAND_WIREFRAME_SEGMENTS).toContainEqual([15, 16]);
    expect(HAND_WIREFRAME_SEGMENTS).toContainEqual([19, 20]);
  });

  it('strokes thumb and four finger bones when hand landmarks are present', () => {
    const hand = {
      landmarks: Array.from({ length: 21 }, (_, index) => ({
        x: (index + 1) / 22,
        y: 0.25,
        visibility: 0.05,
      })),
      handedness: 'Left' as const,
    };

    const one = recordingContext();
    drawHandWireframes(one.ctx, [hand]);
    expect(one.lines).toHaveLength(HAND_WIREFRAME_SEGMENTS.length);
    expect(one.arcs).toHaveLength(21);
    for (const [from, to] of HAND_WIREFRAME_SEGMENTS) {
      const start = hand.landmarks[from]!;
      const end = hand.landmarks[to]!;
      expect(one.lines).toContainEqual({
        x1: start.x * 100,
        y1: start.y * 100,
        x2: end.x * 100,
        y2: end.y * 100,
      });
    }
    for (const [from, to] of [
      [3, 4],
      [7, 8],
      [11, 12],
      [15, 16],
      [19, 20],
    ] as const) {
      expect(HAND_WIREFRAME_SEGMENTS).toContainEqual([from, to]);
      expect(one.lines).toContainEqual({
        x1: hand.landmarks[from]!.x * 100,
        y1: hand.landmarks[from]!.y * 100,
        x2: hand.landmarks[to]!.x * 100,
        y2: hand.landmarks[to]!.y * 100,
      });
    }

    const both = recordingContext();
    drawHandWireframes(both.ctx, [hand, { ...hand, handedness: 'Right' }]);
    expect(both.lines).toHaveLength(HAND_WIREFRAME_SEGMENTS.length * 2);
    expect(both.arcs).toHaveLength(42);
  });

  it('does not throw when hand landmarks are missing', () => {
    const { ctx, lines, arcs } = recordingContext();
    expect(() => {
      drawHandWireframes(ctx, []);
      drawPoseWireframe(ctx, []);
    }).not.toThrow();
    expect(lines).toEqual([]);
    expect(arcs).toEqual([]);
  });

  it('puts the hand wrist on the same canvas point as the pose wrist', () => {
    const options = {
      fit: 'contain' as const,
      sourceWidth: 640,
      sourceHeight: 480,
      mirrorX: true,
    };
    const wrist = { x: 0.28, y: 0.66 };
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftElbow', { x: 0.4, y: 0.42, visibility: 0.9 });
    setLandmark(landmarks, 'leftWrist', { ...wrist, visibility: 0.9 });
    const hand = {
      landmarks: Array.from({ length: 21 }, (_, index) => ({
        x: wrist.x + index * 0.01,
        y: wrist.y,
        visibility: 0,
      })),
      handedness: 'Left' as const,
    };

    const body = recordingContext(300, 500);
    const fingers = recordingContext(300, 500);
    drawPoseWireframe(body.ctx, landmarks, options);
    drawHandWireframes(fingers.ctx, [hand], options);

    const expected = toWireframePoint(wrist, 300, 500, options);
    const near = (value: number, target: number) => Math.abs(value - target) < 1e-6;
    expect(
      body.lines.some(
        (line) =>
          (near(line.x2, expected.x) && near(line.y2, expected.y)) ||
          (near(line.x1, expected.x) && near(line.y1, expected.y)),
      ),
    ).toBe(true);
    expect(fingers.lines.some((line) => near(line.x1, expected.x) && near(line.y1, expected.y))).toBe(
      true,
    );
  });

  it('seats each hand wrist on its arm and still strokes thumb and four fingers', () => {
    const options = {
      fit: 'contain' as const,
      sourceWidth: 640,
      sourceHeight: 480,
      mirrorX: true,
    };
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftWrist', { x: 0.22, y: 0.7, visibility: 0.9 });
    setLandmark(landmarks, 'rightWrist', { x: 0.78, y: 0.68, visibility: 0.9 });
    const spread = (originX: number, originY: number) =>
      Array.from({ length: 21 }, (_, index) => ({
        x: originX + (index % 5) * 0.012,
        y: originY + Math.floor(index / 5) * 0.01,
        visibility: 0,
      }));
    const leftHand = { landmarks: spread(0.55, 0.4), handedness: 'Left' as const };
    const rightHand = { landmarks: spread(0.1, 0.2), handedness: 'Right' as const };

    const drawn = recordingContext(300, 500);
    drawHandWireframes(drawn.ctx, [leftHand, rightHand], { ...options, poseLandmarks: landmarks });

    expect(drawn.lines).toHaveLength(HAND_WIREFRAME_SEGMENTS.length * 2);
    expect(drawn.arcs).toHaveLength(42);
    const leftWrist = toWireframePoint({ x: 0.22, y: 0.7 }, 300, 500, options);
    const rightWrist = toWireframePoint({ x: 0.78, y: 0.68 }, 300, 500, options);
    const near = (value: number, target: number) => Math.abs(value - target) < 1e-6;
    expect(drawn.lines.some((line) => near(line.x1, leftWrist.x) && near(line.y1, leftWrist.y))).toBe(
      true,
    );
    expect(drawn.lines.some((line) => near(line.x1, rightWrist.x) && near(line.y1, rightWrist.y))).toBe(
      true,
    );

    const leftShiftX = 0.22 - leftHand.landmarks[0]!.x;
    const leftShiftY = 0.7 - leftHand.landmarks[0]!.y;
    for (const [from, to] of [
      [3, 4],
      [7, 8],
      [11, 12],
      [15, 16],
      [19, 20],
    ] as const) {
      const start = toWireframePoint(
        {
          x: leftHand.landmarks[from]!.x + leftShiftX,
          y: leftHand.landmarks[from]!.y + leftShiftY,
        },
        300,
        500,
        options,
      );
      const end = toWireframePoint(
        {
          x: leftHand.landmarks[to]!.x + leftShiftX,
          y: leftHand.landmarks[to]!.y + leftShiftY,
        },
        300,
        500,
        options,
      );
      expect(drawn.lines).toContainEqual({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
      expect(Math.hypot(end.x - start.x, end.y - start.y)).toBeGreaterThan(0);
    }
  });

  it('normalizes pixel hand landmarks before seating the wrist on the arm', () => {
    const options = {
      fit: 'stretch' as const,
      sourceWidth: 640,
      sourceHeight: 480,
      mirrorX: false,
    };
    const landmarks = blankLandmarks(0);
    setLandmark(landmarks, 'leftWrist', { x: 0.25, y: 0.8, visibility: 0.4 });
    const hand = {
      landmarks: Array.from({ length: 21 }, (_, index) => ({
        x: 160 + index * 4,
        y: 240,
        visibility: 0,
      })),
      handedness: 'Left' as const,
    };

    const drawn = recordingContext(200, 100);
    drawHandWireframes(drawn.ctx, [hand], { ...options, poseLandmarks: landmarks });

    expect(drawn.lines).toHaveLength(HAND_WIREFRAME_SEGMENTS.length);
    const wrist = toWireframePoint({ x: 0.25, y: 0.8 }, 200, 100, options);
    const near = (value: number, target: number) => Math.abs(value - target) < 1e-6;
    expect(drawn.lines.some((line) => near(line.x1, wrist.x) && near(line.y1, wrist.y))).toBe(true);
    const fingertip = drawn.lines.find(
      (line) =>
        near(line.x2, toWireframePoint({ x: 0.25 + (4 * 4) / 640, y: 0.8 }, 200, 100, options).x) &&
        near(line.y2, wrist.y),
    );
    expect(fingertip).toBeDefined();
  });

  it('still marks a detected hand when MediaPipe reports visibility 0', () => {
    const hand = {
      landmarks: Array.from({ length: 21 }, (_, index) => ({
        x: (index + 1) / 22,
        y: 0.25,
        visibility: 0,
      })),
      handedness: null,
    };
    const drawn = recordingContext();
    drawHandWireframes(drawn.ctx, [hand]);
    expect(drawn.lines).toHaveLength(HAND_WIREFRAME_SEGMENTS.length);
    expect(drawn.arcs).toHaveLength(21);
  });
});

function recordingContext(width = 100, height = 100) {
  const lines: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  const arcs: Array<{ x: number; y: number; radius: number }> = [];
  let cursor = { x: 0, y: 0 };
  const ctx = {
    canvas: { width, height },
    lineCap: '',
    lineJoin: '',
    lineWidth: 0,
    strokeStyle: '',
    fillStyle: '',
    beginPath() {},
    moveTo(x: number, y: number) {
      cursor = { x, y };
    },
    lineTo(x: number, y: number) {
      lines.push({ x1: cursor.x, y1: cursor.y, x2: x, y2: y });
    },
    stroke() {},
    arc(x: number, y: number, radius: number) {
      arcs.push({ x, y, radius });
    },
    fill() {},
  } as unknown as CanvasRenderingContext2D;
  return { ctx, lines, arcs };
}
