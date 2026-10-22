import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import { generateExercises } from '../../api/exercises';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { PageHeader } from '../layout/PageHeader';
import { Card, CardContent } from '../ui/card';
import { Progress } from '../ui/progress';

export function ExerciseLoadingScreen() {
  const { state, dispatch } = useWorkflow();
  const [progress, setProgress] = useState(12);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(value + 8, 92));
    }, 350);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!state.jobId) {
      dispatch({
        type: 'SET_ERROR',
        error: {
          title: 'Exercises unavailable',
          message: 'No analysis job is linked to this session.',
          retryStage: 'results',
        },
      });
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const { exercises } = await generateExercises(state.jobId!);
        if (cancelled) return;
        dispatch({ type: 'SET_EXERCISES', exercises });
        dispatch({ type: 'SET_STAGE', stage: 'exercise_plan' });
      } catch (err) {
        if (cancelled) return;
        if (import.meta.env.DEV) {
          console.error('[ExerciseLoading] failed to load exercise plan');
          if (err instanceof ApiError) {
            console.error('[ExerciseLoading] status:', err.status);
            console.error('[ExerciseLoading] code:', err.code);
            console.error('[ExerciseLoading] message:', err.message);
            if (err.details !== undefined) {
              console.error('[ExerciseLoading] details:', err.details);
            }
          } else if (err instanceof Error) {
            console.error('[ExerciseLoading] error:', err.message);
          } else {
            console.error('[ExerciseLoading] error:', err);
          }
        }
        dispatch({
          type: 'SET_ERROR',
          error: {
            title: 'Exercise plan unavailable',
            message: "We couldn't load your exercise plan. Please try again.",
            retryStage: 'results',
          },
        });
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [dispatch, state.jobId]);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl flex-col justify-center p-8">
      <PageHeader
        title="Preparing your exercises"
        description="Generating a personalized plan from your analysis."
      />
      <Card>
        <CardContent className="space-y-4 py-8">
          <Progress value={progress} />
          <p className="text-center text-sm text-muted-foreground">This may take a moment…</p>
        </CardContent>
      </Card>
    </div>
  );
}
