import coreConfig from '@vision/games/rehab/core/config.json';
import type { PlayView } from '../../games/rehab/core/engine';
import { ICONS, OutlineIcon, RehabButton, RingTimer, SilhouetteGuide } from './rehabUi';

interface RehabPlayOverlayProps {
  view: PlayView;
  levelName: string;
  onExit: () => void;
  onPause: () => void;
  onHurts: () => void;
  onReady: () => void;
}

/** HUD over the game scene: corner icons, level + ring, score + combo, and the flow screens. */
export function RehabPlayOverlay({ view, levelName, onExit, onPause, onHurts, onReady }: RehabPlayOverlayProps) {
  const hud = view.hud;
  const showGuide = view.phase === 'base';
  const paused = view.phase === 'paused';

  return (
    <div className="rehab-layer" data-testid="rehab-play">
      <div className="rehab-corner tl">
        <RehabButton icon aria-label="Exit" data-testid="rehab-play-exit" dwell={coreConfig.hover.exitDwellSeconds} onClick={onExit}>
          <OutlineIcon d={ICONS.exit} />
        </RehabButton>
        <RehabButton
          icon
          aria-label={paused && view.pauseKind !== 'tracking' ? 'Resume' : 'Pause'}
          data-testid="rehab-play-pause"
          disabled={view.phase !== 'playing' && !(paused && view.pauseKind !== 'tracking')}
          onClick={onPause}
        >
          <OutlineIcon d={paused ? ICONS.play : ICONS.pause} />
        </RehabButton>
      </div>
      <div className="rehab-corner tr">
        <RehabButton danger always aria-label="It hurts: stop now" data-testid="rehab-play-hurts" onClick={onHurts}>
          Hurts
        </RehabButton>
      </div>

      <div className="rehab-hud-block left">
        <div className="rehab-hud-level">
          <RingTimer value={hud?.ring ?? 1} />
          <span>{hud?.levelName ?? levelName}</span>
        </div>
      </div>
      {hud ? (
        <div className="rehab-hud-block right">
          <span className="rehab-hud-score">{hud.score}</span>
          {hud.combo ? <span className="rehab-small">{hud.combo}</span> : null}
          {hud.detail ? <span className="rehab-small rehab-muted">{hud.detail}</span> : null}
        </div>
      ) : null}

      {hud?.ruleCard ? (
        <div className={`rehab-rule-card${hud.ruleCard.pulse ? ' is-pulsing' : ''}`} role="status" aria-live="polite">
          {hud.ruleCard.text}
          {hud.ruleCard.next ? <div className="rehab-small" style={{ color: 'var(--rh-caution)' }}>{hud.ruleCard.next}</div> : null}
        </div>
      ) : null}

      {hud?.cue && view.phase === 'playing' ? (
        <div className="rehab-cue" data-tone={hud.cue.tone} role="status" aria-live="polite">
          {hud.cue.text}
        </div>
      ) : null}

      {hud?.judgement && view.phase === 'playing' ? (
        <div className="rehab-judgement" data-tone={hud.judgement.tone} style={{ left: hud.judgement.x, top: hud.judgement.y }}>
          {hud.judgement.text}
        </div>
      ) : null}

      {showGuide ? <SilhouetteGuide progress={view.baseProgress} locked={view.baseLocked} /> : null}

      <div className="rehab-centre">
        {view.phase === 'base' ? (
          <p data-testid="rehab-base-message">{view.message ?? 'Stand still'}</p>
        ) : null}
        {view.phase === 'ready' ? (
          <>
            <p>{view.readyLine}</p>
            <RehabButton primary dwell={coreConfig.hover.readyDwellSeconds} data-testid="rehab-ready" onClick={onReady}>
              Ready
            </RehabButton>
          </>
        ) : null}
        {view.phase === 'countdown' ? <div className="rehab-countdown" aria-live="assertive">{view.countdown}</div> : null}
        {paused ? (
          <>
            <p role="status">{view.message}</p>
            {view.pauseKind !== 'tracking' ? (
              <RehabButton primary data-testid="rehab-resume" onClick={onPause}>
                Resume
              </RehabButton>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
