import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MUSCLE_GROUPS, getMuscleInfo, classifyMuscleGroup } from './muscleData.js';

/**
 * Loads both the BodyParts3D anatomy GLB (muscles/tendons) and skeleton GLB (bones).
 * Returns a Promise that resolves to { bodyGroup, muscleMeshes[], skeletonGroup }
 *
 * The GLBs contain named meshes from MRI-based data.
 * Coordinate transform: BP3D uses X=left-right, Y=front-back, Z=bottom-top (mm).
 * We remap to Three.js: X=left-right, Y=up, Z=front (scene units ~30 tall).
 *
 * Performance optimizations:
 * - Uses MeshStandardMaterial instead of MeshPhysicalMaterial (cheaper)
 * - Shares one material instance per muscle group (not cloned per mesh)
 * - Highlighting uses temporary material swap instead of mutating shared material
 */

// ───────────── Shared Materials (created once) ─────────────

// One material per muscle group — shared across all meshes in the group
const groupMaterials = {};
for (const [key, group] of Object.entries(MUSCLE_GROUPS)) {
  groupMaterials[key] = new THREE.MeshStandardMaterial({
    color: new THREE.Color(group.color),
    roughness: 0.55,
    metalness: 0.0,
    side: THREE.DoubleSide,
    flatShading: false,
  });
}

// Tendon material — shared by all tendons
const tendonMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0.92, 0.88, 0.78),
  roughness: 0.45,
  metalness: 0.0,
  side: THREE.DoubleSide,
  flatShading: false,
});

// Default muscle material for unclassified muscles
const defaultMuscleMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0.7, 0.18, 0.14),
  roughness: 0.6,
  metalness: 0.0,
  side: THREE.DoubleSide,
  flatShading: false,
});

// Bone material — semi-transparent off-white, shared by all bones
export const boneMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0.95, 0.92, 0.85),
  roughness: 0.6,
  metalness: 0.0,
  side: THREE.DoubleSide,
  transparent: true,
  opacity: 0.6,
  flatShading: false,
  depthWrite: false, // avoids z-fighting artifacts with transparent bones
});

// Highlight material — used temporarily when hovering/selecting
export const highlightMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(1.0, 0.6, 0.4),
  roughness: 0.4,
  metalness: 0.0,
  emissive: new THREE.Color(0.3, 0.1, 0.05),
  side: THREE.DoubleSide,
  flatShading: false,
});

// Selected material — brighter highlight
export const selectedMaterial = new THREE.MeshStandardMaterial({
  color: new THREE.Color(1.0, 0.75, 0.55),
  roughness: 0.35,
  metalness: 0.0,
  emissive: new THREE.Color(0.4, 0.15, 0.05),
  side: THREE.DoubleSide,
  flatShading: false,
});

// ───────────── Coordinate Transform ─────────────

/**
 * Apply BP3D-to-Three.js coordinate transform to a geometry in place.
 * BP3D: X=left-right, Y=front-back, Z=bottom-top (mm)
 * Three.js: X=left-right, Y=up, Z=front
 *
 * @param {THREE.BufferGeometry} geometry - Geometry to transform
 * @param {THREE.Vector3} center - Center of the source bounding box
 * @param {number} scaleFactor - mm-to-scene-units scale
 */
const _bp3dMatrix = new THREE.Matrix4();

