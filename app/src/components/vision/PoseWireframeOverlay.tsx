import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import {
  drawHandWireframes,
  drawPoseWireframe,
  drawExerciseFormOverlay,
  type ExerciseFormResult,
  type PoseResult,
  type PoseLandmark,
} from '@vision';
import {
  getTrackedHands,
  subscribeTrackedHands,
  type TrackedHand,
} from '@vision/hand/handLandmarksBus';
import { handsOfPose } from '@vision/hand/handWireframe';
import {
  createMirrorProjection,
  type MirrorGeometry,
  type MirrorViewer,
} from '@vision/pose/mirrorReflection';
import { FORM_COLORS, faultColor } from '@vision/exercise/formOverlayKit';
import { DecoupledWireframeSession } from '@vision/pose/wireframeDecoupled';
import {
  DistanceTracker,
  estimateEyeBody,
  EyePositionTracker,
  LandmarkVisibilityGate,
  StandingEyeTracker,
} from '@vision/pose/wireframeTracking';

export interface PoseWireframeFrameSize {
  width: number;
  height: number;
}

export interface PoseWireframeOverlayHandle {
  draw(
    pose: PoseResult | null,
    frame?: PoseWireframeFrameSize | null,
    hands?: readonly TrackedHand[],
  ): void;
}

interface PoseWireframeOverlayProps {
  pose?: PoseResult | null;
  /** When set with `pose`, letterboxes the skeleton to match object-contain video framing. */
  sourceFrame?: PoseWireframeFrameSize | null;
  className?: string;
  lineWidth?: number;
  jointRadius?: number;
  /** Flip image-left/right so the skeleton matches the mirrored camera preview. */
  mirrorX?: boolean;
  /**
   * Smart Mirror TV: draw each joint where the viewer sees it reflected in the
   * glass, from their tracked eye position. Parts whose reflection falls off
   * the display (e.g. legs while squatting) are clipped at the display edge.
   */
  mirrorGeometry?: MirrorGeometry | null;
  /**
   * With `mirrorGeometry`: still track the viewer (for `onViewer`) but draw the
   * skeleton exactly over the person in the video, at the video's own size,
   * instead of at the reflected, reshaped position.
   */
  matchVideo?: boolean;
  /**
   * Exercise form guides (toe reference lines, joint angles, alignment). Drawn
   * over the camera image only, so not in reflected mirror placement.
   */
  form?: ExerciseFormResult | null;
  /** Called once per pose with the tracked viewer (mirror mode), or null. */
  onViewer?: (viewer: MirrorViewer | null) => void;
  ref?: Ref<PoseWireframeOverlayHandle>;
}

interface PoseDrawState {
  /** The pose these values were computed for. */
  pose: PoseResult | null;
  visibleMask: readonly boolean[];
  /** Viewer for mirror reflection mode. */
  viewer: MirrorViewer | null;
  /** Mirror mode: torso frozen, arms scaled; null uses raw pose landmarks. */
  displayLandmarks: readonly PoseLandmark[] | null;
  extraDropIn: number;
}

interface MirrorTrackers {
  geometry: MirrorGeometry;
  eye: EyePositionTracker;
  distance: DistanceTracker;
  standing: StandingEyeTracker;
  /** An eye measurement has been seen since the trackers were created. */
  eyeSeen: boolean;
}

const WIREFRAME_STROKE = 'rgba(96, 210, 255, 0.92)';
const WIREFRAME_JOINT = 'rgba(255, 255, 255, 0.95)';

