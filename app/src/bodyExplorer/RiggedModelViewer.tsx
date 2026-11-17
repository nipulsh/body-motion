import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { CameraState } from './BodyExplorerViewer';
import { ViewerResetButton } from './ViewerResetButton';
import { CAMERA_MOVE_MS, easeOutCubic, lerpPose, prefersReducedMotion, type CameraPose } from './viewerMath';

interface RiggedModelViewerProps {
  glbUrl: string | null;
  className?: string;
}

export interface RiggedModelViewerHandle {
  /** Animate back to the fitted starting view. */
  resetView: () => void;
  getCameraState: () => CameraState;
  /** Place the camera directly (as if the user had orbited/zoomed). */
  setCameraPose: (position: [number, number, number], target: [number, number, number]) => void;
}

function fitCameraToObject(
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  object: THREE.Object3D,
  offset = 1.35,
) {
  const box = new THREE.Box3().setFromObject(object);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 0.001);

  const fov = camera.fov * (Math.PI / 180);
  const fitHeight = maxDim / (2 * Math.tan(fov / 2));
  const fitWidth = fitHeight / Math.max(camera.aspect, 0.0001);
  const distance = offset * Math.max(fitHeight, fitWidth);

  const direction = new THREE.Vector3()
    .subVectors(camera.position, controls.target)
    .normalize();
  if (direction.lengthSq() < 1e-6) {
    direction.set(0, 0, 1);
  }

  controls.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();
  controls.update();
}

export const RiggedModelViewer = forwardRef<RiggedModelViewerHandle, RiggedModelViewerProps>(
  function RiggedModelViewer({ glbUrl, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasHostRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<RiggedModelViewerHandle | null>(null);

    useImperativeHandle(ref, () => ({
      resetView: () => viewRef.current?.resetView(),
      getCameraState: () =>
        viewRef.current?.getCameraState() ?? { position: [0, 0, 0], target: [0, 0, 0], distance: 0 },
      setCameraPose: (position, target) => viewRef.current?.setCameraPose(position, target),
    }));

    useEffect(() => {
      const container = containerRef.current;
      const canvasHost = canvasHostRef.current;
      if (!container || !canvasHost || !glbUrl) return;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x000000);

      const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 1.4, 2.8);

      const renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      canvasHost.appendChild(renderer.domElement);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 1, 0);
      controls.enableDamping = true;

      scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
      const dir = new THREE.DirectionalLight(0xffffff, 1);
      dir.position.set(2, 4, 3);
      scene.add(dir);

      let frameId = 0;
      let modelRoot: THREE.Object3D | null = null;
      /** Fitted starting view, refreshed whenever the model is re-framed. */
      let homePose: CameraPose = { position: camera.position.clone(), target: controls.target.clone() };
      let tween: { from: CameraPose; to: CameraPose; start: number } | null = null;
      controls.addEventListener('start', () => {
        tween = null;
      });
      const rememberHome = () => {
        homePose = { position: camera.position.clone(), target: controls.target.clone() };
      };
      const applyPose = (pose: CameraPose) => {
        camera.position.copy(pose.position);
        controls.target.copy(pose.target);
        camera.updateMatrixWorld();
      };

      viewRef.current = {
        resetView: () => {
          if (prefersReducedMotion()) {
            tween = null;
            applyPose(homePose);
            controls.update();
            return;
          }
          tween = {
            from: { position: camera.position.clone(), target: controls.target.clone() },
            to: homePose,
            start: performance.now(),
          };
        },
        getCameraState: () => ({
          position: camera.position.toArray() as [number, number, number],
          target: controls.target.toArray() as [number, number, number],
          distance: camera.position.distanceTo(controls.target),
        }),
        setCameraPose: (position, target) => {
          tween = null;
          applyPose({ position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) });
        },
      };
      let lastArea = 0;
      const loader = new GLTFLoader();

      const resize = () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        if (w < 1 || h < 1) return;

        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h, false);

        const area = w * h;
        // Re-frame when the panel roughly doubles/halves (e.g. fullscreen toggle).
        const areaChangedEnough =
          lastArea === 0 || area / lastArea > 1.6 || lastArea / area > 1.6;
        if (modelRoot && areaChangedEnough) {
          fitCameraToObject(camera, controls, modelRoot);
          rememberHome();
          lastArea = area;
        } else if (lastArea === 0) {
          lastArea = area;
        }
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(container);

      loader.load(
        glbUrl,
        (gltf) => {
          modelRoot = gltf.scene;
          scene.add(modelRoot);
          fitCameraToObject(camera, controls, modelRoot);
          rememberHome();
        },
        undefined,
        (err) => console.error('Rigged GLB load error:', err),
      );

      const animate = () => {
        frameId = requestAnimationFrame(animate);
        if (tween) {
          const t = Math.min(1, (performance.now() - tween.start) / CAMERA_MOVE_MS);
          applyPose(lerpPose(tween.from, tween.to, easeOutCubic(t)));
          if (t >= 1) tween = null;
        }
        controls.update();
        renderer.render(scene, camera);
      };
      animate();

      return () => {
        cancelAnimationFrame(frameId);
        ro.disconnect();
        if (modelRoot) scene.remove(modelRoot);
        controls.dispose();
        renderer.dispose();
        canvasHost.removeChild(renderer.domElement);
        viewRef.current = null;
      };
    }, [glbUrl]);

    if (!glbUrl) {
      return (
        <div className={className ?? 'rigged-placeholder'}>
          <p>Personalized 3D model will appear when rigging completes.</p>
        </div>
      );
    }

    return (
      <div ref={containerRef} className={className ?? 'rigged-canvas'}>
        <div ref={canvasHostRef} className="absolute inset-0" />
        <ViewerResetButton onReset={() => viewRef.current?.resetView()} />
      </div>
    );
  },
);
