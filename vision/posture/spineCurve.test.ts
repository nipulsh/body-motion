import { beforeEach, describe, expect, it } from 'vitest';
import { DeadliftFormMonitor, measureDeadliftForm, type DeadliftFormFrame } from '../exercise/deadliftForm';
import { drawDeadliftFormOverlay } from '../exercise/deadliftFormOverlay';
import { POSE_LANDMARK_INDEX } from '../pose/landmarks';
import { hinge } from '../test/deadliftHinge';
import { recordingContext } from '../test/recordingContext';
import { resetNeutralSpineProfile } from './NeutralSpineCalibrator';
import { estimateSpineCurve, SpineCurveTracker, SPINE_CURVE_POINT_COUNT, type SpineCurve } from './SpineCurveDetector';

beforeEach(() => {
  resetNeutralSpineProfile();
});

function frameOf(options: Parameters<typeof hinge>[0] = {}, upright = false): DeadliftFormFrame {
  return measureDeadliftForm(hinge(options), undefined, { includeUprightContour: upright })!;
}

function regionAbs(curve: SpineCurve, key: 'upperThoracic' | 'midThoracic' | 'lumbar' | 'overall'): number {
  const value = curve[key].sagitta;
  expect(value, key).not.toBeNull();
  return Math.abs(value!);
}

