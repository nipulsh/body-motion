/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { MuscleContribution, MuscleModelNote } from './MuscleContribution';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: React.ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(node));
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('MuscleContribution', () => {
  it('shows the share of the deformity', () => {
    expect(render(<MuscleContribution percent={32.5} />).textContent).toContain('32.5% of deformity');
  });

  it('renders nothing without a share', () => {
    expect(render(<MuscleContribution percent={undefined} />).textContent).toBe('');
  });
});

describe('MuscleModelNote (#17)', () => {
  it('says when a muscle has no 3D mesh to highlight', () => {
    const el = render(<MuscleModelNote muscle={{ bodyExplorerId: undefined, bodyExplorerMeshNames: undefined }} />);
    expect(el.textContent).toMatch(/not shown on the 3D model/i);
  });

  it('stays quiet when the muscle can be highlighted', () => {
    const el = render(<MuscleModelNote muscle={{ bodyExplorerId: '', bodyExplorerMeshNames: ['left_deltoid'] }} />);
    expect(el.textContent).toBe('');
  });
});

describe('MeasurementConflictNotice (#8)', () => {
  it('shows the clinician-only note when present', async () => {
    const { MeasurementConflictNotice } = await import('./MuscleContribution');
    const el = render(<MeasurementConflictNotice conflict="The AI analysis did not account for a measured deviation: knee" />);
    expect(el.textContent).toMatch(/did not account for/);
    expect(el.querySelector('[role="note"]')).not.toBeNull();
  });

  it('renders nothing without a note', async () => {
    const { MeasurementConflictNotice } = await import('./MuscleContribution');
    expect(render(<MeasurementConflictNotice conflict={undefined} />).textContent).toBe('');
  });
});
