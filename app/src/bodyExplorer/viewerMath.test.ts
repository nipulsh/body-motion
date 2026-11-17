import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  buildMuscleMarkers,
  easeOutCubic,
  focusPose,
  lerpPose,
  muscleMeshNames,
  projectToContainer,
} from './viewerMath';

describe('muscleMeshNames', () => {
  it('prefers the mesh list, falls back to the single id, else none', () => {
    expect(muscleMeshNames({ bodyExplorerMeshNames: ['a', 'b'], bodyExplorerId: 'x' })).toEqual(['a', 'b']);
    expect(muscleMeshNames({ bodyExplorerId: 'x' })).toEqual(['x']);
    expect(muscleMeshNames({ bodyExplorerMeshNames: [], bodyExplorerId: '' })).toEqual([]);
    expect(muscleMeshNames({})).toEqual([]);
  });
});

describe('buildMuscleMarkers', () => {
  it('numbers markers to match the findings list and skips muscles with no 3D mesh', () => {
    const markers = buildMuscleMarkers([
      { name: 'Left Deltoid', bodyExplorerId: 'left_deltoid' },
      { name: 'Unknown', bodyExplorerMeshNames: [] },
      { name: 'Left Biceps', bodyExplorerMeshNames: ['long_head', 'short_head'] },
    ]);
    expect(markers).toEqual([
      { index: 0, number: 1, label: 'Left Deltoid', meshNames: ['left_deltoid'] },
      { index: 2, number: 3, label: 'Left Biceps', meshNames: ['long_head', 'short_head'] },
    ]);
  });
});

describe('focusPose', () => {
  const box = new THREE.Box3(new THREE.Vector3(1, 1, -0.5), new THREE.Vector3(3, 3, 0.5));

  it('targets the muscle centre and keeps the current viewing direction', () => {
    const pose = focusPose(box, new THREE.Vector3(0, 5, 35), new THREE.Vector3(0, 5, 0), 50, 1);
    expect(pose.target.toArray()).toEqual([2, 2, 0]);
    const dir = pose.position.clone().sub(pose.target).normalize();
    expect(dir.x).toBeCloseTo(0, 6);
    expect(dir.z).toBeCloseTo(1, 6);
  });

  it('fits the muscle in view with padding, closer than the full-body view', () => {
    const pose = focusPose(box, new THREE.Vector3(0, 5, 35), new THREE.Vector3(0, 5, 0), 50, 1);
    const distance = pose.position.distanceTo(pose.target);
    const halfFov = (50 * Math.PI) / 360;
    // The box (2 units tall) must fit inside the view height at that distance.
    expect(2 * distance * Math.tan(halfFov)).toBeGreaterThan(2);
    expect(distance).toBeLessThan(35);
  });

  it('fits narrow viewports by width', () => {
    const wide = focusPose(box, new THREE.Vector3(0, 0, 10), new THREE.Vector3(), 50, 2);
    const narrow = focusPose(box, new THREE.Vector3(0, 0, 10), new THREE.Vector3(), 50, 0.5);
    expect(narrow.position.distanceTo(narrow.target)).toBeGreaterThan(wide.position.distanceTo(wide.target));
  });

  it('never returns a degenerate pose for a tiny or flat muscle', () => {
    const flat = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 0));
    const pose = focusPose(flat, new THREE.Vector3(0, 0, 10), new THREE.Vector3(), 50, 1);
    expect(pose.position.distanceTo(pose.target)).toBeGreaterThan(0);
    expect(Number.isFinite(pose.position.x)).toBe(true);
  });
});

describe('camera animation', () => {
  it('eases out from 0 to 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(2)).toBe(1);
  });

  it('interpolates position and target together', () => {
    const from = { position: new THREE.Vector3(0, 0, 10), target: new THREE.Vector3(0, 0, 0) };
    const to = { position: new THREE.Vector3(2, 2, 4), target: new THREE.Vector3(2, 2, 0) };
    const mid = lerpPose(from, to, 0.5);
    expect(mid.position.toArray()).toEqual([1, 1, 7]);
    expect(mid.target.toArray()).toEqual([1, 1, 0]);
  });
});

describe('projectToContainer', () => {
  const camera = new THREE.PerspectiveCamera(50, 2, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();

  it('maps the point the camera looks at to the container centre', () => {
    const p = projectToContainer(new THREE.Vector3(0, 0, 0), camera, 400, 200);
    expect(p.visible).toBe(true);
    expect(p.x).toBeCloseTo(200, 6);
    expect(p.y).toBeCloseTo(100, 6);
  });

  it('puts higher points nearer the top', () => {
    expect(projectToContainer(new THREE.Vector3(0, 1, 0), camera, 400, 200).y).toBeLessThan(100);
  });

  it('hides points behind the camera or outside the view', () => {
    expect(projectToContainer(new THREE.Vector3(0, 0, 20), camera, 400, 200).visible).toBe(false);
    expect(projectToContainer(new THREE.Vector3(500, 0, 0), camera, 400, 200).visible).toBe(false);
  });
});
