import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import type { Mesh } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MIRROR_GESTURE_TARGET_ATTR, MIRROR_MODEL_ATTR } from '@vision/hand/gestureTargets';
import { cn } from '@/lib/utils';
import { buildBody } from './bodyBuilder.js';
import { applyMuscleHighlights, clearMuscleHighlights, meshMatchesKeys } from './highlights';
import { registerMirrorModelControl, type MirrorModelControl } from './mirrorModelControl';
import { ViewerResetButton } from './ViewerResetButton';
import {
  CAMERA_MOVE_MS,
  easeOutCubic,
  focusPose,
  lerpPose,
  prefersReducedMotion,
  projectToContainer,
  type CameraPose,
  type MuscleMarker,
} from './viewerMath';

export interface CameraState {
  position: [number, number, number];
  target: [number, number, number];
  distance: number;
}

export interface BodyExplorerHandle {
  highlightMeshes: (meshNames: string[], isolate?: boolean) => void;
  clearHighlights: () => void;
  /** Animate back to the full-body view. */
  resetView: () => void;
  getCameraState: () => CameraState;
}

interface BodyExplorerViewerProps {
  highlightMeshNames?: string[];
  /** When true and meshes are selected, hide non-selected muscles. Default true. */
  isolateSelected?: boolean;
  /** Register pinch-drag pan and two-hand zoom for the mirror. */
  handControl?: boolean;
  className?: string;
  /** Numbered markers drawn over each listed muscle. */
  markers?: MuscleMarker[];
  /** Muscle index of the selected marker (drawn emphasised). */
  selectedMarkerIndex?: number | null;
  onMarkerSelect?: (index: number) => void;
  /** Zoom the camera to fit these meshes; empty returns to the full-body view. */
  focusMeshNames?: string[];
  /** Called after the reset button returns the view to the full body. */
  onResetView?: () => void;
}

interface MarkerAnchor {
  center: THREE.Vector3;
  meshes: Mesh[];
}

const NO_MARKERS: MuscleMarker[] = [];
const NO_NAMES: string[] = [];

function meshesFor(muscleMeshes: Mesh[], names: string[]): Mesh[] {
  return names.length === 0 ? [] : muscleMeshes.filter((mesh) => meshMatchesKeys(mesh, names));
}

function boxOf(meshes: Mesh[]): THREE.Box3 {
  const box = new THREE.Box3();
  for (const mesh of meshes) box.expandByObject(mesh);
  return box;
}

