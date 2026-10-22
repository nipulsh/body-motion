import * as THREE from 'three';
import type { Mesh } from 'three';
import { highlightMaterial, selectedMaterial } from './bodyBuilder.js';

function normalizeMeshKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

export function meshMatchesKeys(mesh: Mesh, keys: string[]): boolean {
  const raw = mesh.userData.muscleData?.rawName as string | undefined;
  if (!raw) return false;
  const normalized = normalizeMeshKey(raw);
  return keys.some((key) => {
    const k = normalizeMeshKey(key);
    return normalized === k || normalized.includes(k) || k.includes(normalized);
  });
}

function restoreMeshVisibility(mesh: Mesh): void {
  if (mesh.userData._analysisHidden) {
    delete mesh.userData._analysisHidden;
    mesh.visible = true;
  }
}

export function clearMuscleHighlights(muscleMeshes: Mesh[]): void {
  for (const mesh of muscleMeshes) {
    restoreMeshVisibility(mesh);
    if (mesh.userData._analysisHighlight) {
      delete mesh.userData._analysisHighlight;
      if (mesh.userData.originalMaterial) {
        mesh.material = mesh.userData.originalMaterial;
      }
    }
  }
}

/**
 * Highlight matching muscles. When `isolate` is true, hide every other muscle
 * mesh so surrounding anatomy does not occlude the selected components.
 */
export function applyMuscleHighlights(
  muscleMeshes: Mesh[],
  meshNames: string[],
  options: {
    intensityMaterial?: THREE.Material;
    isolate?: boolean;
  } = {},
): void {
  const intensityMaterial = options.intensityMaterial ?? selectedMaterial;
  const isolate = options.isolate ?? false;

  clearMuscleHighlights(muscleMeshes);

  if (meshNames.length === 0) return;

  for (const mesh of muscleMeshes) {
    const matched = meshMatchesKeys(mesh, meshNames);
    if (matched) {
      mesh.material = intensityMaterial;
      mesh.userData._analysisHighlight = true;
      mesh.visible = true;
      continue;
    }

    if (isolate && mesh.userData.muscleData?.type !== 'bone') {
      mesh.visible = false;
      mesh.userData._analysisHidden = true;
    }
  }
}

export function highlightMaterialForIntensity(intensity: number): THREE.Material {
  if (intensity >= 0.65) return selectedMaterial;
  return highlightMaterial;
}
