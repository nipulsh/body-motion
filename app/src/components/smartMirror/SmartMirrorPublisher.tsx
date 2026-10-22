import { useEffect, useRef } from 'react';
import { isDesktopApp } from '../../desktop/desktopApi';
import { mirrorEmitTo, listenMirrorEvent } from '../../desktop/mirrorEvents';
import {
  encodeMirrorExercise,
  encodeMirrorPose,
  MIRROR_EXERCISE_EVENT,
  MIRROR_POSE_EVENT,
  MIRROR_READY_EVENT,
  MIRROR_STATUS_EVENT,
} from '../../display/mirrorChannel';
import { useSmartMirrorExercise } from '../../hooks/useSmartMirrorExercise';
import { useSmartMirrorPose } from '../../hooks/useSmartMirrorPose';
import { getTrackedHands } from '@vision/hand/handLandmarksBus';

const POSE_INTERVAL_MS = 66;

/** Forwards the main window's existing pose and exercise session to the TV. */
export function SmartMirrorPublisher() {
  const exercise = useSmartMirrorExercise();
  const latestExercise = useRef(encodeMirrorExercise(exercise));
  const lastPoseAt = useRef(0);
  latestExercise.current = encodeMirrorExercise(exercise);

  const { error } = useSmartMirrorPose((pose, frame) => {
    if (!isDesktopApp()) return;
    const now = performance.now();
    const clear = !pose?.landmarks?.length;
    if (!clear && now - lastPoseAt.current < POSE_INTERVAL_MS) return;
    lastPoseAt.current = now;
    mirrorEmitTo(
      'smart-mirror',
      MIRROR_POSE_EVENT,
      encodeMirrorPose(pose, frame, Date.now(), getTrackedHands()),
    );
  });

  useEffect(() => {
    if (!isDesktopApp()) return;
    mirrorEmitTo('smart-mirror', MIRROR_EXERCISE_EVENT, latestExercise.current);
  }, [
    exercise.exercise?.id,
    exercise.exercise?.name,
    exercise.exercise?.demoVideoUrl,
    exercise.repCount,
    exercise.targetReps,
  ]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    mirrorEmitTo('smart-mirror', MIRROR_STATUS_EVENT, { message: error });
  }, [error]);

  useEffect(() => {
    if (!isDesktopApp()) return;
    let cancelled = false;
    let unlisten = () => {};
    void listenMirrorEvent(MIRROR_READY_EVENT, () => {
      mirrorEmitTo('smart-mirror', MIRROR_EXERCISE_EVENT, latestExercise.current);
    }).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unlisten();
      mirrorEmitTo('smart-mirror', MIRROR_POSE_EVENT, encodeMirrorPose(null, null, Date.now(), []));
    };
  }, []);

  return null;
}