export const BodyExplorerViewer = forwardRef<BodyExplorerHandle, BodyExplorerViewerProps>(
  function BodyExplorerViewer(
    {
      highlightMeshNames = NO_NAMES,
      isolateSelected = true,
      handControl = false,
      className,
      markers = NO_MARKERS,
      selectedMarkerIndex = null,
      onMarkerSelect,
      focusMeshNames = NO_NAMES,
      onResetView,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasHostRef = useRef<HTMLDivElement>(null);
    const muscleMeshesRef = useRef<Mesh[]>([]);
    const modelControlRef = useRef<MirrorModelControl | null>(null);
    const isolateRef = useRef(isolateSelected);
    isolateRef.current = isolateSelected;
    const highlightRef = useRef(highlightMeshNames);
    highlightRef.current = highlightMeshNames;
    const focusRef = useRef(focusMeshNames);
    focusRef.current = focusMeshNames;

    const markerElements = useRef(new Map<number, HTMLButtonElement>());
    const markerAnchors = useRef(new Map<number, MarkerAnchor>());
    /** Camera operations set up by the mount effect; null until the scene exists. */
    const viewRef = useRef<{
      moveTo: (pose: CameraPose, zoomDistance: number) => void;
      home: () => CameraPose & { distance: number };
      focus: (names: string[]) => void;
      state: () => CameraState;
    } | null>(null);

    const rebuildAnchors = (list: MuscleMarker[]) => {
      const anchors = new Map<number, MarkerAnchor>();
      for (const marker of list) {
        const meshes = meshesFor(muscleMeshesRef.current, marker.meshNames);
        if (meshes.length === 0) continue;
        anchors.set(marker.number, { center: boxOf(meshes).getCenter(new THREE.Vector3()), meshes });
      }
      markerAnchors.current = anchors;
    };
    const markersRef = useRef(markers);
    markersRef.current = markers;

    const resetView = () => {
      const view = viewRef.current;
      if (view) {
        const home = view.home();
        view.moveTo(home, home.distance);
      }
      onResetView?.();
    };

    useImperativeHandle(ref, () => ({
      highlightMeshes(names: string[], isolate = isolateRef.current) {
        applyMuscleHighlights(muscleMeshesRef.current, names, { isolate });
      },
      clearHighlights() {
        clearMuscleHighlights(muscleMeshesRef.current);
      },
      resetView,
      getCameraState() {
        return viewRef.current?.state() ?? { position: [0, 0, 0], target: [0, 0, 0], distance: 0 };
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      const canvasHost = canvasHostRef.current;
      if (!container || !canvasHost) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a2332);

      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
      camera.position.set(0, 5, 35);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      canvasHost.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0, 5, 0);

      const panOffset = new THREE.Vector3();
      const panRight = new THREE.Vector3();
      const panUp = new THREE.Vector3();
      const panMove = new THREE.Vector3();

      let homePose: CameraPose = { position: camera.position.clone(), target: controls.target.clone() };
      let tween: { from: CameraPose; to: CameraPose; start: number; duration: number } | null = null;
      let loaded = false;

      const fitZoomLimits = (distance: number) => {
        controls.minDistance = Math.max(distance * 0.35, 0.25);
        controls.maxDistance = Math.max(distance * 3, controls.minDistance + 0.01);
      };
      fitZoomLimits(camera.position.distanceTo(controls.target));

      const applyPose = (pose: CameraPose) => {
        camera.position.copy(pose.position);
        controls.target.copy(pose.target);
        camera.updateMatrixWorld();
      };

      /** Smooth camera move (instant with reduced motion); the user's own input cancels it. */
      const moveTo = (pose: CameraPose, zoomDistance: number) => {
        // Zoom limits follow the new framing so the user can still zoom around the focus.
        fitZoomLimits(zoomDistance);
        if (prefersReducedMotion()) {
          tween = null;
          applyPose(pose);
          controls.update();
          return;
        }
        tween = {
          from: { position: camera.position.clone(), target: controls.target.clone() },
          to: pose,
          start: performance.now(),
          duration: CAMERA_MOVE_MS,
        };
      };
      controls.addEventListener('start', () => {
        tween = null;
      });

      const focus = (names: string[]) => {
        if (!loaded) return;
        const meshes = meshesFor(muscleMeshesRef.current, names);
        if (meshes.length === 0) {
          moveTo(homePose, homePose.position.distanceTo(homePose.target));
          return;
        }
        const pose = focusPose(boxOf(meshes), camera.position, controls.target, camera.fov, camera.aspect);
        moveTo(pose, pose.position.distanceTo(pose.target));
      };

      viewRef.current = {
        moveTo,
        focus,
        home: () => ({ ...homePose, distance: homePose.position.distanceTo(homePose.target) }),
        state: () => ({
          position: camera.position.toArray() as [number, number, number],
          target: controls.target.toArray() as [number, number, number],
          distance: camera.position.distanceTo(controls.target),
        }),
      };

      const panBy = (dx: number, dy: number) => {
        const height = container.clientHeight;
        if (height < 1) return;
        tween = null;
        camera.updateMatrixWorld();
        panOffset.subVectors(camera.position, controls.target);
        const targetDistance =
          panOffset.length() * Math.tan((camera.fov * Math.PI) / 360);
        const panX = (2 * dx * targetDistance) / height;
        const panY = (2 * dy * targetDistance) / height;
        panRight.setFromMatrixColumn(camera.matrixWorld, 0);
        panUp.setFromMatrixColumn(camera.matrixWorld, 1);
        panMove.set(0, 0, 0).addScaledVector(panRight, -panX).addScaledVector(panUp, panY);
        camera.position.add(panMove);
        controls.target.add(panMove);
      };

      const zoomBy = (factor: number) => {
        if (!Number.isFinite(factor) || factor <= 0) return;
        tween = null;
        panOffset.subVectors(camera.position, controls.target);
        const distance = panOffset.length();
        if (distance < 1e-4) return;
        const next = Math.min(
          controls.maxDistance,
          Math.max(controls.minDistance, distance / factor),
        );
        panOffset.setLength(next);
        camera.position.copy(controls.target).add(panOffset);
      };

      modelControlRef.current = { panBy, zoomBy };

      scene.add(new THREE.AmbientLight(0x8088a0, 1.2));
      const key = new THREE.DirectionalLight(0xffeedd, 1.5);
      key.position.set(10, 20, 15);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0x9999dd, 0.8);
      fill.position.set(-10, 10, -10);
      scene.add(fill);

      let disposed = false;
      let frameId = 0;

      const resize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w < 1 || h < 1) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      buildBody((pct: number) => {
        if (pct < 100) return;
      })
        .then((result) => {
          if (disposed) return;
          scene.add(result.bodyGroup);
          muscleMeshesRef.current = result.muscleMeshes as Mesh[];
          result.skeletonGroup.visible = true;

          const box = new THREE.Box3().setFromObject(result.bodyGroup);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z);
          const fov = camera.fov * (Math.PI / 180);
          let cameraZ = maxDim / 2 / Math.tan(fov / 2);
          cameraZ *= 1.35;
          camera.position.set(center.x, center.y, center.z + cameraZ);
          controls.target.copy(center);
          homePose = { position: camera.position.clone(), target: controls.target.clone() };
          fitZoomLimits(camera.position.distanceTo(controls.target));
          controls.update();
          loaded = true;

          if (highlightRef.current.length > 0) {
            applyMuscleHighlights(muscleMeshesRef.current, highlightRef.current, {
              isolate: isolateRef.current,
            });
          }
          rebuildAnchors(markersRef.current);
          if (focusRef.current.length > 0) focus(focusRef.current);
        })
        .catch((err) => console.error('BodyExplorer load failed:', err));

      const placeMarkers = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.updateMatrixWorld();
        for (const [number, el] of markerElements.current) {
          const anchor = markerAnchors.current.get(number);
          // A marker follows its muscle: hidden while the muscle is hidden (another one is
          // isolated) or off screen.
          const shown = anchor?.meshes.some((mesh) => mesh.visible) ?? false;
          const point = anchor && shown ? projectToContainer(anchor.center, camera, w, h) : null;
          if (!point || !point.visible) {
            el.hidden = true;
            continue;
          }
          el.hidden = false;
          el.style.transform = `translate(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px) translate(-50%, -50%)`;
        }
      };

      const animate = () => {
        frameId = requestAnimationFrame(animate);
        if (tween) {
          const t = Math.min(1, (performance.now() - tween.start) / tween.duration);
          applyPose(lerpPose(tween.from, tween.to, easeOutCubic(t)));
          if (t >= 1) tween = null;
        }
        controls.update();
        renderer.render(scene, camera);
        placeMarkers();
      };
      animate();

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        canvasHost.removeChild(renderer.domElement);
        muscleMeshesRef.current = [];
        markerAnchors.current = new Map();
        modelControlRef.current = null;
        viewRef.current = null;
      };
      // Mount once — highlight, marker and focus updates happen in the effects below.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      if (!handControl) return;
      const control = modelControlRef.current;
      if (!control) return;
      return registerMirrorModelControl(control);
    }, [handControl]);

    useEffect(() => {
      if (muscleMeshesRef.current.length === 0) return;
      clearMuscleHighlights(muscleMeshesRef.current);
      if (highlightMeshNames.length > 0) {
        applyMuscleHighlights(muscleMeshesRef.current, highlightMeshNames, {
          isolate: isolateSelected,
        });
      }
    }, [highlightMeshNames, isolateSelected]);

    useEffect(() => {
      if (muscleMeshesRef.current.length === 0) return;
      rebuildAnchors(markers);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [markers]);

    const focusKey = focusMeshNames.join('|');
    const focusedOnce = useRef(false);
    useEffect(() => {
      // The first render with nothing to focus is the initial full-body view, not a "zoom out".
      if (focusMeshNames.length === 0 && !focusedOnce.current) return;
      focusedOnce.current = true;
      viewRef.current?.focus(focusMeshNames);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusKey]);

    const gestureTarget = handControl ? { [MIRROR_GESTURE_TARGET_ATTR]: 'true' } : {};

    return (
      <div
        ref={containerRef}
        className={className ?? 'body-explorer-canvas'}
        {...(handControl ? { [MIRROR_MODEL_ATTR]: 'true' } : {})}
      >
        <div ref={canvasHostRef} className="absolute inset-0" />
        {markers.map((marker) => {
          const selected = selectedMarkerIndex === marker.index;
          return (
            <button
              key={marker.number}
              ref={(el) => {
                if (el) markerElements.current.set(marker.number, el);
                else markerElements.current.delete(marker.number);
              }}
              type="button"
              hidden
              data-testid={`muscle-marker-${marker.number}`}
              aria-label={`${marker.number}: ${marker.label}`}
              aria-pressed={selected}
              title={marker.label}
              {...gestureTarget}
              className={cn(
                'absolute top-0 left-0 z-10 flex items-center justify-center rounded-full border-2 border-white bg-primary font-semibold text-primary-foreground shadow-md transition-[background-color,box-shadow] duration-150 ease-out hover:bg-primary-hover motion-reduce:transition-none',
                handControl ? 'size-11 text-base' : 'size-7 text-xs',
                selected && 'bg-emerald-400 text-black ring-4 ring-emerald-300/60 hover:bg-emerald-300',
              )}
              onClick={() => onMarkerSelect?.(marker.index)}
            >
              {marker.number}
            </button>
          );
        })}
        <ViewerResetButton onReset={resetView} handControl={handControl} />
      </div>
    );
  },
);
