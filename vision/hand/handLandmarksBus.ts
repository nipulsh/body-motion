export const HAND_LANDMARK_COUNT = 21;

export interface HandLandmarkPoint {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
  presence?: number;
}

export interface TrackedHand {
  landmarks: readonly HandLandmarkPoint[];
  handedness: string | null;
}

type HandsListener = (hands: readonly TrackedHand[]) => void;

let hands: readonly TrackedHand[] = [];
const listeners = new Set<HandsListener>();

/** Latest hands from the single shared HandLandmarker. */
export function getTrackedHands(): readonly TrackedHand[] {
  return hands;
}

export function setTrackedHands(next: readonly TrackedHand[]): void {
  hands = next;
  for (const listener of listeners) {
    try {
      listener(hands);
    } catch {
      // A canvas redraw must not stop the next detection frame.
    }
  }
}

export function subscribeTrackedHands(listener: HandsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * HandLandmarker returns every joint of a detected hand, but often leaves
 * `visibility` at 0 because hands are scored with presence instead.
 * A positive visibility or presence score is honored; 0 or a missing score
 * still draws the joint.
 */
export function handLandmarkVisibility(landmark: HandLandmarkPoint | undefined): number {
  if (!landmark) return 0;
  if (typeof landmark.presence === 'number' && landmark.presence > 0) return landmark.presence;
  if (typeof landmark.visibility === 'number' && landmark.visibility > 0) return landmark.visibility;
  return 1;
}