describe('estimateSpineCurve', () => {
  it('places eight estimated stations on a standing neutral back', () => {
    const frame = frameOf({ leanDeg: 6 }, true);
    const curve = frame.spineCurve;
    expect(curve.points).toHaveLength(SPINE_CURVE_POINT_COUNT);
    expect(curve.status).toBe('measured');
    expect(curve.points.some((point) => point.source === 'measured')).toBe(true);
    expect(curve.points.some((point) => point.source === 'estimated')).toBe(true);
    expect(regionAbs(curve, 'overall')).toBeLessThan(0.04);
    expect(regionAbs(curve, 'upperThoracic')).toBeLessThan(0.04);
    expect(regionAbs(curve, 'lumbar')).toBeLessThan(0.04);
    expect(curve.trunkInclinationDeg).toBeLessThan(12);
    for (const point of curve.points) expect(point.confidence).toBeGreaterThan(0);
    const hip = frame.back[0]!;
    const shoulder = frame.back[frame.back.length - 1]!;
    const outward = frame.backOutward!;
    const mid = curve.points[3]!;
    const axisX = shoulder.x - hip.x;
    const axisY = shoulder.y - hip.y;
    const along = ((mid.x - hip.x) * axisX + (mid.y - hip.y) * axisY) / (axisX * axisX + axisY * axisY);
    const offX = mid.x - hip.x - axisX * along;
    const offY = mid.y - hip.y - axisY * along;
    expect(offX * outward.x + offY * outward.y).toBeGreaterThan(0);
  });

  it('keeps a flat back flat while the trunk hinges', () => {
    const stood = frameOf({ leanDeg: 6 }, true).spineCurve;
    const hinged = frameOf({ leanDeg: 55 }).spineCurve;
    expect(hinged.status).toBe('measured');
    expect(regionAbs(hinged, 'overall')).toBeLessThan(0.04);
    expect(regionAbs(hinged, 'upperThoracic')).toBeLessThan(0.04);
    expect(regionAbs(hinged, 'lumbar')).toBeLessThan(0.04);
    expect(hinged.trunkInclinationDeg! - stood.trunkInclinationDeg!).toBeGreaterThan(35);
    expect(hinged.hipHingeDeg).not.toBeNull();
    expect(stood.hipHingeDeg! - hinged.hipHingeDeg!).toBeGreaterThan(20);
  });

  it('reads thoracic rounding apart from lumbar rounding', () => {
    const upper = frameOf({ leanDeg: 50, thoracicBulgePx: 28 }).spineCurve;
    const lower = frameOf({ leanDeg: 50, lumbarBulgePx: 28 }).spineCurve;
    expect(upper.upperThoracic.sagitta!).toBeGreaterThan(upper.lumbar.sagitta! + 0.02);
    expect(lower.lumbar.sagitta!).toBeGreaterThan(lower.upperThoracic.sagitta! + 0.02);
    expect(upper.upperThoracic.confidence).toBeGreaterThan(0.45);
    expect(lower.lumbar.confidence).toBeGreaterThan(0.45);
  });

  it('reads combined rounding in both regions', () => {
    const curve = frameOf({ leanDeg: 50, bendDeg: 45 }).spineCurve;
    expect(curve.upperThoracic.sagitta!).toBeGreaterThan(0.02);
    expect(curve.lumbar.sagitta!).toBeGreaterThan(0.02);
    expect(curve.midThoracic.sagitta!).toBeGreaterThan(0.02);
    expect(curve.overall.sagitta!).toBeGreaterThan(0.02);
  });

  it('reports the same curvature at two camera distances', () => {
    const near = frameOf({ leanDeg: 50, thoracicBulgePx: 24, scale: 1 }).spineCurve;
    const far = frameOf({ leanDeg: 50, thoracicBulgePx: 24, scale: 2 }).spineCurve;
    expect(Math.abs(near.upperThoracic.sagitta! - far.upperThoracic.sagitta!)).toBeLessThan(0.03);
    expect(Math.abs(near.overall.sagitta! - far.overall.sagitta!)).toBeLessThan(0.03);
  });

  it('reports the same curvature for a longer torso with the same shape', () => {
    const shape = (torso: number) => {
      const hip = { x: 0.3, y: 0.7 };
      const shoulder = { x: 0.3, y: 0.7 - torso };
      const bulge = torso * 0.12;
      const contour = Array.from({ length: 13 }, (_, index) => {
        const t = 0.2 + (0.6 * index) / 12;
        const hump = Math.sin((Math.PI * (t - 0.2)) / 0.6);
        return { x: hip.x + bulge * hump, y: hip.y + (shoulder.y - hip.y) * t };
      });
      return estimateSpineCurve({
        hip,
        shoulder,
        ear: { x: shoulder.x, y: shoulder.y - torso * 0.15 },
        outward: { x: 1, y: 0 },
        contour,
        segmentationConfidence: 1,
        frameAspect: 1,
        trunkInclinationDeg: 0,
        hipHingeDeg: 170,
      });
    };
    const short = shape(0.25);
    const tall = shape(0.55);
    expect(short.status).toBe('measured');
    expect(tall.status).toBe('measured');
    expect(Math.abs(short.overall.sagitta! - tall.overall.sagitta!)).toBeLessThan(0.02);
  });

  it('keeps a curve when the knee or the ear drops', () => {
    const hiddenKnee = frameOf({ leanDeg: 50, hideKnee: true });
    expect(hiddenKnee.backCheck).toBe('landmarks_missing');
    expect(hiddenKnee.spineCurve.points).toHaveLength(SPINE_CURVE_POINT_COUNT);
    expect(hiddenKnee.spineCurve.status).toBe('measured');
    expect(hiddenKnee.spineCurve.hipHingeDeg).toBeNull();

    const pose = hinge({ leanDeg: 50 });
    pose.landmarks[POSE_LANDMARK_INDEX.leftEar]!.visibility = 0;
    const hiddenEar = measureDeadliftForm(pose)!;
    expect(hiddenEar.head).toBeNull();
    expect(hiddenEar.spineCurve.points).toHaveLength(SPINE_CURVE_POINT_COUNT);
    expect(hiddenEar.spineCurve.points[SPINE_CURVE_POINT_COUNT - 1]!.source).toBe('estimated');
    expect(hiddenEar.spineCurve.status).toBe('measured');
  });

  it('does not invent curvature when the back contour is missing', () => {
    const gone = frameOf({ leanDeg: 55, silhouette: false });
    expect(gone.spineCurve.points).toHaveLength(SPINE_CURVE_POINT_COUNT);
    expect(gone.spineCurve.status).toBe('estimated');
    expect(gone.spineCurve.overall.sagitta).toBeNull();
    expect(gone.spineCurve.upperThoracic.sagitta).toBeNull();
    expect(gone.spineCurve.lumbar.sagitta).toBeNull();
    expect(gone.spineCurve.segmentationConfidence).toBe(0);

    const empty = hinge({ leanDeg: 55 });
    empty.silhouette = { ...empty.silhouette!, data: new Uint8Array(empty.silhouette!.data.length) };
    const blank = measureDeadliftForm(empty)!;
    expect(blank.spineCurve.status).toBe('estimated');
    expect(blank.spineCurve.overall.sagitta).toBeNull();
    expect(blank.backCheck).toBe('outline_unavailable');
  });

  it('is unavailable when the hip and shoulder cannot be placed', () => {
    const curve = estimateSpineCurve({
      hip: { x: Number.NaN, y: 0 },
      shoulder: { x: 0.5, y: 0.2 },
      ear: null,
      outward: null,
      contour: [],
      segmentationConfidence: 0,
    });
    expect(curve.status).toBe('unavailable');
    expect(curve.points).toEqual([]);
    expect(curve.overall.sagitta).toBeNull();
    expect(curve.upperThoracic.source).toBe('unavailable');
    expect(curve.lumbar.source).toBe('unavailable');
  });
});

