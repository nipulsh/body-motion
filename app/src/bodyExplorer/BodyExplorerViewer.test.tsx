/**
 * @vitest-environment jsdom
 *
 * Integration: real three.js scene, camera, OrbitControls and highlight logic. Only WebGL
 * output (no GPU in jsdom) and the anatomy GLB download are replaced.
 */
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false };
    setPixelRatio() {}
    setSize() {}
    render() {}
    dispose() {}
  }
  return { ...actual, WebGLRenderer: FakeRenderer };
});

vi.mock('./bodyBuilder.js', async () => {
  const THREE = await vi.importActual<typeof import('three')>('three');
  const highlightMaterial = new THREE.MeshBasicMaterial();
  const selectedMaterial = new THREE.MeshBasicMaterial();
  const muscle = (rawName: string, x: number, y: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    mesh.position.set(x, y, 0);
    mesh.userData.muscleData = { rawName, type: 'muscle' };
    mesh.userData.originalMaterial = mesh.material;
    return mesh;
  };
  return {
    highlightMaterial,
    selectedMaterial,
    buildBody: async () => {
      const bodyGroup = new THREE.Group();
      const muscleMeshes = [muscle('left_deltoid', 3, 8), muscle('right_quadriceps', -2, -6), muscle('neck_muscle', 0, 10)];
      bodyGroup.add(...muscleMeshes);
      bodyGroup.updateMatrixWorld(true);
      return { bodyGroup, muscleMeshes, skeletonGroup: new THREE.Group() };
    },
  };
});

import { BodyExplorerViewer, type BodyExplorerHandle } from './BodyExplorerViewer';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const markers = [
  { index: 0, number: 1, label: 'Left Deltoid', meshNames: ['left_deltoid'] },
  { index: 2, number: 3, label: 'Right Quadriceps', meshNames: ['right_quadriceps'] },
];

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // Reduced motion makes camera moves instant, so assertions do not depend on frame timing.
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

async function renderViewer(props: Partial<React.ComponentProps<typeof BodyExplorerViewer>> = {}) {
  const ref = createRef<BodyExplorerHandle>();
  await act(async () => {
    root.render(<BodyExplorerViewer ref={ref} markers={markers} {...props} />);
  });
  // Let buildBody resolve and a few animation frames run.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 80));
  });
  return ref;
}

const markerButton = (n: number) => host.querySelector<HTMLButtonElement>(`[data-testid="muscle-marker-${n}"]`);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

describe('numbered muscle markers', () => {
  it('shows a numbered marker for each muscle and places it over the model', async () => {
    await renderViewer();
    expect(markerButton(1)?.textContent).toBe('1');
    expect(markerButton(3)?.textContent).toBe('3');
    expect(markerButton(2)).toBeNull();
    expect(markerButton(1)!.style.transform).toMatch(/translate\(/);
    expect(markerButton(1)!.hidden).toBe(false);
    // Deltoid sits higher on the body than the quadriceps, so its marker is higher on screen.
    const y = (n: number) => Number(/translate\([^,]+,\s*([-\d.]+)px/.exec(markerButton(n)!.style.transform)![1]);
    expect(y(1)).toBeLessThan(y(3));
  });

  it('has an accessible name with the number and muscle', async () => {
    await renderViewer();
    expect(markerButton(1)!.getAttribute('aria-label')).toBe('1: Left Deltoid');
  });

  it('reports the clicked marker', async () => {
    const onMarkerSelect = vi.fn();
    await renderViewer({ onMarkerSelect });
    act(() => markerButton(3)!.click());
    expect(onMarkerSelect).toHaveBeenCalledWith(2);
  });
});

describe('focusing one muscle', () => {
  it('zooms to the selected muscle and hides the other muscles and their markers', async () => {
    const ref = await renderViewer();
    const overview = ref.current!.getCameraState();
    await act(async () => {
      root.render(
        <BodyExplorerViewer ref={ref} markers={markers} highlightMeshNames={['left_deltoid']} isolateSelected focusMeshNames={['left_deltoid']} />,
      );
    });
    await settle();
    const focused = ref.current!.getCameraState();
    expect(focused.target[0]).toBeCloseTo(3, 1);
    expect(focused.target[1]).toBeCloseTo(8, 1);
    expect(focused.distance).toBeLessThan(overview.distance / 2);
    expect(markerButton(1)!.hidden).toBe(false);
    expect(markerButton(3)!.hidden).toBe(true);
  });
});

describe('reset view button', () => {
  it('returns the camera to the full-body view and tells the page to clear the selection', async () => {
    const onResetView = vi.fn();
    const ref = await renderViewer({ onResetView });
    const overview = ref.current!.getCameraState();
    await act(async () => {
      root.render(<BodyExplorerViewer ref={ref} markers={markers} focusMeshNames={['left_deltoid']} onResetView={onResetView} />);
    });
    await settle();
    expect(ref.current!.getCameraState().distance).toBeLessThan(overview.distance);

    const reset = host.querySelector<HTMLButtonElement>('[data-testid="viewer-reset"]')!;
    expect(reset.getAttribute('aria-label')).toBe('Reset view');
    act(() => reset.click());
    await settle();
    const after = ref.current!.getCameraState();
    expect(after.distance).toBeCloseTo(overview.distance, 3);
    after.target.forEach((v, i) => expect(v).toBeCloseTo(overview.target[i]!, 3));
    expect(onResetView).toHaveBeenCalledTimes(1);
  });

  it('marks the reset button and markers as hand-gesture targets on the mirror', async () => {
    await renderViewer({ handControl: true });
    expect(host.querySelector('[data-testid="viewer-reset"]')!.getAttribute('data-mirror-gesture-target')).toBe('true');
    expect(markerButton(1)!.getAttribute('data-mirror-gesture-target')).toBe('true');
  });
});
