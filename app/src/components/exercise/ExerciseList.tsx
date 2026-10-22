import type { Exercise } from '@vision';
import { Play } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';

interface ExerciseListProps {
  exercises: Exercise[];
  onSelectExercise: (index: number) => void;
  showStartAll?: boolean;
  onStartAll?: () => void;
}

export function ExerciseList({
  exercises,
  onSelectExercise,
  showStartAll = false,
  onStartAll,
}: ExerciseListProps) {
  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {exercises.map((exercise, index) => (
          <li key={exercise.id}>
            <button
              type="button"
              className="w-full text-left transition-colors hover:opacity-90"
              onClick={() => onSelectExercise(index)}
            >
              <Card className="transition-colors hover:border-primary/40 hover:bg-accent/30">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <CardTitle className="flex items-center gap-2 text-lg">
                        <Play className="size-4 shrink-0 text-primary" aria-hidden />
                        {index + 1}. {exercise.name}
                      </CardTitle>
                      <CardDescription className="mt-1">{exercise.description}</CardDescription>
                    </div>
                    <Badge variant="secondary">{exercise.difficulty}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  {exercise.sets} sets · {exercise.recommendedReps} reps · {exercise.restSeconds}s rest
                </CardContent>
              </Card>
            </button>
          </li>
        ))}
      </ul>

      {showStartAll && onStartAll ? (
        <Button type="button" size="lg" className="min-h-14 w-full text-lg" onClick={onStartAll}>
          Start all exercises
        </Button>
      ) : null}
    </div>
  );
}
