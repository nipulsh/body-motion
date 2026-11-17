import { POSE_LANDMARK_INDEX } from '../../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../../types';

/**
 * Bowling arm-swing detector for a player facing the camera.
 *
 * The swing is read from MediaPipe world landmarks (meters, hip-centred, y down,
 * z away from the camera). Up/down and sideways are measured well from the front;
 * depth (z) is the noisy axis, and with the arm hanging still it can swing the raw
 * shoulder→wrist angle by 20° or more. So how far the arm is lifted comes only from
 * how far the wrist has risen against where it hangs at rest (both up/down), and
 * depth is only used, smoothed, to tell in front from behind. A throw needs all of:
 *
 * 1. A backswing: the straight arm lifted at least `backswingAngle` from hanging,
 *    not out to the side and not clearly in front, for at least `backConfirmMs`.
 *    Seen from the front, the wrist is hidden behind the body at the top of the
 *    backswing: MediaPipe reads it with low visibility and squashes its depth to
 *    near zero. So "behind" is read as "lifted, but neither to the side nor in
 *    front": the reach has nowhere else to be.
 * 2. A pass through the bottom: after that top, the lift drops below `bottomAngle`.
 *    An arm held up in front whose depth flickers can't fake a swing.
 * 3. A forward swing: within `maxForwardMs` of the top, the straight arm lifted
 *    in front of the body (`releaseAngle`), pointing mostly forward, with the wrist
 *    clearly visible, for `frontConfirmFrames` frames in a row.
 * 4. Enough speed: the average angular speed from the top of the backswing to the
 *    release is at least `minAngularSpeed`.
 *
 * Depth is smoothed before use. Arms held out to the side for balance, hands on
 * the hips or behind the back, a bent elbow, and a still arm with noisy depth all
 * fail one of these checks.
 */

export type BowlingArm = 'left' | 'right';

export interface SwingSample {
  t: number;
  /** Wrist below the shoulder, meters. */
  down: number;
  /** Wrist in front of the shoulder (toward the camera), meters. Raw, unsmoothed. */
  forward: number;
  /** Wrist offset toward the player's right, meters. */
  lateral: number;
  /** Shoulder→wrist straight-line length, meters. */
  armLength: number;
  /** Upper arm + forearm, meters. */
  boneLength: number;
  /** Straight-line length over upper arm + forearm: 1 for a straight arm, ~0.7 with the elbow at 90°. */
  straightness: number;
  wristVisibility: number;
}

export interface SwingRelease {
  arm: BowlingArm;
  t: number;
  /** Hand speed at the bottom of the swing in m/s, estimated from the forward swing. */
  handSpeed: number;
  /** Direction of the hand's travel during the forward swing, radians. + is toward the player's right. */
  lateralAngle: number;
}

