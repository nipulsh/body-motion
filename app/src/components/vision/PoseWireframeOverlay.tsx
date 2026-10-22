import { useEffect, useImperativeHandle, useRef, type Ref } from 'react';
import { drawHandWireframes, drawPoseWireframe, type PoseResult } from '@vision';
import {
  getTrackedHands,
  subscribeTrackedHands,
  type TrackedHand,
} from '@vision/hand/handLandmarksBus';

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
  ref?: Ref<PoseWireframeOverlayHandle>;
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
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const fitted = Boolean(frame && frame.width > 0 && frame.height > 0);
  const style = {
    lineWidth,
    jointRadius,
    strokeStyle: WIREFRAME_STROKE,
    jointFillStyle: WIREFRAME_JOINT,
    fit: fitted ? ('contain' as const) : ('stretch' as const),
    sourceWidth: frame?.width,
    sourceHeight: frame?.height,
    mirrorX,
  };
  if (pose?.landmarks?.length) {
    drawPoseWireframe(ctx, pose.landmarks, style);
  }
  if (hands.length > 0) {
    drawHandWireframes(ctx, hands, {
      ...style,
      poseLandmarks: pose?.landmarks,
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
  ref,
}: PoseWireframeOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const poseRef = useRef<PoseResult | null>(pose ?? null);
  const frameRef = useRef<PoseWireframeFrameSize | null>(null);
  const handsRef = useRef<readonly TrackedHand[]>(getTrackedHands());
  const explicitHandsRef = useRef(false);
  const styleRef = useRef({ lineWidth, jointRadius, mirrorX });
  if (pose !== undefined) poseRef.current = pose;
  styleRef.current = { lineWidth, jointRadius, mirrorX };

  const paintCurrent = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!explicitHandsRef.current) handsRef.current = getTrackedHands();
    const style = styleRef.current;
    paintWireframe(
      canvas,
      poseRef.current,
      handsRef.current,
      style.lineWidth,
      style.jointRadius,
      frameRef.current,
      style.mirrorX,
    );
  };

  useImperativeHandle(
    ref,
    () => ({
      draw(next, frame, hands) {
        poseRef.current = next;
        if (frame !== undefined) frameRef.current = frame;
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
    paintCurrent();
  }, [pose, sourceFrame, lineWidth, jointRadius, mirrorX]);

  return (
    <canvas
      ref={canvasRef}
      className={className ?? 'pointer-events-none absolute inset-0 h-full w-full'}
      aria-hidden
    />
  );
}
