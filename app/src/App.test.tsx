/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkflowStage } from './workflow/types';
import App from './App';

const workflow = vi.hoisted(() => ({ stage: 'mirror_home' as string }));

vi.mock('./workflow/WorkflowContext', () => ({
  useWorkflow: () => ({ state: { stage: workflow.stage, jobId: null, jobStatus: null }, dispatch: vi.fn() }),
}));
vi.mock('./hooks/useJobPolling', () => ({ useJobPolling: () => undefined }));
vi.mock('./hooks/useSmartMirrorWindow', () => ({ useSmartMirrorWindow: () => ({ phase: 'closed' }) }));
vi.mock('./components/smartMirror/SmartMirrorPublisher', () => ({ SmartMirrorPublisher: () => null }));
vi.mock('./components/smartMirror/MirrorHandNavigationLayer', () => ({
  MirrorHandNavigationLayer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MirrorHandStatusBanner: () => null,
}));

function stub(name: string) {
  return () => <p data-testid="screen">{name}</p>;
}
vi.mock('./components/screens/SmartMirrorHomeScreen', () => ({ SmartMirrorHomeScreen: stub('home') }));
vi.mock('./components/screens/SmartMirrorAnalysisScreen', () => ({ SmartMirrorAnalysisScreen: stub('analysis') }));
vi.mock('./components/screens/SmartMirrorUploadingScreen', () => ({ SmartMirrorUploadingScreen: stub('uploading') }));
vi.mock('./components/screens/SmartMirrorProcessingScreen', () => ({ SmartMirrorProcessingScreen: stub('processing') }));
vi.mock('./components/screens/SmartMirrorResultsScreen', () => ({ SmartMirrorResultsScreen: stub('results') }));
vi.mock('./components/screens/SmartMirrorExercisePlanScreen', () => ({ SmartMirrorExercisePlanScreen: stub('plan') }));
vi.mock('./components/screens/ExerciseScreen', () => ({ ExerciseScreen: stub('exercise') }));
vi.mock('./components/screens/GamesPlaceholderScreen', () => ({ GamesPlaceholderScreen: stub('games') }));
vi.mock('./components/screens/BalanceBirdGameScreen', () => ({ BalanceBirdGameScreen: stub('balance bird') }));
vi.mock('./components/screens/BowlingGameScreen', () => ({ BowlingGameScreen: stub('bowling') }));
vi.mock('./components/screens/MirrorRehabScreen', () => ({ MirrorRehabScreen: stub('rehab') }));
vi.mock('./components/screens/ErrorScreen', () => ({ ErrorScreen: stub('error') }));

const STAGES: Array<[WorkflowStage, string]> = [
  ['mirror_home', 'home'],
  ['mirror_analysis', 'analysis'],
  ['mirror_uploading', 'uploading'],
  ['mirror_processing', 'processing'],
  ['mirror_results', 'results'],
  ['mirror_exercise_plan', 'plan'],
  ['mirror_exercise_session', 'exercise'],
  ['games_placeholder', 'games'],
  ['balance_bird_game', 'balance bird'],
  ['bowling_game', 'bowling'],
  ['rehab_games', 'rehab'],
  ['error', 'error'],
];

describe('App: every page sits on the portrait stage like the analysis page', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it.each(STAGES)('%s renders rotated 90° left', (stage, screen) => {
    workflow.stage = stage;
    act(() => root.render(<App />));
    const kiosk = container.querySelector('[data-testid="kiosk-screen-rotate"]');
    expect(kiosk?.getAttribute('data-rotated')).toBe('true');
    expect(kiosk?.className).toBe('kiosk-screen-rotate');
    expect(kiosk?.querySelector('[data-testid="screen"]')?.textContent).toBe(screen);
  });

  it('stays rotated while moving between the menu, a game and the exercise session', () => {
    for (const stage of ['games_placeholder', 'bowling_game', 'mirror_exercise_session', 'mirror_home'] as const) {
      workflow.stage = stage;
      act(() => root.render(<App />));
      expect(container.querySelector('[data-testid="kiosk-screen-rotate"]')?.getAttribute('data-rotated')).toBe('true');
    }
  });
});