export interface SwingDetectorConfig {
  /**
   * Shoulder, elbow and wrist below this visibility skip the frame. Low: the backswing can hide
   * the wrist behind the body. Below it, a hidden hand's position is a guess (kiosk recording).
   */
  minVisibility: number;
  /** The wrist must be this visible at release: it is in front of the body by then. */
  releaseMinVisibility: number;
  /** How far the arm must lift behind the body, radians from hanging straight down. */
  backswingAngle: number;
  /** How far the forward swing must lift the arm in front of the body before the throw counts. */
  releaseAngle: number;
  /**
   * How long the backswing reading must hold (ms). Each pose frame stands for the time since the last
   * one, so at the usual 10-15 fps one frame is enough (the top is brief, and steps 2-4 reject a stray
   * frame), and at 30 fps it takes two.
   */
  backConfirmMs: number;
  /** Frames in a row in front before the throw counts, so one noisy frame can't finish a swing. */
  frontConfirmFrames: number;
  /**
   * At the top of the backswing, the smoothed depth may put the wrist at most this share of its
   * horizontal reach in front of the shoulder: "not clearly in front". On the kiosk, MediaPipe read
   * real backswings anywhere from -0.3 to +0.18.
   */
  backMaxDepthShare: number;
  /** Between the backswing top and the release, the lift must drop below this: the swing passes the bottom. */
  bottomAngle: number;
  /** At release, depth must put the wrist at least this share of its reach in front. Lower: smoothing lags a fast swing. */
  frontDepthShare: number;
  /**
   * At release, the wrist's depth share must be at least this much further forward than at the top
   * of the backswing: the hand travelled from back to front, whatever the camera's depth offset.
   */
  minDepthGainShare: number;
  /**
   * Sideways offset at the top of the backswing, as a share of the horizontal reach, either way. A
   * natural backswing drifts out (0.5-0.75 on the kiosk); an arm held straight out to the side is ~1.
   */
  backMaxSideShare: number;
  /**
   * At release, the wrist may be at most this share of its reach out to its own side (away from the
   * body). Across the body is fine: a bowling follow-through crosses in front of the chest.
   */
  frontMaxOutwardShare: number;
  /** Straightness below this (elbow bent past ~105°) is not a bowling swing. */
  minStraightness: number;
  /** Longest time from the top of the backswing to the release (ms). */
  maxForwardMs: number;
  /** Slower average swings from the top of the backswing to release are arm movement, not a throw (rad/s). */
  minAngularSpeed: number;
  /** Peak over average speed of a pendulum swing; turns the average into the hand speed at the bottom. */
  peakSpeedFactor: number;
  /** Pose frames further apart than this restart depth smoothing and the frame runs (ms). */
  maxSampleGapMs: number;
  /** Ignore new releases from the same arm for this long after one (ms). */
  cooldownMs: number;
  /** Upper arm + forearm outside this range means a bad landmark fit (meters). */
  minArmLength: number;
  maxArmLength: number;
  /** Weight of the new frame when smoothing depth (0..1). */
  depthSmoothing: number;
  /** How fast the resting hang follows a lower-hanging wrist (ms time constant): the arm straightening at rest. */
  hangAttackMs: number;
  /** How fast the resting hang follows a higher wrist (ms): slow, so a swing barely moves it. */
  hangDecayMs: number;
  /** A sample within this of the backswing's highest angle still counts as the top (rad); keeps the top's time fresh while the arm dwells there. */
  topDwellAngle: number;
}

const DEG = Math.PI / 180;

export const DEFAULT_SWING_DETECTOR_CONFIG: SwingDetectorConfig = {
  minVisibility: 0.2,
  releaseMinVisibility: 0.5,
  backswingAngle: 35 * DEG,
  releaseAngle: 25 * DEG,
  backConfirmMs: 50,
  frontConfirmFrames: 2,
  backMaxDepthShare: 0.3,
  bottomAngle: 25 * DEG,
  frontDepthShare: 0.25,
  minDepthGainShare: 0.15,
  backMaxSideShare: 0.9,
  frontMaxOutwardShare: 0.6,
  minStraightness: 0.8,
  maxForwardMs: 1200,
  minAngularSpeed: 1.0,
  peakSpeedFactor: 1.5,
  maxSampleGapMs: 400,
  cooldownMs: 900,
  minArmLength: 0.3,
  maxArmLength: 1.1,
  depthSmoothing: 0.5,
  hangAttackMs: 100,
  hangDecayMs: 5000,
  topDwellAngle: 8 * DEG,
};

interface SwingTop {
  t: number;
  /** Elevation from hanging, radians. */
  angle: number;
  lateral: number;
  /** Horizontal reach of the wrist from the shoulder, meters. */
  reach: number;
  /** Smoothed depth over reach at the top: the release must come out further forward than this. */
  depthShare: number;
  /** Lowest lift seen since this top, radians: below `bottomAngle` once the arm has passed the bottom. */
  lowest: number;
}

interface ArmTrack {
  lastT: number | null;
  /** Smoothed forward (depth) offset, meters. */
  depth: number | null;
  /** How far the wrist hangs below the shoulder with the arm at rest, meters: the swing radius. */
  hang: number | null;
  /** How long the backswing reading has held, ms. */
  backRunMs: number;
  frontRun: number;
  top: SwingTop | null;
  lastBackAt: number | null;
  lastReleaseAt: number;
}

export interface SwingDetectorState {
  left: ArmTrack;
  right: ArmTrack;
}

function emptyTrack(lastReleaseAt = Number.NEGATIVE_INFINITY): ArmTrack {
  return {
    lastT: null,
    depth: null,
    hang: null,
    backRunMs: 0,
    frontRun: 0,
    top: null,
    lastBackAt: null,
    lastReleaseAt,
  };
}

