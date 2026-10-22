import { useWorkflow } from '../../workflow/WorkflowContext';
import { ExerciseList } from '../exercise/ExerciseList';
import { PageHeader } from '../layout/PageHeader';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';

export function ExercisePlanScreen() {
  const { state, dispatch } = useWorkflow();
  const exercises = state.exercises ?? [];

  if (exercises.length === 0) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <PageHeader title="No exercises" description="No exercises are available for this session." />
        <Button type="button" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'results' })}>
          Back to results
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-8">
      <PageHeader
        title="Your exercise plan"
        description={`${exercises.length} personalized exercises based on your analysis.`}
      >
        <Button type="button" variant="ghost" onClick={() => dispatch({ type: 'SET_STAGE', stage: 'results' })}>
          Back
        </Button>
      </PageHeader>

      <ScrollArea className="mb-8 h-[50vh] pr-3">
        <ExerciseList
          exercises={exercises}
          onSelectExercise={(index) => {
            dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: 'exercise_plan' });
            dispatch({ type: 'SET_EXERCISE_INDEX', index });
            dispatch({ type: 'SET_STAGE', stage: 'exercise_session' });
          }}
          showStartAll
          onStartAll={() => {
            dispatch({ type: 'SET_EXERCISE_RETURN_STAGE', stage: 'exercise_plan' });
            dispatch({ type: 'SET_EXERCISE_INDEX', index: 0 });
            dispatch({ type: 'SET_STAGE', stage: 'exercise_session' });
          }}
        />
      </ScrollArea>
    </div>
  );
}
