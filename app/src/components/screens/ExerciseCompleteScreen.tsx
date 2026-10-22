import { useWorkflow } from '../../workflow/WorkflowContext';
import { formatSessionDuration } from '../../exercise/sessionState';
import { Button } from '../ui/button';

export function ExerciseCompleteScreen() {
  const { state, dispatch } = useWorkflow();
  const stats = state.exerciseSessionStats;
  const totalExercises = state.exercises?.length ?? 0;
  const duration = stats
    ? formatSessionDuration(stats.startedAt, stats.completedAt)
    : null;

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center p-8 text-center">
      <p className="text-xl uppercase tracking-[0.35em] text-primary">Session complete</p>
      <h1 className="mt-6 text-5xl font-semibold lg:text-6xl">Great work!</h1>

      <div className="mt-12 w-full max-w-xl space-y-4 rounded-3xl border border-white/10 bg-card/40 p-8 text-left text-2xl">
        {totalExercises > 0 ? (
          <p>
            <span className="text-muted-foreground">Exercises completed:</span>{' '}
            {stats?.exercisesCompleted ?? totalExercises}
          </p>
        ) : null}
        {stats && stats.setsCompleted > 0 ? (
          <p>
            <span className="text-muted-foreground">Sets completed:</span> {stats.setsCompleted}
          </p>
        ) : null}
        {stats && stats.totalReps > 0 ? (
          <p>
            <span className="text-muted-foreground">Total reps:</span> {stats.totalReps}
          </p>
        ) : null}
        {duration ? (
          <p>
            <span className="text-muted-foreground">Session duration:</span> {duration}
          </p>
        ) : null}
      </div>

      <div className="mt-12 flex w-full max-w-xl flex-col gap-3 sm:flex-row">
        <Button
          type="button"
          size="lg"
          className="min-h-16 flex-1 text-lg"
          onClick={() =>
            dispatch({
              type: 'SET_STAGE',
              stage: state.exerciseReturnStage === 'patient_detail' ? 'patient_detail' : 'results',
            })
          }
        >
          {state.exerciseReturnStage === 'patient_detail' ? 'Back to patient' : 'Back to results'}
        </Button>
        <Button
          type="button"
          size="lg"
          variant="secondary"
          className="min-h-16 flex-1 text-lg"
          onClick={() => dispatch({ type: 'SET_STAGE', stage: 'dashboard' })}
        >
          Dashboard
        </Button>
      </div>
    </div>
  );
}
