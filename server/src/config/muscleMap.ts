import muscleMapJson from './muscleMap.json';
import muscleFilesJson from './muscle_files.json';

export interface MuscleMapEntry {
  bodyExplorerId: string;
  bodyExplorerMeshNames: string[];
  side: string;
  group: string;
  fmaIds: string[];
}

export interface MuscleComponent {
  file: string;
  fma_id: string;
  bp_id: string;
  name: string;
}

export const muscleMap: Record<string, MuscleMapEntry> = muscleMapJson;
export const muscleComponents: MuscleComponent[] = muscleFilesJson as MuscleComponent[];

const catalogueNames = Object.keys(muscleMap);

const normalisedIndex = new Map<string, { entry: MuscleMapEntry; catalogueName: string }>();
for (const [name, entry] of Object.entries(muscleMap)) {
  normalisedIndex.set(normaliseMuscleName(name), { entry, catalogueName: name });
}

/** Mesh id (underscored) → catalogue entry that owns it. */
const meshIdIndex = new Map<string, { entry: MuscleMapEntry; catalogueName: string }>();
for (const [name, entry] of Object.entries(muscleMap)) {
  for (const mesh of entry.bodyExplorerMeshNames) {
    meshIdIndex.set(normaliseMeshId(mesh), { entry, catalogueName: name });
  }
}

/** Exact BodyParts3D component name → mesh id. */
const componentByNormalised = new Map<string, { name: string; meshId: string }>();
for (const component of muscleComponents) {
  const meshId = toMeshId(component.name);
  componentByNormalised.set(normaliseMuscleName(component.name), {
    name: component.name,
    meshId,
  });
}

export function normaliseMuscleName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\bmuscle\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normaliseMeshId(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
}

export function toMeshId(name: string): string {
  return name.replace(/\s+/g, '_');
}

export function listCatalogueMuscleNames(): string[] {
  return catalogueNames;
}

export interface ResolvedMuscle {
  catalogueName: string;
  bodyExplorerId: string;
  bodyExplorerMeshNames: string[];
  componentNames: string[];
}

function entryFromMeshIds(meshIds: string[], preferredName: string): ResolvedMuscle {
  const unique = [...new Set(meshIds.map(toMeshId))];
  return {
    catalogueName: preferredName,
    bodyExplorerId: unique.length === 1 ? (unique[0] ?? '') : '',
    bodyExplorerMeshNames: unique,
    componentNames: unique.map((id) => id.replace(/_/g, ' ')),
  };
}

/**
 * Resolve an AI-returned muscle name to BodyExplorer mesh ids using
 * muscleMap.json (clinical groupings) and muscle_files.json (component meshes).
 */
export function lookupMuscle(name: string): ResolvedMuscle | null {
  const normalised = normaliseMuscleName(name);
  if (!normalised) return null;

  const exactCatalogue = normalisedIndex.get(normalised);
  if (exactCatalogue) {
    return {
      catalogueName: exactCatalogue.catalogueName,
      bodyExplorerId: exactCatalogue.entry.bodyExplorerId,
      bodyExplorerMeshNames: exactCatalogue.entry.bodyExplorerMeshNames,
      componentNames: exactCatalogue.entry.bodyExplorerMeshNames.map((id) =>
        id.replace(/_/g, ' '),
      ),
    };
  }

  const exactComponent = componentByNormalised.get(normalised);
  if (exactComponent) {
    const owner = meshIdIndex.get(normaliseMeshId(exactComponent.meshId));
    if (owner) {
      return {
        catalogueName: exactComponent.name,
        bodyExplorerId: exactComponent.meshId,
        bodyExplorerMeshNames: [exactComponent.meshId],
        componentNames: [exactComponent.name],
      };
    }
    return entryFromMeshIds([exactComponent.meshId], exactComponent.name);
  }

  const asMesh = normaliseMeshId(name);
  const byMesh = meshIdIndex.get(asMesh);
  if (byMesh) {
    return {
      catalogueName: byMesh.catalogueName,
      bodyExplorerId: byMesh.entry.bodyExplorerId || asMesh,
      bodyExplorerMeshNames: byMesh.entry.bodyExplorerMeshNames,
      componentNames: byMesh.entry.bodyExplorerMeshNames.map((id) => id.replace(/_/g, ' ')),
    };
  }

  // Fuzzy: find catalogue entries whose normalised name is contained in / contains the query.
  let best: { score: number; resolved: ResolvedMuscle } | null = null;
  for (const [key, value] of normalisedIndex) {
    if (!key.includes(normalised) && !normalised.includes(key)) continue;
    const score = Math.min(key.length, normalised.length) / Math.max(key.length, normalised.length);
    if (!best || score > best.score) {
      best = {
        score,
        resolved: {
          catalogueName: value.catalogueName,
          bodyExplorerId: value.entry.bodyExplorerId,
          bodyExplorerMeshNames: value.entry.bodyExplorerMeshNames,
          componentNames: value.entry.bodyExplorerMeshNames.map((id) => id.replace(/_/g, ' ')),
        },
      };
    }
  }

  for (const [key, value] of componentByNormalised) {
    if (!key.includes(normalised) && !normalised.includes(key)) continue;
    const score =
      Math.min(key.length, normalised.length) / Math.max(key.length, normalised.length) + 0.05;
    if (!best || score > best.score) {
      best = {
        score,
        resolved: {
          catalogueName: value.name,
          bodyExplorerId: value.meshId,
          bodyExplorerMeshNames: [value.meshId],
          componentNames: [value.name],
        },
      };
    }
  }

  return best && best.score >= 0.45 ? best.resolved : null;
}