describe('SpineCurveTracker', () => {
  it('holds the drawn points through a short segmentation gap and drops the curvature number', () => {
    const tracker = new SpineCurveTracker();
    const measured = frameOf({ leanDeg: 50, bendDeg: 40 }).spineCurve;
    const first = tracker.smooth(measured, 0);
    expect(first.status).toBe('measured');
    expect(first.overall.sagitta).not.toBeNull();

    const lost = frameOf({ leanDeg: 50, silhouette: false }).spineCurve;
    const held = tracker.smooth(lost, 200);
    expect(held.status).toBe('estimated');
    expect(held.points).toHaveLength(SPINE_CURVE_POINT_COUNT);
    expect(held.overall.sagitta).toBeNull();
    expect(held.upperThoracic.sagitta).toBeNull();
    expect(held.lumbar.sagitta).toBeNull();
    const drift = Math.hypot(held.points[3]!.x - first.points[3]!.x, held.points[3]!.y - first.points[3]!.y);
    expect(drift).toBeLessThan(0.02);

    const later = tracker.smooth(lost, 700);
    expect(later.status).toBe('estimated');
    expect(later.overall.sagitta).toBeNull();
    const returned = Math.hypot(later.points[3]!.x - lost.points[3]!.x, later.points[3]!.y - lost.points[3]!.y);
    expect(returned).toBeLessThan(0.05);
  });
});

describe('deadlift spine curve', () => {
  it('does not warn on a neutral hinge and does not warn when the contour drops', () => {
    const monitor = new DeadliftFormMonitor();
    let t = 0;
    for (let i = 0; i < 12; i += 1) {
      monitor.update(hinge({ leanDeg: 6 }), t, 0);
      t += 66;
    }
    let result = monitor.update(hinge({ leanDeg: 55 }), t, 0);
    for (let i = 0; i < 18; i += 1) {
      t += 66;
      result = monitor.update(hinge({ leanDeg: 55 }), t, 0);
    }
    expect(result.faults).toEqual([]);
    expect(result.frame!.rounded).toBe(false);
    expect(Math.abs(result.frame!.spineCurve.overall.sagitta!)).toBeLessThan(0.05);
    expect(result.frame!.spineCurve.trunkInclinationDeg!).toBeGreaterThan(40);

    const empty = () => {
      const pose = hinge({ leanDeg: 55, bendDeg: 45 });
      pose.silhouette = { ...pose.silhouette!, data: new Uint8Array(pose.silhouette!.data.length) };
      return pose;
    };
    for (let i = 0; i < 20; i += 1) {
      t += 66;
      result = monitor.update(empty(), t, 1);
    }
    expect(result.faults).toEqual([]);
    expect(result.frame!.spineCurve.overall.sagitta).toBeNull();
  });

  it('draws the eight stations as a connected curve', () => {
    const monitor = new DeadliftFormMonitor();
    let result = monitor.update(hinge({ leanDeg: 6 }), 0, 0);
    for (let t = 66; t <= 400; t += 66) result = monitor.update(hinge({ leanDeg: 50, bendDeg: 40 }), t, 0);
    const rec = recordingContext(640, 360);
    drawDeadliftFormOverlay(rec.ctx, hinge({ leanDeg: 50, bendDeg: 40 }).landmarks, result);
    expect(result.frame!.spineCurve.points).toHaveLength(SPINE_CURVE_POINT_COUNT);
    expect(rec.arcs.length).toBeGreaterThanOrEqual(SPINE_CURVE_POINT_COUNT);
    expect(rec.lines.length).toBeGreaterThan(SPINE_CURVE_POINT_COUNT);
  });
});
