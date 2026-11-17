import * as THREE from 'three';

/** A numbered marker on the anatomy map; `number` matches the findings list (index + 1). */
export interface MuscleMarker {
  /** Position in the analysis muscle list. */
  index: number;
  number: number;
  label: string;
  meshNames: string[];
}

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
}

interface MuscleMeshRef {
  name?: string;
  bodyExplorerId?: string;
  bodyExplorerMeshNames?: string[];
}

/** BodyExplorer meshes for one analysis muscle: the mesh list, else the single id, else none. */
export function muscleMeshNames(muscle: MuscleMeshRef): string[] {
  if (muscle.bodyExplorerMeshNames && muscle.bodyExplorerMeshNames.length > 0) {
    return muscle.bodyExplorerMeshNames;
  }
  return muscle.bodyExplorerId ? [muscle.bodyExplorerId] : [];
}

/**
 * One marker per muscle that has 3D meshes. Numbers follow the findings list, so a muscle
 * that cannot be shown leaves a gap (e.g. 1, 3) rather than renumbering the rest.
 */
export function buildMuscleMarkers(muscles: readonly MuscleMeshRef[]): MuscleMarker[] {
  return muscles.flatMap((muscle, index) => {
    const meshNames = muscleMeshNames(muscle);
    return meshNames.length > 0
      ? [{ index, number: index + 1, label: muscle.name ?? `Muscle ${index + 1}`, meshNames }]
      : [];
  });
}

/** Room around a focused muscle: 1.6x its size, so neighbouring context stays readable. */
const FOCUS_PADDING = 1.6;
/** Smallest framed size, so a sliver-thin muscle does not put the camera inside it. */
const MIN_FOCUS_SIZE = 0.5;

/**
 * Camera pose that frames `box` from the current viewing direction (the user's orbit angle
 * is kept), fitting both the view height and, on narrow panels, the view width.
 */
export function focusPose(
  box: THREE.Box3,
  currentPosition: THREE.Vector3,
  currentTarget: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  padding = FOCUS_PADDING,
): CameraPose {
  const target = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, MIN_FOCUS_SIZE);
  const halfFov = (fovDeg * Math.PI) / 360;
  const fitHeight = extent / 2 / Math.tan(halfFov);
  const fitWidth = fitHeight / Math.max(aspect, 1e-4);
  const distance = padding * Math.max(fitHeight, fitWidth) + extent / 2;

  const direction = currentPosition.clone().sub(currentTarget);
  if (direction.lengthSq() < 1e-8) direction.set(0, 0, 1);
  direction.normalize();
  return { target, position: target.clone().addScaledVector(direction, distance) };
}

export function easeOutCubic(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return 1 - (1 - clamped) ** 3;
}

export function lerpPose(from: CameraPose, to: CameraPose, t: number): CameraPose {
  return {
    position: from.position.clone().lerp(to.position, t),
    target: from.target.clone().lerp(to.target, t),
  };
}

/**
 * Container pixel position of a world point. Not visible when it is behind the camera or
 * outside the view, so its marker can be hidden instead of pinned to an edge.
 */
export function projectToContainer(
  point: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): { x: number; y: number; visible: boolean } {
  const ndc = point.clone().project(camera);
  const visible =
    Number.isFinite(ndc.x) &&
    ndc.z > -1 &&
    ndc.z < 1 &&
    Math.abs(ndc.x) <= 1 &&
    Math.abs(ndc.y) <= 1;
  return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible };
}

/** Camera moves are animated over this long, or instant when the user prefers reduced motion. */
export const CAMERA_MOVE_MS = 450;

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;
}