function paintWireframe(
  canvas: HTMLCanvasElement,
  pose: PoseResult | null,
  hands: readonly TrackedHand[],
  lineWidth: number,
  jointRadius: number,
  frame: PoseWireframeFrameSize | null,
  mirrorX: boolean,
  drawState: PoseDrawState,
  mirrorGeometry: MirrorGeometry | null,
  matchVideo: boolean,
  form: ExerciseFormResult | null,
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fitted = frame && frame.width > 0 && frame.height > 0 ? frame : null;
  let project;
  if (mirrorGeometry && !matchVideo) {
    // Reflection placement needs the camera frame size and the viewer; without them nothing lines up.
    const viewer = drawState.viewer;
    if (!fitted || !viewer) return;
    project = createMirrorProjection(
      viewer.eye,
      fitted,
      canvas.width,
      canvas.height,
      { ...mirrorGeometry, wireframeScale: 1 },
      viewer.distanceIn,
      drawState.extraDropIn,
    );
  }
  const style = {
    lineWidth,
    jointRadius,
    strokeStyle: WIREFRAME_STROKE,
    jointFillStyle: WIREFRAME_JOINT,
    fit: fitted ? ('contain' as const) : ('stretch' as const),
    sourceWidth: frame?.width,
    sourceHeight: frame?.height,
    mirrorX,
    project,
  };
  const landmarks = drawState.displayLandmarks ?? pose?.landmarks;
  if (landmarks?.length) {
    // A pose that has not been through the gate yet uses the plain visibility floor.
    const visibleMask = drawState.pose === pose ? drawState.visibleMask : undefined;
    const deadlift = form?.kind === 'deadlift' ? form : null;
    const backColor = deadlift
      ? faultColor(deadlift.faults, [
          'possible_combined_rounding',
          'possible_upper_back_rounding',
          'possible_lower_back_rounding',
        ])
      : 'good';
    const backFrame = deadlift?.frame;
    const spineCurveReady = (backFrame?.spineCurve.points.length ?? 0) >= 2;
    drawPoseWireframe(ctx, landmarks, {
      ...style,
      visibleMask,
      backBow:
        spineCurveReady || !backFrame?.rounded ? undefined : { side: backFrame.side, offset: backFrame.spineBow },
      hideDerivedSpine: spineCurveReady,
      spineStrokeStyle: backColor === 'good' ? undefined : FORM_COLORS[backColor],
    });
  }
  if (form && !project && pose?.landmarks.length) {
    drawExerciseFormOverlay(ctx, pose.landmarks, form, { ...style, lineWidth });
  }
  if (hands.length > 0) {
    drawHandWireframes(ctx, hands, {
      ...style,
      poseLandmarks: landmarks,
    });
  }
}

