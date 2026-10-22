import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import type { Mesh } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MIRROR_MODEL_ATTR } from '@vision/hand/gestureTargets';
import { buildBody } from './bodyBuilder.js';
import { applyMuscleHighlights, clearMuscleHighlights } from './highlights';
import { registerMirrorModelControl, type MirrorModelControl } from './mirrorModelControl';

export interface BodyExplorerHandle {
  highlightMeshes: (meshNames: string[], isolate?: boolean) => void;
  clearHighlights: () => void;
}

interface BodyExplorerViewerProps {
  highlightMeshNames?: string[];
  /** When true and meshes are selected, hide non-selected muscles. Default true. */
  isolateSelected?: boolean;
  /** Register pinch-drag pan and two-hand zoom for the mirror. */
  handControl?: boolean;
  className?: string;
}

export const BodyExplorerViewer = forwardRef<BodyExplorerHandle, BodyExplorerViewerProps>(
  function BodyExplorerViewer(
    { highlightMeshNames = [], isolateSelected = true, handControl = false, className },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const muscleMeshesRef = useRef<Mesh[]>([]);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const modelControlRef = useRef<MirrorModelControl | null>(null);
    const isolateRef = useRef(isolateSelected);
    isolateRef.current = isolateSelected;

    useImperativeHandle(ref, () => ({
      highlightMeshes(names: string[], isolate = isolateRef.current) {
        applyMuscleHighlights(muscleMeshesRef.current, names, { isolate });
      },
      clearHighlights() {
        clearMuscleHighlights(muscleMeshesRef.current);
      },
    }));

    useEffect(() => {
      const container = containerRef.current;
      if (!container) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a2332);

      const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
      camera.position.set(0, 5, 35);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.target.set(0, 5, 0);

      const panOffset = new THREE.Vector3();
      const panRight = new THREE.Vector3();
      const panUp = new THREE.Vector3();
      const panMove = new THREE.Vector3();

      const fitZoomLimits = (distance: number) => {
        controls.minDistance = Math.max(distance * 0.35, 0.25);
        controls.maxDistance = Math.max(distance * 3, controls.minDistance + 0.01);
      };
      fitZoomLimits(camera.position.distanceTo(controls.target));

      const panBy = (dx: number, dy: number) => {
        const height = container.clientHeight;
        if (height < 1) return;
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
          fitZoomLimits(camera.position.distanceTo(controls.target));
          controls.update();

          if (highlightMeshNames.length > 0) {
            applyMuscleHighlights(muscleMeshesRef.current, highlightMeshNames, {
              isolate: isolateRef.current,
            });
          }
        })
        .catch((err) => console.error('BodyExplorer load failed:', err));

      const animate = () => {
        frameId = requestAnimationFrame(animate);
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      return () => {
        disposed = true;
        cancelAnimationFrame(frameId);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        container.removeChild(renderer.domElement);
        muscleMeshesRef.current = [];
        modelControlRef.current = null;
      };
      // Mount once — highlight updates happen in the effect below.
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

    return (
      <div
        ref={containerRef}
        className={className ?? 'body-explorer-canvas'}
        {...(handControl ? { [MIRROR_MODEL_ATTR]: 'true' } : {})}
      />
    );
  },
);
