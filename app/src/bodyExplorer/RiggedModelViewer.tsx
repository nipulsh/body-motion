import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

interface RiggedModelViewerProps {
  glbUrl: string | null;
  className?: string;
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

export function RiggedModelViewer({ glbUrl, className }: RiggedModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !glbUrl) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 1.4, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 1, 0);
    controls.enableDamping = true;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1);
    dir.position.set(2, 4, 3);
    scene.add(dir);

    let frameId = 0;
    let modelRoot: THREE.Object3D | null = null;
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
      },
      undefined,
      (err) => console.error('Rigged GLB load error:', err),
    );

    const animate = () => {
      frameId = requestAnimationFrame(animate);
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
      container.removeChild(renderer.domElement);
    };
  }, [glbUrl]);

  if (!glbUrl) {
    return (
      <div className={className ?? 'rigged-placeholder'}>
        <p>Personalized 3D model will appear when rigging completes.</p>
      </div>
    );
  }

  return <div ref={containerRef} className={className ?? 'rigged-canvas'} />;
}
