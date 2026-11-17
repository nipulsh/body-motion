import { useMemo } from 'react';
import type { AnalysisResponse } from '../../api/types';
import { buildMuscleMarkers, muscleMeshNames, type MuscleMarker } from '../../bodyExplorer/viewerMath';

export interface AnalysisMuscleView {
  /** Meshes to colour: the selected muscle, or every listed muscle when none is selected. */
  highlightMeshes: string[];
  /** Hide the other muscles while one with meshes is selected. */
  isolateSelected: boolean;
  /** Meshes the camera zooms to; empty means the full-body view. */
  focusMeshNames: string[];
  /** Numbered markers matching the findings list. */
  markers: MuscleMarker[];
}

/** 3D anatomy state for an analysis results page (clinician and mirror share it). */
export function useAnalysisMuscleView(
  analysis: AnalysisResponse | null,
  selectedIndex: number | null,
): AnalysisMuscleView {
  const markers = useMemo(() => buildMuscleMarkers(analysis?.muscles ?? []), [analysis]);

  const allMeshes = useMemo(() => {
    const names = new Set<string>();
    for (const muscle of analysis?.muscles ?? []) {
      for (const name of muscleMeshNames(muscle)) names.add(name);
      if (muscle.bodyExplorerId) names.add(muscle.bodyExplorerId);
    }
    return [...names];
  }, [analysis]);

  const selectedMeshes = useMemo(() => {
    const muscle = selectedIndex === null ? undefined : analysis?.muscles[selectedIndex];
    return muscle ? muscleMeshNames(muscle) : [];
  }, [analysis, selectedIndex]);

  return {
    highlightMeshes: selectedMeshes.length > 0 ? selectedMeshes : allMeshes,
    isolateSelected: selectedMeshes.length > 0,
    focusMeshNames: selectedMeshes,
    markers,
  };
}
