import type { SessionEnd } from '../../games/rehab/core/engine';
import { RehabButton, Stars } from './rehabUi';

interface RehabResultProps {
  end: SessionEnd;
  hasNext: boolean;
  hasEasier: boolean;
  onNext: () => void;
  onEasier: () => void;
  onRepeat: () => void;
  onLevels: () => void;
  onExit: () => void;
}

/** Stars, score, a few key numbers, then Next level / Repeat / Levels / Exit. */
export function RehabResult({ end, hasNext, hasEasier, onNext, onEasier, onRepeat, onLevels, onExit }: RehabResultProps) {
  const { result } = end;
  const hurt = end.endedBy === 'hurts';
  return (
    <div className="rehab-result" data-testid="rehab-result">
      <p className="rehab-muted rehab-small">
        {end.module.name} · Level {end.level.number} {end.level.name}
      </p>
      {hurt ? (
        <p style={{ color: 'var(--rh-caution)' }}>Stopped. Rest, and try an easier level next time.</p>
      ) : (
        <Stars count={result.stars} className="rehab-result-stars" />
      )}
      <div className="rehab-result-score" data-testid="rehab-result-score">
        {result.score}
      </div>
      {result.numbers.length ? (
        <dl className="rehab-numbers">
          {result.numbers.map((n) => (
            <div key={n.label}>
              <dt className="rehab-small rehab-muted">{n.label}</dt>
              <dd className="rehab-number-value">{n.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <div className="rehab-actions">
        {hurt ? (
          <RehabButton primary disabled={!hasEasier} onClick={onEasier}>
            Easier level
          </RehabButton>
        ) : (
          <RehabButton primary disabled={!hasNext} data-testid="rehab-next" onClick={onNext}>
            Next level
          </RehabButton>
        )}
        <RehabButton data-testid="rehab-repeat" onClick={onRepeat}>
          Repeat
        </RehabButton>
        <RehabButton data-testid="rehab-levels" onClick={onLevels}>
          Levels
        </RehabButton>
        <RehabButton data-testid="rehab-result-exit" onClick={onExit}>
          Exit
        </RehabButton>
      </div>
    </div>
  );
}
