import { describe, expect, it } from 'vitest';
import { angleFromVertical, LM, toImage, type P2, type Side } from '../core/geometry';
import { mockPose } from '../core/mockSkeleton';
import { FPS, Rig } from '../testing/rig';
import squatConfig from './config.json';
import {
  bowingPct,
  heelLiftPct,
  hipDropPct,
  lrDiffPct,
  measureSquat,
  nearerSide,
  pelvisTilt,
  sideAngles,
  SpeedMeter,
  tibiaAngle,
} from './math';

const D = Math.PI / 180;

function blank(): { pts: P2[]; vis: number[] } {
  return { pts: Array.from({ length: 33 }, () => ({ x: 1, y: 0.5 })), vis: new Array(33).fill(0.95) };
}

/**
 * Side view with exact angles: thigh θ from straight down, shin φ and back β
 * from straight up. The patient faces -x; `near` is the leg toward the camera.
 */
function sideSkeleton(thetaDeg: number, phiDeg: number, betaDeg: number, near: Side = 'left') {
  const { pts, vis } = blank();
  const T = 0.2;
  const S = 0.19;
  const U = 0.26;
  const f = -1;
  const ankle = { x: 1, y: 0.86 };
  const knee = { x: ankle.x + f * S * Math.sin(phiDeg * D), y: ankle.y - S * Math.cos(phiDeg * D) };
  const hip = { x: knee.x - f * T * Math.sin(thetaDeg * D), y: knee.y - T * Math.cos(thetaDeg * D) };
  const shoulder = { x: hip.x + f * U * Math.sin(betaDeg * D), y: hip.y - U * Math.cos(betaDeg * D) };
  const far: Side = near === 'left' ? 'right' : 'left';
  const set = (side: Side, p: { hip: P2; knee: P2; ankle: P2; shoulder: P2 }, v: number) => {
    const l = side === 'left';
    pts[l ? LM.lHip : LM.rHip] = p.hip;
    pts[l ? LM.lKnee : LM.rKnee] = p.knee;
    pts[l ? LM.lAnkle : LM.rAnkle] = p.ankle;
    pts[l ? LM.lShoulder : LM.rShoulder] = p.shoulder;
    for (const i of l ? [LM.lHip, LM.lKnee, LM.lAnkle] : [LM.rHip, LM.rKnee, LM.rAnkle]) vis[i] = v;
  };
  set(near, { hip, knee, ankle, shoulder }, 0.98);
  // The far leg is a poor, different reading; it must not be used.
  const off = { x: 0.03, y: 0.05 };
  const shift = (p: P2) => ({ x: p.x + off.x, y: p.y + off.y });
  set(far, { hip: shift(hip), knee: { x: knee.x + 0.1, y: knee.y }, ankle: shift(ankle), shoulder: shift(shoulder) }, 0.6);
  return { pts, vis };
}

/** Front view: hips level at y, knees directly over the ankles unless tibia angles are given. */
function frontSkeleton(opts: { tibia?: Record<Side, number>; hipTiltDeg?: number; kneeDropRight?: number } = {}) {
  const { pts } = blank();
  const tib = opts.tibia ?? { left: 0, right: 0 };
  const S = 0.19;
  // Facing the camera: the patient's left is +x.
  const ankleL = { x: 1.06, y: 0.86 };
  const ankleR = { x: 0.94, y: 0.86 };
  pts[LM.lAnkle] = ankleL;
  pts[LM.rAnkle] = ankleR;
  pts[LM.lKnee] = { x: ankleL.x + S * Math.sin(tib.left * D), y: ankleL.y - S * Math.cos(tib.left * D) };
  pts[LM.rKnee] = { x: ankleR.x - S * Math.sin(tib.right * D), y: ankleR.y - S * Math.cos(tib.right * D) + (opts.kneeDropRight ?? 0) };
  const tilt = (opts.hipTiltDeg ?? 0) * D;
  const hw = 0.055;
  pts[LM.lHip] = { x: 1 + hw * Math.cos(tilt), y: 0.46 - hw * Math.sin(tilt) };
  pts[LM.rHip] = { x: 1 - hw * Math.cos(tilt), y: 0.46 + hw * Math.sin(tilt) };
  pts[LM.lShoulder] = { x: 1.085, y: 0.2 };
  pts[LM.rShoulder] = { x: 0.915, y: 0.2 };
  return pts;
}

describe('side view angles (exact synthetic skeleton)', () => {
  for (const near of ['left', 'right'] as Side[]) {
    for (const theta of [0, 30, 60, 90, 110]) {
      for (const beta of [0, 20, 40]) {
        it(`${near} leg nearer: thigh ${theta}°, back ${beta}°, shin 25°`, () => {
          const { pts, vis } = sideSkeleton(theta, 25, beta, near);
          const a = sideAngles(pts, vis);
          expect(a.side).toBe(near);
          expect(Math.abs(a.thighAngle - theta)).toBeLessThan(1);
          expect(Math.abs(a.backAngle - beta)).toBeLessThan(1);
          expect(Math.abs(a.shinAngle - 25)).toBeLessThan(1);
        });
      }
    }
  }

  it('picks the leg with the higher visibility', () => {
    const vis = new Array(33).fill(0.5);
    vis[LM.rHip] = vis[LM.rKnee] = vis[LM.rAnkle] = 0.9;
    expect(nearerSide(vis)).toBe('right');
  });
});

