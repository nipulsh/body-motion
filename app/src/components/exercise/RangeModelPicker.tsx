import { useState } from 'react';
import { MIRROR_GESTURE_TARGET_ATTR } from '@vision/hand/gestureTargets';
import { rangeModelsFor, type Exercise, type RangeModel } from '@vision';
import { cn } from '@/lib/utils';
import { modelAnglesPhrase, modelRangesLine, viewChoiceOptions } from '../../exercise/rangeModelSession';
import { PageHeader } from '../layout/PageHeader';
import {
  mirrorGestureButtonClass,
  mirrorGestureButtonGridClass,
  mirrorGestureMenuButtonClass,
} from '../smartMirror/mirrorGestureButton';
import { MirrorPortraitCard } from '../smartMirror/MirrorPortraitCard';
import { mirrorTopZoneClass } from '../smartMirror/mirrorTopZone';
import { Button } from '../ui/button';

export interface RangeModelPickerProps {
  exercise: Exercise;
  variant: 'clinical' | 'mirror';
  /** Front: the standard form check, no model. */
  onPickFront: () => void;
  /** Side: the model whose angle ranges each rep is judged against. */
  onPick: (model: RangeModel) => void;
  onExit: () => void;
}

const gestureTarget = { [MIRROR_GESTURE_TARGET_ATTR]: 'true' };

/**
 * Before a squat or lunge starts: front or side. Front runs the standard form check; side then
 * lists the models, each with its ranges, and only the picked model's angles are monitored.
 */
export function RangeModelPicker({ exercise, variant, onPickFront, onPick, onExit }: RangeModelPickerProps) {
  const [step, setStep] = useState<'view' | 'model'>('view');
  const formCheck = exercise.formCheck === 'lunge' ? 'lunge' : 'squat';
  const models = rangeModelsFor(formCheck);
  const options = viewChoiceOptions(formCheck);
  const choosingModel = step === 'model';
  const title = choosingModel ? `${exercise.name} side on: choose a type` : `${exercise.name}: front or side?`;
  const note = choosingModel
    ? `Stand side on to the camera. Only the ${modelAnglesPhrase(formCheck)} angles are checked against the type's ranges.`
    : 'Choose how you will stand to the camera.';
  const choose = (view: 'front' | 'side') => (view === 'front' ? onPickFront() : setStep('model'));

  if (variant === 'mirror') {
    return (
      <MirrorPortraitCard testId="mirror-range-model-card">
        <div className={cn('flex min-h-0 flex-col gap-6 p-6 sm:gap-8 sm:p-8', mirrorTopZoneClass)}>
          <div className="flex items-center justify-between gap-4">
            <p className="text-lg font-medium text-white">{title}</p>
            <div className="flex shrink-0 gap-3">
              {choosingModel ? (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="mirror-range-model-back"
                  {...gestureTarget}
                  className={cn(mirrorGestureButtonClass)}
                  onClick={() => setStep('view')}
                >
                  Back
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                data-testid="mirror-range-model-exit"
                {...gestureTarget}
                className={cn(mirrorGestureButtonClass)}
                onClick={onExit}
              >
                Exit
              </Button>
            </div>
          </div>
          <ul className={cn(mirrorGestureButtonGridClass, 'min-h-0 flex-1 overflow-y-auto pr-1')}>
            {choosingModel
              ? models.map((model) => (
                  <li key={model.id}>
                    <Button
                      type="button"
                      variant="outline"
                      data-testid={`mirror-range-model-${model.id}`}
                      {...gestureTarget}
                      className={cn(mirrorGestureMenuButtonClass, 'flex-col gap-1 whitespace-normal')}
                      onClick={() => onPick(model)}
                    >
                      <span>{model.label}</span>
                      <span className="text-sm font-normal tabular-nums text-neutral-600">{modelRangesLine(model)}</span>
                    </Button>
                  </li>
                ))
              : options.map((option) => (
                  <li key={option.view}>
                    <Button
                      type="button"
                      variant="outline"
                      data-testid={`mirror-range-view-${option.view}`}
                      {...gestureTarget}
                      className={cn(mirrorGestureMenuButtonClass, 'flex-col gap-1 whitespace-normal')}
                      onClick={() => choose(option.view)}
                    >
                      <span>{option.label}</span>
                      <span className="text-sm font-normal text-neutral-600">{option.detail}</span>
                    </Button>
                  </li>
                ))}
          </ul>
          <p className="text-center text-sm text-neutral-300">{note}</p>
        </div>
      </MirrorPortraitCard>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col p-8">
      <PageHeader title={title} description={note}>
        {choosingModel ? (
          <Button type="button" variant="ghost" data-testid="range-model-back" onClick={() => setStep('view')}>
            Back
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={onExit}>
          Exit
        </Button>
      </PageHeader>
      <ul className="grid gap-3 sm:grid-cols-2">
        {choosingModel
          ? models.map((model) => (
              <li key={model.id}>
                <Button
                  type="button"
                  variant="outline"
                  data-testid={`range-model-${model.id}`}
                  className="h-auto w-full flex-col items-start gap-1.5 whitespace-normal p-4 text-left"
                  onClick={() => onPick(model)}
                >
                  <span className="text-lg font-semibold">{model.label}</span>
                  <span className="text-sm text-muted-foreground">{model.summary}</span>
                  <span className="text-sm tabular-nums text-muted-foreground">{modelRangesLine(model)}</span>
                </Button>
              </li>
            ))
          : options.map((option) => (
              <li key={option.view}>
                <Button
                  type="button"
                  variant="outline"
                  data-testid={`range-view-${option.view}`}
                  className="h-auto w-full flex-col items-start gap-1.5 whitespace-normal p-4 text-left"
                  onClick={() => choose(option.view)}
                >
                  <span className="text-lg font-semibold">{option.label}</span>
                  <span className="text-sm text-muted-foreground">{option.detail}</span>
                </Button>
              </li>
            ))}
      </ul>
    </div>
  );
}