export function PoseWireframeOverlay({
  pose,
  sourceFrame,
  className,
  lineWidth = 3,
  jointRadius = 4,
  mirrorX = false,
  mirrorGeometry = null,
  matchVideo = false,
  form = null,
  onViewer,
  ref,
}: PoseWireframeOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<PoseResult | null>(pose ?? null);
  const frameRef = useRef<PoseWireframeFrameSize | null>(null);
  const handsRef = useRef<readonly TrackedHand[]>(getTrackedHands());
  const explicitHandsRef = useRef(false);
  const styleRef = useRef({ lineWidth, jointRadius, mirrorX, mirrorGeometry, matchVideo, form });
  const visibilityGateRef = useRef(new LandmarkVisibilityGate());
  const mirrorTrackersRef = useRef<MirrorTrackers | null>(null);
  const drawStateRef = useRef<PoseDrawState>({
    pose: null,
    visibleMask: [],
    viewer: null,
    displayLandmarks: null,
    extraDropIn: 0,
  });
  const decoupledRef = useRef<DecoupledWireframeSession | null>(null);
  const decoupledGeometryRef = useRef<MirrorGeometry | null>(null);
  const shapedHandsRef = useRef<readonly TrackedHand[]>([]);
  const onViewerRef = useRef(onViewer);
  onViewerRef.current = onViewer;
  if (pose !== undefined) poseRef.current = pose;
  styleRef.current = { lineWidth, jointRadius, mirrorX, mirrorGeometry, matchVideo, form };

  const mirrorTrackers = (geometry: MirrorGeometry): MirrorTrackers => {
    if (mirrorTrackersRef.current?.geometry !== geometry) {
      mirrorTrackersRef.current = {
        geometry,
        eye: new EyePositionTracker({ x: 0, h: geometry.defaultEyeHeightIn }),
        distance: new DistanceTracker(geometry.userDistanceIn),
        standing: new StandingEyeTracker(),
        eyeSeen: false,
      };
    }
    return mirrorTrackersRef.current;
  };

  /** Advance the stateful filters once per new pose, not on resize or hand-only repaints. */
  const ingestPose = (next: PoseResult | null) => {
    if (drawStateRef.current.pose === next && next !== null) return;
    const landmarks = next?.landmarks ?? null;
    const visibleMask = visibilityGateRef.current.update(landmarks);
    const geometry = styleRef.current.mirrorGeometry;
    let viewer: MirrorViewer | null = null;
    let displayLandmarks: readonly PoseLandmark[] | null = null;
    let extraDropIn = 0;
    if (geometry) {
      const trackers = mirrorTrackers(geometry);
      const now = performance.now();
      const frame = frameRef.current;
      const distanceIn = trackers.distance.update(landmarks, frame, geometry, now);
      const measured = frame ? estimateEyeBody(landmarks, frame, geometry, distanceIn) : null;
      const eye = trackers.eye.update(measured, now);
      const standing = trackers.standing.update(measured ? eye : null, now);
      viewer = {
        eye,
        distanceIn,
        standingEyeHeightIn: standing ?? geometry.defaultEyeHeightIn,
        eyeDetected: trackers.eyeSeen || measured !== null,
      };
      trackers.eyeSeen = viewer.eyeDetected!;
      if (!styleRef.current.matchVideo) {
        if (decoupledGeometryRef.current !== geometry) {
          decoupledRef.current = new DecoupledWireframeSession(geometry);
          decoupledGeometryRef.current = geometry;
        }
        const decoupled = decoupledRef.current!.update(landmarks, frame, distanceIn, now);
        displayLandmarks = decoupled.landmarks;
        extraDropIn = decoupled.extraDropIn;
      }
    } else {
      mirrorTrackersRef.current = null;
      decoupledRef.current = null;
      decoupledGeometryRef.current = null;
      shapedHandsRef.current = [];
    }
    drawStateRef.current = { pose: next, visibleMask, viewer, displayLandmarks, extraDropIn };
    onViewerRef.current?.(viewer);
  };

  const paintCurrent = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!explicitHandsRef.current) handsRef.current = getTrackedHands();
    const style = styleRef.current;
    const drawState = drawStateRef.current;
    // Only the tracked person's hands, judged on camera landmarks before any mirror reshaping.
    const frame = frameRef.current;
    const ownHands = handsOfPose(handsRef.current, poseRef.current?.landmarks, frame?.width, frame?.height);
    if (style.mirrorGeometry && !style.matchVideo && decoupledRef.current && drawState.displayLandmarks?.length) {
      shapedHandsRef.current = decoupledRef.current.shapeHands(ownHands, drawState.displayLandmarks);
    }
    const hands =
      ownHands.length > 0 && style.mirrorGeometry && !style.matchVideo && shapedHandsRef.current.length > 0
        ? shapedHandsRef.current
        : ownHands;
    paintWireframe(
      canvas,
      poseRef.current,
      hands,
      style.lineWidth,
      style.jointRadius,
      frameRef.current,
      style.mirrorX,
      drawState,
      style.mirrorGeometry,
      style.matchVideo,
      style.form,
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      draw(next, frame, hands) {
        poseRef.current = next;
        if (frame !== undefined) frameRef.current = frame;
        ingestPose(next);
        if (hands !== undefined) {
          explicitHandsRef.current = true;
          handsRef.current = hands;
        }
        paintCurrent();
      },
    }),
    [],
  );

  useEffect(() => {
    if (!explicitHandsRef.current) {
      handsRef.current = getTrackedHands();
    }
    return subscribeTrackedHands((hands) => {
      if (explicitHandsRef.current) return;
      handsRef.current = hands;
      paintCurrent();
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const resize = () => {
      const rect = parent.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      paintCurrent();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(parent);

    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (pose !== undefined) poseRef.current = pose;
    if (sourceFrame !== undefined) frameRef.current = sourceFrame;
    // Same pose again (style change, frame size change, StrictMode re-run) is not a new sample.
    if (pose !== undefined) ingestPose(pose);
    paintCurrent();
  }, [pose, sourceFrame, lineWidth, jointRadius, mirrorX, mirrorGeometry, matchVideo, form]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'}
      aria-hidden
    />
  );
}
