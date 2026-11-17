/**
 * @vitest-environment jsdom
 *
 * Integration: real three.js camera and OrbitControls; WebGL output and the GLB download are faked.
 */
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('three/addons/loaders/GLTFLoader.js', async () => {
  const THREE = await vi.importActual<typeof import('three')>('three');
  return {
    GLTFLoader: class {
      load(_url: string, onLoad: (gltf: { scene: import('three').Object3D }) => void) {
        const scene = new THREE.Group();
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.8, 0.3)));
        setTimeout(() => onLoad({ scene }), 0);
      }
    },
  };
});

import { RiggedModelViewer, type RiggedModelViewerHandle } from './RiggedModelViewer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 400 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('RiggedModelViewer reset button', () => {
  it('puts the model back in its fitted starting view after the user moves it', async () => {
    const ref = createRef<RiggedModelViewerHandle>();
    await act(async () => {
      root.render(<RiggedModelViewer ref={ref} glbUrl="model.glb" />);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const home = ref.current!.getCameraState();

    // Simulate the user orbiting/zooming away.
    ref.current!.setCameraPose([4, 3, 1], [0.5, 0.2, 0]);
    expect(ref.current!.getCameraState().position).not.toEqual(home.position);

    const reset = host.querySelector<HTMLButtonElement>('[data-testid="viewer-reset"]')!;
    expect(reset.getAttribute('aria-label')).toBe('Reset view');
    act(() => reset.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    const after = ref.current!.getCameraState();
    after.position.forEach((v, i) => expect(v).toBeCloseTo(home.position[i]!, 3));
    after.target.forEach((v, i) => expect(v).toBeCloseTo(home.target[i]!, 3));
  });

  it('has no reset button before a model exists', async () => {
    await act(async () => {
      root.render(<RiggedModelViewer glbUrl={null} />);
    });
    expect(host.querySelector('[data-testid="viewer-reset"]')).toBeNull();
  });
});
