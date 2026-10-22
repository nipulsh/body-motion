import { useEffect, useState } from 'react';
import { Dumbbell, Loader2 } from 'lucide-react';
import { Button } from '../ui/button';
import {
  demoVideoStatusOnError,
  demoVideoStatusOnLoad,
  demoVideoStatusOnUrlChange,
  initialDemoVideoStatus,
  isWebmDemoVideo,
  type ExerciseDemoVideoStatus,
} from '../../exercise/demoVideos';
import { cn } from '@/lib/utils';

export interface ExerciseDemoVideoProps {
  exerciseName: string;
  videoUrl?: string | null;
  description?: string;
  className?: string;
  generating?: boolean;
  generateError?: string | null;
  onRetryGenerate?: () => void;
}

function ExerciseDemoFallback({
  exerciseName,
  description,
  message,
  className,
}: {
  exerciseName: string;
  description?: string;
  message: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-black p-6 text-center',
        className,
      )}
      role="img"
      aria-label={`${exerciseName} demonstration placeholder`}
    >
      <Dumbbell className="mb-3 size-10 text-primary" aria-hidden />
      <p className="text-lg font-semibold">{exerciseName}</p>
      {description ? (
        <p className="mt-2 max-w-xs text-sm text-muted-foreground">{description}</p>
      ) : null}
      <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">{message}</p>
    </div>
  );
}

export function ExerciseDemoVideo({
  exerciseName,
  videoUrl,
  description,
  className,
  generating = false,
  generateError = null,
  onRetryGenerate,
}: ExerciseDemoVideoProps) {
  const [status, setStatus] = useState<ExerciseDemoVideoStatus>(() =>
    initialDemoVideoStatus(videoUrl),
  );

  useEffect(() => {
    setStatus(demoVideoStatusOnUrlChange(videoUrl));
  }, [videoUrl]);

  if (generating) {
    return (
      <div
        className={cn(
          'flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border border-white/20 bg-black p-6 text-center',
          className,
        )}
      >
        <Loader2 className="mb-3 size-10 animate-spin text-primary" aria-hidden />
        <p className="text-lg font-semibold">{exerciseName}</p>
        <p className="mt-3 max-w-xs text-sm text-muted-foreground">
          Generating 3D demonstration with Gemini… This can take one to two minutes.
        </p>
      </div>
    );
  }

  if (!videoUrl || status === 'missing') {
    return (
      <div className={cn('flex h-full min-h-[220px] flex-col', className)}>
        <ExerciseDemoFallback
          exerciseName={exerciseName}
          description={description}
          message={generateError ?? 'Demo video coming soon'}
          className="min-h-0 flex-1"
        />
        {generateError && onRetryGenerate ? (
          <Button type="button" className="mt-3 w-full" onClick={onRetryGenerate}>
            Retry video generation
          </Button>
        ) : null}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <ExerciseDemoFallback
        exerciseName={exerciseName}
        description={description}
        message="Demo video unavailable"
        className={className}
      />
    );
  }

  const useAlphaBackdrop = isWebmDemoVideo(videoUrl);

  return (
    <div
      className={cn(
        'relative flex h-full min-h-[220px] items-center justify-center overflow-hidden rounded-xl border',
        useAlphaBackdrop
          ? 'border-white/20 bg-black'
          : 'border-white/15 bg-black',
        className,
      )}
    >
      {status === 'loading' ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/40 backdrop-blur-[1px]">
          <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
          <span className="sr-only">Loading demonstration video for {exerciseName}</span>
        </div>
      ) : null}

      <video
        key={videoUrl}
        src={videoUrl}
        autoPlay
        loop
        muted
        playsInline
        controls={false}
        disablePictureInPicture
        aria-label={`Demonstration video for ${exerciseName}`}
        className={cn(
          'max-h-full w-full transition-opacity duration-300',
          useAlphaBackdrop ? 'object-contain' : 'object-contain p-4',
          status === 'ready' ? 'opacity-100' : 'opacity-0',
        )}
        onLoadedData={() => setStatus((current) => demoVideoStatusOnLoad(current))}
        onCanPlay={() => setStatus((current) => demoVideoStatusOnLoad(current))}
        onError={() => setStatus(demoVideoStatusOnError())}
      />
    </div>
  );
}
