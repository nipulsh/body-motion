import { describe, expect, it, vi } from 'vitest';
import type { MotionTracker } from '../motion/MotionTracker';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../types';
import { ExerciseSessionController, type ExerciseFramePayload } from './ExerciseSessionController';
import type { Exercise, ExerciseFormCheck } from './types';

function exercise(formCheck?: ExerciseFormCheck): Exercise {
  return {
    id: `ex_${formCheck ?? 'plain'}`,
    name: formCheck ?? 'Arm raise',
    description: '',
    formCheck,
    targetBodyParts: [],
    difficulty: 'beginner',
    sets: 1,
    recommendedReps: 5,
    restSeconds: 30,
    instructions: [],
    safetyNotes: [],
    trackingRules: [],
  };
}

function setup() {
  const detector = {
    initialize: vi.fn(async () => {}),
    processFrame: vi.fn(() => null),
    dispose: vi.fn(),
    isReady: () => true,
    setSegmentationEnabled: vi.fn(async (_enabled: boolean) => {}),
  };
  const motionTracker = {
    startExercise: vi.fn(),
    stopExercise: vi.fn(),
    update: vi.fn(() => null),
    previewPose: vi.fn(() => null),
    getActiveExercise: vi.fn(() => null),
    getJointAngles: vi.fn(() => null),
  } as unknown as MotionTracker;
  const controller = new ExerciseSessionController({
    getVideo: () => null,
    poseDetector: detector,
    motionTracker,
    raf: () => 0,
    caf: () => {},
    now: () => 0,
  });
  return { controller, detector };
}

describe('ExerciseSessionController body outline', () => {
  it('turns the body outline on for a deadlift and off when the session stops', async () => {
    const { controller, detector } = setup();
    await controller.start(exercise('deadlift'));
    expect(detector.setSegmentationEnabled).toHaveBeenLastCalledWith(true);
    controller.stop();
    expect(detector.setSegmentationEnabled).toHaveBeenLastCalledWith(false);
  });

  it('leaves it off for other exercises', async () => {
    const { controller, detector } = setup();
    await controller.start(exercise('squat'));
    expect(detector.setSegmentationEnabled).toHaveBeenLastCalledWith(false);
    controller.restartSet(exercise());
    expect(detector.setSegmentationEnabled).toHaveBeenLastCalledWith(false);
  });
});

