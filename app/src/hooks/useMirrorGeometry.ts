import { useEffect, useState } from 'react';
import type { MirrorGeometry } from '@vision/pose/mirrorReflection';
import { loadMirrorGeometry, subscribeMirrorGeometry } from '../display/mirrorGeometrySettings';

/** Current mirror geometry, updated live when the on-site override changes. */
export function useMirrorGeometry(): MirrorGeometry {
  const [geometry, setGeometry] = useState(loadMirrorGeometry);
  useEffect(() => subscribeMirrorGeometry(setGeometry), []);
  return geometry;
}