function transformGeometry(geometry, center, scaleFactor) {
  // (x, y, z) mm → ((x-cx)*s, (z-cz)*s, -(y-cy)*s) scene units
  _bp3dMatrix.set(
    scaleFactor, 0, 0, -center.x * scaleFactor,
    0, 0, scaleFactor, -center.z * scaleFactor,
    0, -scaleFactor, 0, center.y * scaleFactor,
    0, 0, 0, 1
  );
  geometry.applyMatrix4(_bp3dMatrix);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

function yieldToMain() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ───────────── Main Loader ─────────────

export async function buildBody(onProgress) {
  const loader = new GLTFLoader();
  const bodyGroup = new THREE.Group();
  const muscleMeshes = [];
  const skeletonGroup = new THREE.Group();
  skeletonGroup.visible = true;
  bodyGroup.add(skeletonGroup);

  console.log('Loading anatomy models...');

  const base = '/raw_models/';
  let anatomyPct = 0;
  let skeletonPct = 0;
  const reportDownload = () => {
    if (onProgress) onProgress(Math.round(anatomyPct * 0.7 + skeletonPct * 0.3));
  };

  const mappingPromise = fetch(`${base}mesh_mapping.json`)
    .then((res) => {
      if (!res.ok) throw new Error(`Failed to load mesh_mapping.json (${res.status})`);
      return res.json();
    })
    .catch(() => []);

  const [anatomyGLTF, skeletonGLTF, meshMapping] = await Promise.all([
    loadGLB(loader, `${base}anatomy.glb`, (pct) => {
      anatomyPct = pct;
      reportDownload();
    }),
    loadGLB(loader, `${base}skeleton.glb`, (pct) => {
      skeletonPct = pct;
      reportDownload();
    }),
    mappingPromise,
  ]);

  const zaMeshNames = new Set();
  for (const entry of meshMapping) {
    if (entry.source === 'z-anatomy') {
      zaMeshNames.add(entry.name.replace(/\s+/g, '_'));
    }
  }
  console.log(`Mesh mapping: ${zaMeshNames.size} Z-Anatomy meshes identified`);

  const anatomyRoot = anatomyGLTF.scene;
  const anatomyBox = new THREE.Box3().setFromObject(anatomyRoot);
  const anatomyCenter = anatomyBox.getCenter(new THREE.Vector3());
  const anatomySize = anatomyBox.getSize(new THREE.Vector3());

  const targetHeight = 30;
  const scaleFactor = targetHeight / anatomySize.z;

  const anatomyMeshes = [];
  anatomyRoot.traverse((child) => {
    if (child.isMesh) anatomyMeshes.push(child);
  });

  for (let i = 0; i < anatomyMeshes.length; i++) {
    const child = anatomyMeshes[i];
    const name = child.name || `mesh_${i}`;
    const nameLower = name.toLowerCase();

    const isTendon = nameLower.includes('tendon') ||
      nameLower.includes('ligament') ||
      nameLower.includes('retinaculum') ||
      nameLower.includes('membrane') ||
      nameLower.includes('plantar ligament');

    const group = classifyMuscleGroup(name);
    const info = getMuscleInfo(name);

    const geometry = child.geometry;
    if (!geometry.userData._bp3dTransformed) {
      transformGeometry(geometry, anatomyCenter, scaleFactor);
      geometry.userData._bp3dTransformed = true;
    }

    let material;
    if (isTendon) {
      material = tendonMaterial;
    } else if (group && groupMaterials[group]) {
      material = groupMaterials[group];
    } else {
      material = defaultMuscleMaterial;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.renderOrder = 1;

    mesh.userData.displayName = formatMuscleName(name);
    mesh.userData.originalMaterial = material;
    mesh.userData.muscleData = {
      name: formatMuscleName(name),
      rawName: name,
      group: group || 'OTHER',
      type: isTendon ? 'tendon' : 'muscle',
      info: info,
    };
    mesh.userData.side = determineSide(name);
    mesh.userData.isZAnatomy = zaMeshNames.has(name);

    muscleMeshes.push(mesh);
    bodyGroup.add(mesh);

    if (i % 20 === 0 && onProgress) {
      onProgress(100, `Preparing muscles... ${i + 1}/${anatomyMeshes.length}`);
      await yieldToMain();
    }
  }

  console.log(`Loaded ${anatomyMeshes.length} anatomical meshes (${muscleMeshes.filter(m => m.userData.muscleData.type === 'tendon').length} tendons)`);

  const skeletonRoot = skeletonGLTF.scene;
  const boneMeshes = [];
  skeletonRoot.traverse((child) => {
    if (child.isMesh) boneMeshes.push(child);
  });

  for (let i = 0; i < boneMeshes.length; i++) {
    const child = boneMeshes[i];
    const geometry = child.geometry;
    if (!geometry.userData._bp3dTransformed) {
      transformGeometry(geometry, anatomyCenter, scaleFactor);
      geometry.userData._bp3dTransformed = true;
    }

    const boneMesh = new THREE.Mesh(geometry, boneMaterial);
    boneMesh.castShadow = false;
    boneMesh.receiveShadow = false;
    boneMesh.renderOrder = 0;
    boneMesh.userData.displayName = formatMuscleName(child.name || `bone_${i}`);
    boneMesh.userData.isBone = true;

    skeletonGroup.add(boneMesh);

    if (i % 20 === 0 && onProgress) {
      onProgress(100, `Preparing skeleton... ${i + 1}/${boneMeshes.length}`);
      await yieldToMain();
    }
  }

  console.log(`Loaded ${boneMeshes.length} bone meshes`);

  bodyGroup.userData.scaleFactor = scaleFactor;

  return { bodyGroup, muscleMeshes, skeletonGroup };
}

/**
 * Load a GLB file and return a promise of the GLTF object.
 */
function loadGLB(loader, url, onProgress) {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve(gltf),
      (progress) => {
        if (progress.total > 0 && onProgress) {
          onProgress(Math.round((progress.loaded / progress.total) * 100));
        }
      },
      (error) => reject(new Error(`Failed to load ${url}: ${error?.message || error}`))
    );
  });
}

// ───────────── Helpers ─────────────

/**
 * Format raw BP3D mesh name into readable display name.
 * e.g. "abdominal part of left pectoralis major" -> "Left Pectoralis Major (Abdominal Part)"
 * e.g. "left gluteus maximus" -> "Left Gluteus Maximus"
 */
function formatMuscleName(name) {
  // Remove duplicate numbering like " (2)"
  let clean = name.replace(/\s*\(\d+\)\s*$/, '');

  // Replace underscores with spaces
  clean = clean.replace(/_/g, ' ');

  // Trim extra whitespace
  clean = clean.replace(/\s+/g, ' ').trim();

  // Reorganize "X part/head/belly of [left/right] Y" -> "[Left/Right] Y (X Part/Head/Belly)"
  const partMatch = clean.match(/^(.+?)\s+(part|head|belly)\s+of\s+(?:(left|right)\s+)?(.+)$/i);
  if (partMatch) {
    const qualifier = partMatch[1];
    const keyword = partMatch[2];
    const side = partMatch[3] || '';
    const muscle = partMatch[4];
    const sideStr = side ? titleWord(side) + ' ' : '';
    clean = `${sideStr}${muscle} (${qualifier} ${keyword})`;
  }

  // Title case, but keep small words lowercase in the middle
  const smallWords = new Set(['of', 'the', 'and', 'in', 'at', 'to', 'for', 'on', 'by', 'or']);
  const words = clean.split(' ');
  const titled = words.map((w, i) => {
    if (i > 0 && smallWords.has(w.toLowerCase())) {
      return w.toLowerCase();
    }
    return titleWord(w);
  });
  return titled.join(' ');
}

function titleWord(w) {
  if (!w) return w;
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

/**
 * Determine which side of the body a muscle is on.
 */
function determineSide(name) {
  const lower = name.toLowerCase();
  if (lower.includes('left')) return 'Left';
  if (lower.includes('right')) return 'Right';
  return 'Center';
}
