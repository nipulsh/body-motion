import { ArrowRight } from 'lucide-react';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { GridPattern } from '../brand/GridPattern';
import { Logo } from '../brand/Logo';
import { Button } from '../ui/button';

export function WelcomeScreen() {
  const { dispatch } = useWorkflow();

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden p-8">
      <GridPattern />
      <div className="relative max-w-xl space-y-6 text-center">
        <div className="flex justify-center">
          <Logo />
        </div>
        <h1 className="text-4xl font-semibold tracking-tight text-balance">
          Clinical movement analysis
        </h1>
        <p className="text-base leading-relaxed text-muted-foreground text-pretty">
          Guided 360° capture, AI-assisted muscle mapping, and a personalized 3D visualization
          for every patient.
        </p>
        <Button
          type="button"
          size="lg"
          onClick={() => dispatch({ type: 'SET_STAGE', stage: 'dashboard' })}
        >
          Start
          <ArrowRight />
        </Button>
      </div>
    </div>
  );
}
