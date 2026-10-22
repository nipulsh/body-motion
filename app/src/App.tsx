import { AppShell } from './components/layout/AppShell';
import { BalanceBirdGameScreen } from './components/screens/BalanceBirdGameScreen';
import { ErrorScreen } from './components/screens/ErrorScreen';
import { ExerciseScreen } from './components/screens/ExerciseScreen';
import { SmartMirrorAnalysisScreen } from './components/screens/SmartMirrorAnalysisScreen';
import { SmartMirrorExercisePlanScreen } from './components/screens/SmartMirrorExercisePlanScreen';
import { SmartMirrorHomeScreen } from './components/screens/SmartMirrorHomeScreen';
import { SmartMirrorProcessingScreen } from './components/screens/SmartMirrorProcessingScreen';
import { SmartMirrorResultsScreen } from './components/screens/SmartMirrorResultsScreen';
import { SmartMirrorUploadingScreen } from './components/screens/SmartMirrorUploadingScreen';
import { useWorkflow } from './workflow/WorkflowContext';

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
    case 'balance_bird_game':
      return <BalanceBirdGameScreen />;
    case 'error':
      return <ErrorScreen />;
    default:
      return <SmartMirrorHomeScreen />;
  }
}

export default function App() {
  const { state } = useWorkflow();
  return (
    <AppShell rotate={state.stage !== 'mirror_exercise_session'}>
      <StageRouter />
    </AppShell>
  );
}