describe('ExerciseSessionController spine keypoints', () => {
  function withEstimator() {
    const spinePose = {
      setEnabled: vi.fn(),
      update: vi.fn(() => null),
      getStatus: vi.fn(() => 'idle' as const),
      getLastInferenceMs: vi.fn(() => null),
      getBackend: vi.fn(() => null),
    };
    const motionTracker = {
      startExercise: vi.fn(),
      stopExercise: vi.fn(),
      update: vi.fn(() => null),
      previewPose: vi.fn(() => null),
      getActiveExercise: vi.fn(() => null),
      getJointAngles: vi.fn(() => null),
    } as unknown as MotionTracker;
    const controller = new ExerciseSessionController({
      getVideo: () => null,
      poseDetector: {
        initialize: vi.fn(async () => {}),
        processFrame: vi.fn(() => null),
        dispose: vi.fn(),
        isReady: () => true,
      },
      motionTracker,
      spinePose,
      raf: () => 0,
      caf: () => {},
      now: () => 0,
    });
    return { controller, spinePose };
  }

  it('turns the model on for a deadlift and off when the session stops', async () => {
    const { controller, spinePose } = withEstimator();
    await controller.start(exercise('deadlift'));
    expect(spinePose.setEnabled).toHaveBeenLastCalledWith(true);
    controller.stop();
    expect(spinePose.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('leaves it off for other exercises and when a set restarts on one', async () => {
    const { controller, spinePose } = withEstimator();
    await controller.start(exercise('squat'));
    expect(spinePose.setEnabled).toHaveBeenLastCalledWith(false);
    controller.restartSet(exercise('deadlift'));
    expect(spinePose.setEnabled).toHaveBeenLastCalledWith(true);
    controller.restartSet(exercise());
    expect(spinePose.setEnabled).toHaveBeenLastCalledWith(false);
  });

  it('does not wait for the model before the session starts', async () => {
    const { controller, spinePose } = withEstimator();
    spinePose.setEnabled.mockImplementation(() => {
      expect(controller.isActive()).toBe(false);
    });
    await controller.start(exercise('deadlift'));
    expect(controller.isActive()).toBe(true);
  });

  it('runs without an estimator at all', async () => {
    const { controller } = setup();
    await expect(controller.start(exercise('deadlift'))).resolves.toBeUndefined();
    controller.stop();
  });
});

describe('ExerciseSessionController squat standing zero', () => {
  /** Side-on standing body: heel behind the knee, so its plain geometry is not 0°. */
  function standingPose(): PoseResult {
    const points: Partial<Record<PoseLandmarkName, [number, number]>> = {};
    for (const side of ['left', 'right'] as const) {
      points[`${side}Shoulder`] = [0.49, 0.2];
      points[`${side}Hip`] = [0.47, 0.5];
      points[`${side}Knee`] = [0.48, 0.7];
      points[`${side}Ankle`] = [0.47, 0.9];
      points[`${side}Heel`] = [0.44, 0.93];
      points[`${side}FootIndex`] = [0.55, 0.93];
    }
    const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
    for (const [name, [x, y]] of Object.entries(points) as [PoseLandmarkName, [number, number]][]) {
      landmarks[POSE_LANDMARK_INDEX[name]] = { x, y, z: 0, visibility: 0.95 };
    }
    return { landmarks, confidence: 0.95, timestamp: 0 };
  }

  function session() {
    let time = 0;
    let pending: FrameRequestCallback | null = null;
    const detector = {
      initialize: vi.fn(async () => {}),
      processFrame: vi.fn((): PoseResult | null => standingPose()),
      dispose: vi.fn(),
      isReady: () => true,
      setSegmentationEnabled: vi.fn(async (_enabled: boolean) => {}),
    };
    const motionTracker = {
      startExercise: vi.fn(),
      stopExercise: vi.fn(),
      update: vi.fn(() => null),
      previewPose: vi.fn(() => null),
      getActiveExercise: vi.fn(() => null),
      getJointAngles: vi.fn(() => null),
    } as unknown as MotionTracker;
    const controller = new ExerciseSessionController({
      getVideo: () => ({ readyState: 4, videoWidth: 1000, videoHeight: 1000 }) as HTMLVideoElement,
      poseDetector: detector,
      motionTracker,
      raf: (cb) => {
        pending = cb;
        return 1;
      },
      caf: () => {
        pending = null;
      },
      now: () => time,
    });
    let last: ExerciseFramePayload | null = null;
    controller.subscribe((payload) => {
      last = payload;
    });
    const run = (ms: number): ExerciseFramePayload => {
      const end = time + ms;
      while (time < end) {
        time += 100;
        const cb = pending;
        pending = null;
        cb?.(time);
      }
      return last!;
    };
    return { controller, run, detector };
  }

  const squatExercise = () => exercise('squat');

  function expectStandingReadsZero(form: ExerciseFramePayload['form']) {
    if (form?.kind !== 'squat') throw new Error('expected squat');
    expect(form.frame!.zeroSet).toBe(true);
    expect(form.frame!.kneeAngle.left).toBe(0);
    expect(form.frame!.backAngle.left).toBe(0);
    expect(form.frame!.kneeHeelAngle.left).toBe(0);
  }

  it('sets the zero while tracking is off, so the first tracked frame already reads 0°', async () => {
    const { controller, run } = session();
    await controller.start(squatExercise());
    controller.setTrackingEnabled(false);

    // Tracking is off, and no form result reaches the screen.
    expect(run(1500).form ?? null).toBeNull();

    // "Go": the app restarts the set and turns tracking on.
    controller.restartSet(squatExercise());
    controller.setTrackingEnabled(true);
    expectStandingReadsZero(run(100).form);
  });

  it('sets the zero in the order the app runs today, where start() leaves tracking on', async () => {
    const { controller, run } = session();
    // useExercise turns tracking off for the countdown, then start() turns it back on.
    controller.setTrackingEnabled(false);
    await controller.start(squatExercise());
    expect(run(1500).form).toBeTruthy();

    controller.restartSet(squatExercise());
    controller.setTrackingEnabled(true);
    expectStandingReadsZero(run(100).form);
  });

  it('keeps the zero into the next set of the same exercise', async () => {
    const { controller, run } = session();
    await controller.start(squatExercise());
    run(1500);
    controller.restartSet(squatExercise());
    const form = run(100).form!;
    if (form.kind !== 'squat') throw new Error('expected squat');
    expect(form.frame!.zeroSet).toBe(true);
    expect(form.correctReps).toBe(0);
  });

  it('starts over for a different exercise and for a new session', async () => {
    const { controller, run } = session();
    await controller.start(squatExercise());
    run(1500);
    controller.restartSet({ ...squatExercise(), id: 'another_squat' });
    let form = run(100).form!;
    if (form.kind !== 'squat') throw new Error('expected squat');
    expect(form.frame!.zeroSet).toBe(false);

    run(1500);
    controller.stop();
    await controller.start(squatExercise());
    form = run(100).form!;
    if (form.kind !== 'squat') throw new Error('expected squat');
    expect(form.frame!.zeroSet).toBe(false);
  });

  it('leaves exercises without a standing zero alone while tracking is off', async () => {
    const { controller, run } = session();
    await controller.start(exercise('lunge'));
    controller.setTrackingEnabled(false);
    expect(run(500).form ?? null).toBeNull();
    controller.stop();
    await controller.start(exercise());
    controller.setTrackingEnabled(false);
    expect(run(500).form ?? null).toBeNull();
  });
});
