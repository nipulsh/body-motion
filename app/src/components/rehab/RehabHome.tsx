import type { ReactNode } from 'react';
import type { GameModule, LevelDef, OptionValues } from '../../games/rehab/core/module';
import { ICONS, OutlineIcon, RehabButton, Stars } from './rehabUi';

interface RehabHomeProps {
  games: readonly GameModule[];
  game: GameModule;
  levels: LevelDef[];
  lastLevelIndex: number;
  options: OptionValues;
  starsFor: (level: LevelDef) => number;
  showSafetyLine: boolean;
  onSelectGame: (id: string) => void;
  onStart: (index: number) => void;
  onOption: (id: string, value: string | boolean) => void;
  onExit: () => void;
  onGear: () => void;
  /** A warning shown under the options (e.g. the camera failed). */
  notice?: ReactNode;
}

/** Game icons, five level rings in chart order, the game's option chips, Exit and gear, all in the top 40%. */
export function RehabHome({
  games,
  game,
  levels,
  lastLevelIndex,
  options,
  starsFor,
  showSafetyLine,
  onSelectGame,
  onStart,
  onOption,
  onExit,
  onGear,
  notice,
}: RehabHomeProps) {
  const visibleOptions = (game.homeOptions ?? []).filter((o) => !o.visible || o.visible(options, lastLevelIndex));

  return (
    <>
      <div className="rehab-home" data-testid="rehab-home">
        <nav className="rehab-games" aria-label="Games">
          {games.map((g) => (
            <RehabButton
              key={g.id}
              className="rehab-game"
              selected={g.id === game.id}
              data-testid={`rehab-game-${g.id}`}
              onClick={() => onSelectGame(g.id)}
            >
              <OutlineIcon d={g.icon} />
              <span>{g.name}</span>
            </RehabButton>
          ))}
        </nav>

        <div className="rehab-levels" role="list" aria-label="Levels">
          {levels.map((level, i) => (
            <div key={level.id} className="rehab-level" role="listitem">
              <RehabButton
                className="rehab-level-ring"
                selected={i === lastLevelIndex}
                disabled={level.disabled}
                data-testid={`rehab-level-${i + 1}`}
                aria-label={`Start level ${level.number}, ${level.name}`}
                onClick={() => onStart(i)}
              >
                {level.number}
              </RehabButton>
              <span className="rehab-level-name">{level.name}</span>
              <Stars count={starsFor(level)} />
            </div>
          ))}
        </div>

        {visibleOptions.length ? (
          <div className="rehab-options">
            {visibleOptions.map((opt) =>
              opt.kind === 'toggle' ? (
                <div key={opt.id} className="rehab-chips">
                  <RehabButton small selected={options[opt.id] === true} onClick={() => onOption(opt.id, options[opt.id] !== true)}>
                    {opt.label}
                  </RehabButton>
                </div>
              ) : (
                <div key={opt.id} className="rehab-chips" role="group" aria-label={opt.label}>
                  {(opt.choices ?? []).map((c) => (
                    <RehabButton key={c.id} small selected={options[opt.id] === c.id} onClick={() => onOption(opt.id, c.id)}>
                      {c.label}
                    </RehabButton>
                  ))}
                </div>
              ),
            )}
          </div>
        ) : null}

        {showSafetyLine ? <p className="rehab-small rehab-muted">Use under a physiotherapist's guidance.</p> : null}
        {notice}
      </div>

      <div className="rehab-corner tl">
        <RehabButton className="rehab-exit-large" data-testid="rehab-exit" dwell={1.2} onClick={onExit}>
          Exit
        </RehabButton>
      </div>
      <div className="rehab-corner tr">
        <RehabButton icon small aria-label="Settings" data-testid="rehab-gear" onClick={onGear}>
          <OutlineIcon d={ICONS.gear} />
        </RehabButton>
      </div>
    </>
  );
}