describe('front view measurements (exact synthetic skeleton)', () => {
  for (const deg of [-10, 0, 8, 20]) {
    it(`tibia angle ${deg}° on both legs, positive when the knee is lateral`, () => {
      const pts = frontSkeleton({ tibia: { left: deg, right: deg } });
      expect(tibiaAngle(pts, 'left')).toBeCloseTo(deg, 6);
      expect(tibiaAngle(pts, 'right')).toBeCloseTo(deg, 6);
    });
  }

  it('reads a caving (valgus) knee as negative on one leg only', () => {
    const pts = frontSkeleton({ tibia: { left: 6, right: -7 } });
    expect(tibiaAngle(pts, 'left')).toBeCloseTo(6, 6);
    expect(tibiaAngle(pts, 'right')).toBeCloseTo(-7, 6);
  });

  for (const deg of [0, 5, 9]) {
    it(`pelvis tilt ${deg}°`, () => {
      expect(pelvisTilt(frontSkeleton({ hipTiltDeg: deg }))).toBeCloseTo(deg, 6);
    });
  }

  it('left-right difference is the larger of knee and hip height difference over leg length', () => {
    const pts = frontSkeleton({ kneeDropRight: 0.02 });
    expect(lrDiffPct(pts, 0.4)).toBeCloseTo(5, 6);
  });

  it('bowing is 1 minus shoulder-hip distance over the standing distance', () => {
    const pts = frontSkeleton();
    const d0 = Math.hypot(0, 0.46 - 0.2);
    expect(bowingPct(pts, d0)).toBeCloseTo(0, 6);
    expect(bowingPct(pts, d0 / 0.88)).toBeCloseTo(12, 4);
  });
});

/** Ease the mock into a pose over 1 s, then hold 1 s so the smoothing settles. */
function settle(rig: Rig, patch: Parameters<Rig['set']>[0]) {
  const from = { ...rig.params };
  const n = FPS;
  for (let i = 1; i <= n; i += 1) {
    const mix: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      const a = (from as unknown as Record<string, unknown>)[k];
      mix[k] = typeof v === 'number' && typeof a === 'number' ? a + ((v - a) * i) / n : v;
    }
    rig.step(mix);
  }
  for (let i = 0; i < FPS; i += 1) rig.step(patch);
  const frame = rig.healthyFrame;
  if (!frame) throw new Error(`tracking unhealthy: ${rig.status?.message}`);
  return frame;
}

describe('mock skeleton through the tracker: hip drop, lean, heel lift', () => {
  for (const view of ['front', 'side'] as const) {
    for (const drop of [0, 20, 40, 60]) {
      for (const lean of [0, 20, 40]) {
        it(`${view} view, hip drop ${drop}%, trunk lean ${lean}°`, () => {
          const rig = new Rig(squatConfig.requiredLandmarks, { params: { view } });
          rig.lockBase();
          const frame = settle(rig, { hipDropPct: drop, trunkLeanDeg: lean });
          const m = measureSquat(frame, rig.base, view);
          expect(Math.abs(m.hipDropPct - drop)).toBeLessThan(1);
          if (view === 'side') {
            // The mock turns its near shoulder slightly (≈1.7° at lean 0), so compare with its own raw pose.
            const raw = mockPose(rig.params, rig.t)!;
            const p = raw.landmarks.map((l) => toImage(l, raw.frameAspect!));
            const rawBack = angleFromVertical(p[LM.lHip], p[LM.lShoulder], true);
            expect(Math.abs(rawBack - lean)).toBeLessThan(2);
            expect(Math.abs(m.side.backAngle - rawBack)).toBeLessThan(1);
            expect(m.depth).toBeCloseTo(m.side.thighAngle, 6);
          } else {
            expect(Math.abs(m.bowing - 100 * (1 - Math.cos(lean * D)))).toBeLessThan(1);
            expect(m.depth).toBeCloseTo(m.hipDropPct, 6);
          }
        });
      }
    }
  }

  for (const lift of [0, 3, 6]) {
    it(`heel lift ${lift}% of leg length`, () => {
      const rig = new Rig(squatConfig.requiredLandmarks);
      rig.lockBase();
      const frame = settle(rig, { heelLiftPct: lift });
      expect(Math.abs(heelLiftPct(frame.pts, rig.base, frame.scale) - lift)).toBeLessThan(1);
    });
  }

  it('keeps hip drop correct when the patient has drifted closer', () => {
    const rig = new Rig(squatConfig.requiredLandmarks);
    rig.lockBase();
    settle(rig, { distanceScale: 1.15 });
    const frame = settle(rig, { hipDropPct: 40 });
    expect(Math.abs(hipDropPct(frame.pts, rig.base, frame.scale) - 40)).toBeLessThan(1);
  });
});

describe('speed meter', () => {
  it('converges to a steady rate', () => {
    const m = new SpeedMeter(0.25);
    for (let i = 0; i <= 60; i += 1) m.update(20 * (i / 30), i / 30);
    expect(m.value).toBeCloseTo(20, 1);
  });
});