export function createSwingDetector(): SwingDetectorState {
  return { left: emptyTrack(), right: emptyTrack() };
}

function armIndices(arm: BowlingArm) {
  return arm === 'left'
    ? {
        shoulder: POSE_LANDMARK_INDEX.leftShoulder,
        elbow: POSE_LANDMARK_INDEX.leftElbow,
        wrist: POSE_LANDMARK_INDEX.leftWrist,
      }
    : {
        shoulder: POSE_LANDMARK_INDEX.rightShoulder,
        elbow: POSE_LANDMARK_INDEX.rightElbow,
        wrist: POSE_LANDMARK_INDEX.rightWrist,
      };
}

function finite(lm: PoseLandmark | undefined): lm is PoseLandmark {
  return Boolean(lm && Number.isFinite(lm.x) && Number.isFinite(lm.y) && Number.isFinite(lm.z));
}

function dist3(a: PoseLandmark, b: PoseLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

/** One arm's swing sample from a pose, or null when that arm can't be read. */
export function readSwingSample(
  pose: PoseResult | null,
  arm: BowlingArm,
  t: number,
  config: SwingDetectorConfig = DEFAULT_SWING_DETECTOR_CONFIG,
): SwingSample | null {
  const world = pose?.worldLandmarks;
  const image = pose?.landmarks;
  if (!world || world.length < 33 || !image || image.length < 33) return null;
  const idx = armIndices(arm);
  const shoulder = world[idx.shoulder];
  const elbow = world[idx.elbow];
  const wrist = world[idx.wrist];
  if (!finite(shoulder) || !finite(elbow) || !finite(wrist)) return null;
  const wristVisibility = image[idx.wrist]?.visibility ?? 0;
  const lowest = Math.min(
    image[idx.shoulder]?.visibility ?? 0,
    image[idx.elbow]?.visibility ?? 0,
    wristVisibility,
  );
  if (!(lowest >= config.minVisibility)) return null;

  const segments = dist3(shoulder, elbow) + dist3(elbow, wrist);
  if (!(segments >= config.minArmLength && segments <= config.maxArmLength)) return null;

  const down = wrist.y - shoulder.y;
  const forward = shoulder.z - wrist.z;
  // World x grows toward the camera image's right, which is the player's left.
  const lateral = shoulder.x - wrist.x;
  const armLength = Math.hypot(down, forward, lateral);
  return {
    t,
    down,
    forward,
    lateral,
    armLength,
    boneLength: segments,
    straightness: segments > 0 ? armLength / segments : 0,
    wristVisibility,
  };
}

function updateArm(
  prev: ArmTrack,
  arm: BowlingArm,
  sample: SwingSample | null,
  config: SwingDetectorConfig,
): { track: ArmTrack; release: SwingRelease | null } {
  if (!sample) return { track: prev, release: null };

  if (prev.lastT !== null && !(sample.t > prev.lastT)) return { track: prev, release: null };
  const track: ArmTrack = { ...prev };
  // Across a gap the smoothed depth and the frame runs are stale. The backswing top is
  // kept: the wrist often drops out while hidden behind the body, and `maxForwardMs`
  // still limits how old the top can be.
  if (prev.lastT === null || sample.t - prev.lastT > config.maxSampleGapMs) {
    track.depth = null;
    track.backRunMs = 0;
    track.frontRun = 0;
  }
  track.lastT = sample.t;

  const a = Math.min(1, Math.max(0, config.depthSmoothing));
  const depth = track.depth === null ? sample.forward : track.depth + (sample.forward - track.depth) * a;
  track.depth = depth;

  // Resting hang: an upper envelope of the wrist's drop below the shoulder. Up/down only,
  // so depth noise can't inflate it. Not capped by upper arm + forearm: depth noise can
  // shorten that on a diagonal arm, which would shrink the hang mid-swing.
  const dtMs = prev.lastT === null ? 0 : sample.t - prev.lastT;
  let hang = track.hang ?? sample.down;
  if (dtMs > 0) {
    const tau = sample.down > hang ? config.hangAttackMs : config.hangDecayMs;
    hang += (sample.down - hang) * (1 - Math.exp(-dtMs / tau));
  }
  hang = Math.min(config.maxArmLength, Math.max(0.5 * config.minArmLength, 0.5 * sample.boneLength, hang));
  track.hang = hang;

  // Lift from hanging, from how far the wrist has risen: no depth involved.
  const elevation = Math.acos(Math.min(1, Math.max(-1, sample.down / hang)));
  const reach = hang * Math.sin(elevation);
  const straight = sample.straightness >= config.minStraightness;
  // Toward the arm's own side (away from the body); negative is across the body.
  const outward = arm === 'right' ? sample.lateral : -sample.lateral;
  const isFront =
    straight &&
    elevation >= config.releaseAngle &&
    depth >= config.frontDepthShare * reach &&
    outward <= config.frontMaxOutwardShare * reach &&
    sample.wristVisibility >= config.releaseMinVisibility;
  // Behind by elimination: a lifted straight arm that is not straight out to the side and not
  // clearly in front. MediaPipe reads the depth of a hand swung back as anything near zero.
  const isBack =
    !isFront &&
    straight &&
    elevation >= config.backswingAngle &&
    depth <= config.backMaxDepthShare * reach &&
    Math.abs(sample.lateral) <= config.backMaxSideShare * reach;

  track.backRunMs = isBack ? track.backRunMs + Math.min(dtMs, config.maxSampleGapMs) : 0;
  track.frontRun = isFront ? track.frontRun + 1 : 0;

  if (track.top) track.top = { ...track.top, lowest: Math.min(track.top.lowest, elevation) };

  if (isBack && track.backRunMs >= config.backConfirmMs) {
    const top = track.top;
    // A new swing starts when the arm comes back after passing the bottom, or lifts higher.
    const passedBottom = top !== null && top.lowest < config.bottomAngle;
    const depthShare = reach > 0 ? depth / reach : 0;
    if (!top || passedBottom || elevation >= top.angle) {
      track.top = { t: sample.t, angle: elevation, lateral: sample.lateral, reach, depthShare, lowest: elevation };
    } else if (elevation >= top.angle - config.topDwellAngle) {
      // Still dwelling at the top: the swing starts from the last moment there.
      track.top = { ...top, t: sample.t, depthShare: Math.min(top.depthShare, depthShare), lowest: elevation };
    }
    track.lastBackAt = sample.t;
  }
  if (track.top && track.lastBackAt !== null && sample.t - track.lastBackAt > config.maxForwardMs) {
    track.top = null;
  }

  if (!isFront || track.frontRun < config.frontConfirmFrames || !track.top) return { track, release: null };
  if (track.top.lowest >= config.bottomAngle) return { track, release: null };
  // The hand must come out further forward than it was at the top of the backswing.
  if (depth / reach - track.top.depthShare < config.minDepthGainShare) return { track, release: null };
  if (sample.t - track.lastReleaseAt < config.cooldownMs) return { track, release: null };

  // The forward swing reached the front: this backswing is used up either way.
  const top = track.top;
  track.top = null;
  const dt = (sample.t - top.t) / 1000;
  if (!(dt > 0) || dt * 1000 > config.maxForwardMs) return { track, release: null };
  const angularSpeed = (top.angle + elevation) / dt;
  if (angularSpeed < config.minAngularSpeed) return { track, release: null };

  track.lastReleaseAt = sample.t;
  track.frontRun = 0;
  return {
    track,
    release: {
      arm,
      t: sample.t,
      handSpeed: angularSpeed * config.peakSpeedFactor * hang,
      lateralAngle: Math.atan2(sample.lateral - top.lateral, top.reach + reach),
    },
  };
}

/**
 * Feeds one pose frame to both arms. Returns a release when either arm completes a
 * throw this frame; if both do, the faster swing is the throwing arm.
 */
export function updateSwingDetector(
  state: SwingDetectorState,
  pose: PoseResult | null,
  t: number,
  config: SwingDetectorConfig = DEFAULT_SWING_DETECTOR_CONFIG,
): { state: SwingDetectorState; release: SwingRelease | null } {
  const left = updateArm(state.left, 'left', readSwingSample(pose, 'left', t, config), config);
  const right = updateArm(state.right, 'right', readSwingSample(pose, 'right', t, config), config);
  const candidates = [left.release, right.release].filter((r): r is SwingRelease => r !== null);
  const release =
    candidates.length === 0
      ? null
      : candidates.reduce((best, r) => (r.handSpeed > best.handSpeed ? r : best));
  return { state: { left: left.track, right: right.track }, release };
}
