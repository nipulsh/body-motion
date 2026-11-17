import { AppShell } from './components/layout/AppShell';
import { BalanceBirdGameScreen } from './components/screens/BalanceBirdGameScreen';
import { BowlingGameScreen } from './components/screens/BowlingGameScreen';
import { ErrorScreen } from './components/screens/ErrorScreen';
import { ExerciseScreen } from './components/screens/ExerciseScreen';
import { GamesPlaceholderScreen } from './components/screens/GamesPlaceholderScreen';
import { MirrorRehabScreen } from './components/screens/MirrorRehabScreen';
import { SmartMirrorAnalysisScreen } from './components/screens/SmartMirrorAnalysisScreen';
import { SmartMirrorExercisePlanScreen } from './components/screens/SmartMirrorExercisePlanScreen';
import { SmartMirrorHomeScreen } from './components/screens/SmartMirrorHomeScreen';
import { SmartMirrorProcessingScreen } from './components/screens/SmartMirrorProcessingScreen';
import { SmartMirrorResultsScreen } from './components/screens/SmartMirrorResultsScreen';
import { SmartMirrorUploadingScreen } from './components/screens/SmartMirrorUploadingScreen';
import { useJobPolling } from './hooks/useJobPolling';
import { useWorkflow } from './workflow/WorkflowContext';

const SETTLED_JOB = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

/** Keeps a submitted analysis updating after the patient leaves the progress page. */
function MirrorJobPolling() {
  const { state } = useWorkflow();
  const settled = state.jobStatus ? SETTLED_JOB.has(state.jobStatus.status) : false;
  useJobPolling(Boolean(state.jobId) && !settled);
  return null;
}

function StageRouter() {
  const { state } = useWorkflow();

  switch (state.stage) {
    case 'mirror_home':
      return <SmartMirrorHomeScreen />;
    case 'mirror_analysis':
      return <SmartMirrorAnalysisScreen />;
    case 'mirror_uploading':
      return <SmartMirrorUploadingScreen />;
    case 'mirror_processing':
      return <SmartMirrorProcessingScreen />;
    case 'mirror_results':
      return <SmartMirrorResultsScreen />;
    case 'mirror_exercise_plan':
      return <SmartMirrorExercisePlanScreen />;
    case 'mirror_exercise_session':
      return <ExerciseScreen variant="mirror" />;
    case 'games_placeholder':
      return <GamesPlaceholderScreen />;
    case 'balance_bird_game':
      return <BalanceBirdGameScreen />;
    case 'bowling_game':
      return <BowlingGameScreen />;
    case 'rehab_games':
      return <MirrorRehabScreen />;
    case 'error':
      return <ErrorScreen />;
    default:
      return <SmartMirrorHomeScreen />;
  }
}

export default function App() {
  return (
    <AppShell>
      <MirrorJobPolling />
      <StageRouter />
    </AppShell>
  );
}
