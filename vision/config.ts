function readRotationDebugFlag(): boolean {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  const env = meta.env;
  if (!env) return false;
  if (env.PROD === true || env.MODE === 'production') return false;
  const flag = env.VITE_VISION_DEBUG_ROTATION ?? env.VISION_DEBUG_ROTATION;
  return flag === true || flag === 'true' || flag === '1';
}

function readExerciseDiagnosticFlag(): boolean {
  const meta = import.meta as ImportMeta & {
    env?: Record<string, string | boolean | undefined>;
  };
  const env = meta.env;
  if (!env) return false;
  if (env.PROD === true || env.MODE === 'production') return false;
  const flag = env.VITE_EXERCISE_DIAGNOSTIC ?? env.EXERCISE_DIAGNOSTIC;
  return flag === true || flag === 'true' || flag === '1';
}

export const VISION_CONFIG = {
  capture: {
    targetImageCount: 36,
    minimumImageCount: 30,
    maximumImageCount: 40,
    captureAngleInterval: 10,
    captureAngleTolerance: 4,
  },
  timedCapture: {
    /**
     * Guided capture: 10 frames facing the camera, then 10 turned right, then 10 with the back to the camera.
     * `angleDeg` is stored with each frame (0 front, 90 right, 180 back).
     */
    stages: [
      { id: 'front', angleDeg: 0 },
      { id: 'right', angleDeg: 90 },
      { id: 'back', angleDeg: 180 },
    ] as const,
    framesPerStage: 10,
    frameCount: 30,
    frameIntervalMs: 300,
    /** Extra time a stage may take past its frames (slow encodes, retries) before it fails. */
    stageSlackMs: 2000,
    /** The "turn" prompt is held this long before the 3-2-1 count. */
    turnPromptMs: 2500,
    countdownFrom: 3,
    countdownStepMs: 1000,
    /** Pose detection may use this share of a frame interval before it is thinned out. */
    poseBudgetFraction: 0.4,
    /** At most every Nth frame skips pose detection (30 / 4 = 7 posed frames minimum). */
    maxPoseStride: 4,
  },
  quality: {
    minimumPoseConfidence: 0.6,
    minimumOrientationConfidence: 0.6,
    minimumVisibilityConfidence: 0.5,
    bodyCenterMinX: 0.25,
    bodyCenterMaxX: 0.75,
    minimumFrameWidth: 640,
    minimumFrameHeight: 360,
    faceAlignVisibility: 0.45,
  },
  motion: {
    processingFps: 15,
    maximumRotationSpeed: 45,
    minimumRotationSpeed: 8,
    smoothingWindowSize: 8,
    /** Circular EMA on signed frame yaw. 1 = no smoothing. */
    orientationSmoothingAlpha: 0.35,
    orientationHysteresisDeg: 12,
    rotationDeadzoneDeg: 0.4,
    directionConfirmDeg: 25,
    /** Reject a single-frame jump larger than this (MediaPipe glitches ~158–200°). */
    maxOrientationJumpDeg: 45,
    /** Hard cap even after a long dt hitch. Never accept a ~180° teleport. */
    maxUnwrappedStepDeg: 90,
    maxAngularVelocityDegPerSec: 120,
    stablePoseFrames: 8,
    stablePoseMaxSpreadDeg: 12,
  },
  completion: {
    rotationCompleteDeg: 340,
    minimumSectorCoverage: 32,
    minimumAngularSpanDeg: 300,
    holdFrames: 4,
  },
  camera: {
    width: 1280,
    height: 720,
    jpegQuality: 0.92,
    cameraReleaseDelayMs: 250,
    notReadableRetryMs: 300,
  },
  mediapipe: {
    wasmAssetPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm',
    /** Full model: noticeably steadier landmarks (feet, hands, depth) than lite, still real-time on GPU. */
    modelAssetPath:
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
    /**
     * Heavy model: the most accurate landmarks and 3D world landmarks, at about twice the cost of
     * full. Only the deadlift back check loads it, and only on the GPU; until it is ready, or if it
     * fails, tracking stays on full.
     */
    heavyModelAssetPath:
      'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
    heavyModelForDeadlift: true,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.6,
    handModelAssetPath:
      'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
    delegate: 'GPU' as const,
    /**
     * Bodies found per frame. More than one so the locked person can be told apart from
     * anyone else in view (`personLock`); only the locked one is ever returned.
     * Each extra body in view costs one more landmark pass.
     */
    numPoses: 3,
    /** Both hands, so the exercise wireframe can mark every detected finger. */
    numHands: 2,
  },
  /**
   * The skeleton stays on one person until they leave the mirror. Nobody else is tracked
   * meanwhile, even while that person is briefly hidden. Distances are in body sizes: the
   * largest of shoulder width, hip width and shoulder-to-hip length.
   */
  personLock: {
    /** The locked person must be missing this long before someone else can be picked up. */
    releaseMs: 2000,
    /** Furthest the torso centre may move between two consecutive frames and stay the same person. */
    maxStepBodySizes: 0.6,
    /** While the person is missing, that reach grows by this much per second... */
    reachGrowthPerSecond: 0.5,
    /** ...up to this. Kept below the gap to someone standing alongside, so the lock cannot jump to them. */
    maxReachBodySizes: 1,
    /** A body this many times larger or smaller than the locked one is someone else. */
    maxSizeRatio: 1.5,
    /** First pick: a body at the frame's side edge must be this many times bigger to win over one at the centre. */
    edgePenalty: 2,
    /** A hand counts as the locked person's only when its wrist is this close to one of their wrists. */
    handReachBodySizes: 0.6,
  },
  jointAngles: {
    /** Minimum MediaPipe visibility for each landmark in a joint triplet. */
    minimumLandmarkVisibility: 0.5,
    /** Reject a single-frame angle change larger than this (MediaPipe glitches). */
    maxAngleJumpDeg: 50,
    /** Minimum segment length (normalized image space or world meters). */
    minimumSegmentLength: 1e-4,
    /**
     * How long the last good spine angle is kept when a landmark blinks out.
     * Long enough to cover a couple of frames, short enough that a real loss is not hidden.
     */
    spineHoldMs: 300,
    /**
     * Left/right swap guard: a joint is flagged only when it sits this many times closer to the
     * opposite-side anchor than to its own. In metric space a knee is only ~1.1x closer to its
     * own hip (thigh ≈ 0.4 m, hip width ≈ 0.2 m), so requiring 1.35x the other way rejected
     * every knee reading and squats never counted.
     */
    sideConfusionRatio: 1.1,
  },
  repDetection: {
    /** Multiplier applied to each rule's tolerance for the starting-position window. */
    startToleranceFactor: 1.15,
    /** Minimum elapsed time between counted reps (ms). */
    minTimeBetweenRepsMs: 500,
    /** Grace period subtracted from required hold duration (ms). */
    holdGraceMs: 50,
    /**
     * Personal rest calibration (patients who cannot reach the configured start range, e.g.
     * knees that only straighten to 130°): holding still this long adopts the current angle as
     * the start. ~15 frames at 15 fps, a deliberate stillness rather than a pause mid-movement.
     */
    restCalibrationMs: 1000,
    /**
     * "Still" during calibration: every joint within this many degrees of where the hold began.
     * Above MediaPipe's frame-to-frame knee/elbow jitter (2–3°), below a deliberate movement.
     */
    restStabilityDeg: 5,
    /**
     * A shortfall is only reported when the attempt covered at least this fraction of the way
     * from the start zone to the target window; smaller excursions are weight shifts.
     */
    missedAttemptMinProgress: 0.5,
  },
  squatForm: {
    /** A fault must persist this long before it counts (and is spoken). */
    sustainMs: 1000,
    /** A fault missing for less than this keeps its onset, so one dropped frame does not restart the timer. */
    dropoutGraceMs: 250,
    /** Knee-line checks start once the knee bends past this flexion (standing straight is ~0–10°). */
    engagedKneeFlexionDeg: 25,
    /** Front view: knee may sit this far (fraction of shin length) either side of its heel line. */
    kneeLineToleranceRatio: 0.25,
    /** Side view: knee may pass the toes by this fraction of shin length. */
    kneePastToeRatio: 0.15,
    shoulderTiltMaxDeg: 6,
    pelvisTiltMaxDeg: 6,
    trunkSideLeanMaxDeg: 8,
    /** Side view: trunk may lean forward this much more than the shin before the chest counts as dropping. */
    trunkShinGapMaxDeg: 25,
    /** Shoulder width / torso length. Below `side` the camera sees the body side-on; above `front`, face-on. */
    sideViewRatio: 0.35,
    frontViewRatio: 0.55,
    minimumLandmarkVisibility: 0.5,
    /** Standing zero: the patient must hold still this long before their pose becomes 0°. */
    zeroHoldMs: 1000,
    /** Standing zero: nine in ten readings must stay this close to the middle reading to count as still. */
    zeroStillnessDeg: 5,
    /** Standing zero: a gap in tracking longer than this starts the hold again. */
    zeroMaxGapMs: 500,
    /** Standing zero: knees bent past this are not standing. Matches the rep counter's 145° start. */
    zeroMaxKneeFlexionDeg: 35,
    /** Standing zero: a back or knee further than this from vertical is not standing. */
    zeroMaxLeanDeg: 25,
    /**
     * Standing zero: hips at least this high above the knees, as a share of shin length, in the
     * camera image. About 1 standing, about 0 with the thigh level. Unlike knee flexion it needs
     * no depth, so a squat held face on cannot pass for standing.
     */
    zeroMinHipRise: 0.75,
    /**
     * Standing zero: once a zero is set, a hold with the hips this much lower than in it (share of
     * shin length) is a held squat, not standing, and does not refresh the zero.
     */
    zeroHipDropRatio: 0.1,
    /** Standing zero: a pose held this much straighter at the knee replaces the zero. */
    zeroStraighterMarginDeg: 5,
    /** Standing zero: readings this close to the zero show as 0°, so landmark jitter does not flicker. */
    zeroDeadbandDeg: 2,
    /**
     * Front view toe-out: heel-to-toe length as a share of shin (knee-to-ankle) length. A front
     * camera cannot see how far a foot points out, only how far the toe sits to the side of the
     * heel, so the foot length comes from the shin. Untuned, about 0.6 for adults.
     */
    toeOutFootToShinRatio: 0.62,
  },
  /**
   * Squat and lunge models (`exercise/angleRangeModels.ts`): how a rep is found in the angle the
   * model judges, and where its bottom is.
   */
  rangeJudge: {
    /** Side view: a rep starts once the thigh is this far from vertical, and ends back below `release`. */
    sideEngageDeg: 25,
    sideReleaseDeg: 12,
    /** Side view: the bottom of a rep is every frame within this of its deepest thigh angle. */
    sideBottomWindowDeg: 4,
    /**
     * Front view: hips this much lower over the knees than standing (share of standing height)
     * start a rep, and back within `release` end it. About 0.3 at a 45° partial squat.
     */
    frontEngageDrop: 0.15,
    frontReleaseDrop: 0.07,
    /** Front view: the bottom of a rep is every frame within this of its deepest hip drop. */
    frontBottomWindowDrop: 0.05,
    /** Shorter dips are landmark noise or a stumble, not a rep. */
    minRepMs: 500,
    /** A tracking gap (or a turn to the wrong view) longer than this drops the rep in progress. */
    maxGapMs: 700,
    /** Toe-out is taken from the standing frames in this window before the rep starts. */
    toeOutWindowMs: 1000,
    /** Standing frames kept for the front view's standing hip height. */
    standingFrames: 15,
    /**
     * Tibia: a leg is judged at the reading this far into its spread from either end, so a
     * single noisy frame cannot fail a rep but a fifth of the bottom and way up can.
     */
    tibiaPercentile: 0.2,
  },
  shoulderForm: {
    minimumLandmarkVisibility: 0.5,
    /** The arms must hold still at the sides this long before that pose becomes 0°. */
    zeroHoldMs: 1000,
    /** Nine in ten readings must stay this close to the middle reading to count as still. */
    zeroStillnessDeg: 5,
    /** A gap in tracking longer than this starts the hold again. */
    zeroMaxGapMs: 500,
    /** An arm further than this from the trunk is not at rest. Matches the rep counter's start range. */
    zeroMaxRestDeg: 35,
    /** Readings this close to the zero show as 0°, so landmark jitter does not flicker. */
    zeroDeadbandDeg: 2,
  },
  lungeForm: {
    sustainMs: 1000,
    dropoutGraceMs: 250,
    /** Front view: the toe→knee line may lean this far from the vertical toe line before it turns red. */
    kneeLineMaxDeg: 5,
    /** Spoken corrections start once the lead knee closes below this included angle (straight is 180°). */
    engagedKneeAngleDeg: 155,
    /** Auto lead-leg pick: the other foot must sit this much lower in the image (normalized) to take over. */
    leadFootSwitchMargin: 0.03,
    minimumLandmarkVisibility: 0.5,
    /** Shoulder width / torso length. Below `side` the camera sees the body side-on; above `front`, face-on. */
    sideViewRatio: 0.35,
    frontViewRatio: 0.55,
    /** Side view: the front leg changes only once the other ankle is this far ahead (share of shin length). */
    sideLeadSwitchRatio: 0.15,
    /** Side view: the lead knee is in the lunge once it bends past this flexion (straight is 0°). */
    sideEngagedKneeFlexionDeg: 30,
    /** Side-view standing zero: the patient must hold still this long before their pose becomes 0°. */
    zeroHoldMs: 1000,
    /** Side-view standing zero: nine in ten readings must stay this close to the middle one. */
    zeroStillnessDeg: 5,
    /** Side-view standing zero: a gap in tracking longer than this starts the hold again. */
    zeroMaxGapMs: 500,
    /** Side-view standing zero: knees bent past this are not standing. */
    zeroMaxKneeFlexionDeg: 35,
    /** Side-view standing zero: a thigh, shin or back further than this from vertical is not standing. */
    zeroMaxLeanDeg: 25,
    /** Side-view standing zero: readings this close to the zero show as 0°. */
    zeroDeadbandDeg: 2,
  },
  deadliftForm: {
    sustainMs: 1000,
    dropoutGraceMs: 250,
    /**
     * Stretch of the hip→shoulder line whose back outline is read (0 = hip, 1 = shoulder).
     * Leaves out the glutes at the bottom. Runs on up to just below the shoulder, the part of the
     * back that bends most in a deadlift; the arms hang on the chest side there, off the back's edge.
     * The outline is split at `backSplit`: lumbar toward the hip, thoracic toward the shoulder.
     */
    backSampleFrom: 0.2,
    backSampleTo: 0.92,
    backSplit: 0.5,
    backSampleCount: 15,
    /** Rounding is judged once the trunk leans at least this far from upright. */
    engagedTrunkLeanDeg: 20,
    /** Shoulder width / torso length. Above this the camera is too face-on to judge the back. */
    sideViewRatio: 0.45,
    minimumLandmarkVisibility: 0.5,
    /**
     * Unvalidated. Extra posterior sagitta, as a fraction of hip–shoulder length, above the
     * person's standing baseline before a region can count as possibly rounded. This is an
     * outline estimate, not a vertebral angle, and it is not a 10° or 25° cutoff.
     */
    // The thoracic (shoulder and neck) side is more sensitive than the lumbar one: in a deadlift
    // the back rounds up there, not near the hips.
    thoracicEnterDelta: 0.03,
    lumbarEnterDelta: 0.045,
    /** While a region is already latched, it releases below enter × this. */
    deltaRelease: 0.75,
    /** Contour or landmark confidence below this does not classify rounding. */
    minContourConfidence: 0.45,
    /** World-landmark segment lengths outside this range (meters) are not trusted. */
    worldTorsoLengthM: { min: 0.2, max: 0.95 },
    worldThighLengthM: { min: 0.15, max: 0.8 },
    /** Confidence multiplier when world landmarks exist but their scale is implausible. */
    worldFallbackConfidence: 0.7,
    /**
     * One Euro filter. `minCutoff` is low enough that one noisy frame stays under the
     * enter delta; `beta` lets a real step arrive inside the sustain window.
     */
    oneEuro: { minCutoff: 1.8, beta: 0.4, dCutoff: 1 },
    /**
     * Undo the camera's foreshortening of the body's side view, from the yaw in MediaPipe's 3D world
     * landmarks. Only the spine keypoints are corrected; drawn angles stay in camera pixels.
     */
    sagittalCorrection: { maxYawDeg: 35, minHipWidthM: 0.1, maxHipWidthM: 0.5 },
    calibration: {
      minFrames: 8,
      minDurationMs: 400,
      /** A stored baseline older than this is ignored. */
      maxAgeMs: 12 * 60 * 60 * 1000,
      /** Upright enough to record a standing side-view baseline. */
      maxTrunkLeanDeg: 12,
    },
    /**
     * A completed rep is not scored correct when fewer than this share of its hinged
     * frames produced a confident, calibrated contour.
     */
    minJudgedCoverage: 0.5,
    /** Knee included angle at or above this counts as extended. */
    extendedKneeDeg: 155,
    /** Knee included angle below this still counts as bent. */
    flexedKneeDeg: 140,
  },
  /**
   * SpinePose (https://github.com/dfki-av/spinepose) predicts the spine itself, where MediaPipe only
   * has shoulders and hips. Its weights are CC BY-NC 4.0: not for commercial use. They are downloaded
   * at run time from this pinned revision and checked against this hash, and never bundled.
   */
  spinePose: {
    modelUrl:
      'https://huggingface.co/dfki-av/spinepose/resolve/ab98f8b467b9b9ca6e09467525d49a1b0c8fc9fa/spinepose-s_32xb256-10e_simspine-256x192.onnx',
    modelSha256: '51be70eae41db473d41d7fd103bcb643978e836d91a79a410fd57f18a23b2c1b',
    /** Must match the installed `onnxruntime-web` exactly. A test holds it to package.json. */
    wasmPath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.1/dist/',
    inputWidth: 192,
    inputHeight: 256,
    simccSplitRatio: 2,
    /**
     * RGB. The repo's Python feeds BGR with these same values, but the model was trained on RGB:
     * on real footage RGB gave higher keypoint scores and steadier points.
     */
    mean: [123.675, 116.28, 103.53],
    std: [58.395, 57.12, 57.375],
    /** Added around the landmark box, as a fraction of its long side, to stand in for a person detector's box. */
    landmarkBoxPadding: 0.12,
    /** The model's own crop padding. */
    cropPadding: 1.25,
    minLandmarkVisibility: 0.3,
    minCropLandmarks: 4,
    /** Longest side of the landmark box, in frame pixels, below which the body is too small to read. */
    minBoxPx: 32,
    /** Normalized coordinates past this far outside the frame are ignored when cropping. */
    maxLandmarkOverflow: 0.25,
    /** At most this often. The camera loop runs at 15 fps. */
    minIntervalMs: 66,
    /** An older result is not used: the body has moved on. */
    maxResultAgeMs: 400,
    maxConsecutiveFailures: 5,
    loadTimeoutMs: 90_000,
    runTimeoutMs: 3_000,
    chain: {
      /** Below this SimCC peak on any back station the chain is not trusted. Clear views score about 1. */
      minPointScore: 0.4,
      /** Score that counts as full confidence. */
      fullPointScore: 0.9,
      /** How far a station may step back along the chain, as a fraction of hip → neck, before it counts as folded. */
      maxFoldBack: 0.02,
      /** Largest believable offset from hip → neck, as a fraction of it. */
      maxOffset: 0.35,
      /** Chain length against the tracked hip–shoulder length. Outside this it is not the same torso. */
      minTorsoRatio: 0.6,
      maxTorsoRatio: 1.6,
      /** How far the chain's hip may sit from the tracked hip, in torso lengths. Allows for the model's lag. */
      maxHipOffset: 0.75,
      /** Cosine between the chain and the tracked trunk line below which they disagree. */
      minTrunkAlignment: 0.7,
      /**
       * Rise above the person's standing baseline before a region counts as possibly rounded.
       * Smaller than the outline's because the model pulls a bend toward straight: warping real photos
       * by a known amount, it reads about 0.3 of the true bulge. On real clips a flat-back hinge stayed
       * at or below about 0.026 (p90) and rounded backs reached 0.04–0.07. Tuned on a handful of clips,
       * not clinically validated. The thoracic reading has since been reshaped to weight the area near
       * the shoulders; a whole-back arc reads about the same, but this line wants checking on new clips.
       */
      thoracicEnterDelta: 0.02,
      lumbarEnterDelta: 0.03,
      /**
       * With the body outline also past its own threshold, the upper-back warning opens at this share
       * of `thoracicEnterDelta`. Two independent reads agreeing outweigh one read clearing a higher bar.
       * Not yet tuned on footage.
       */
      outlineConfirmShare: 0.5,
      /**
       * T8, T3 and C7 should stay in a line. Turn at T3 above the person's standing value, in
       * degrees, before the upper back counts as bent. The model pulls bends toward straight, so
       * this is a smaller number than the true bend. Not yet tuned on footage.
       */
      upperBackLineEnterDeg: 5,
      /** Distinct model results a reading is the median of, so one bad result cannot move it. */
      medianCaptures: 3,
      /**
       * Distinct model results that make a standing baseline. Fewer than the outline's camera frames
       * because the model runs at about 10 per second: at 8, a patient who starts hinging within a
       * second never gets a baseline, and so never gets a warning.
       */
      calibrationMinCaptures: 5,
      /**
       * After the keypoints stop, how long to wait before going back to the outline. Not reading
       * the back for a moment is better than comparing two scales that do not match.
       */
      holdMs: 1_500,
    },
  },
  debug: {
    rotation: readRotationDebugFlag(),
    exerciseDiagnostic: readExerciseDiagnosticFlag(),
  },
} as const;

export type VisionConfig = typeof VISION_CONFIG;
