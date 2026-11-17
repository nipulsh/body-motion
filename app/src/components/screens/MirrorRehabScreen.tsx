import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getVisionManager } from '@vision';
import coreConfig from '@vision/games/rehab/core/config.json';
import { LM } from '@vision/games/rehab/core/geometry';
import { usePlayerWalkAway } from '../../hooks/usePlayerWalkAway';
import { usePosePreviewCamera } from '../../hooks/usePosePreviewCamera';
import { useWorkflow } from '../../workflow/WorkflowContext';
import { RehabEngine, type PlayView, type SessionEnd } from '../../games/rehab/core/engine';
import type { GameModule, OptionValues } from '../../games/rehab/core/module';
import { MockPoseProvider, WebSocketPoseProvider } from '../../games/rehab/core/providers';
import { loadSettings, saveSettings, type RehabSettings } from '../../games/rehab/core/settings';
import { bestStars } from '../../games/rehab/core/storage';
import { findRehabGame, REHAB_GAMES } from '../../games/rehab/registry';
import { HoverDwell } from '../rehab/hoverDwell';
import { MockPosePanel } from '../rehab/MockPosePanel';
import { RehabAlignment, RehabGear, nudgeAlignment } from '../rehab/RehabGear';
import { RehabHome } from '../rehab/RehabHome';
import { RehabPlayOverlay } from '../rehab/RehabPlayOverlay';
import { RehabResult } from '../rehab/RehabResult';
import { HOVER_ATTR } from '../rehab/rehabUi';
import '../rehab/rehab.css';

type Screen = 'home' | 'play' | 'result' | 'gear' | 'alignment';

const SKELETON: [number, number][] = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28], [27, 29], [29, 31], [28, 30], [30, 32], [15, 19], [16, 20],
];

function optionsFor(game: GameModule, settings: RehabSettings): OptionValues {
  const merged = { ...game.defaultOptions, ...(settings.options[game.id] ?? {}) };
  return game.normalizeOptions ? game.normalizeOptions(merged) : merged;
}

/**
 * Mirror Rehab: Fruit Catcher, Cross-Over Bubbles and March to the Beat on one
 * shared core (tracking, base pose, black mirror display, hover menus, storage).
 */
export function MirrorRehabScreen() {
  const { dispatch } = useWorkflow();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const cursorArcRef = useRef<SVGCircleElement>(null);
  const debugRef = useRef<HTMLCanvasElement>(null);
  const markersRef = useRef<HTMLDivElement>(null);

  const [settings, setSettingsState] = useState<RehabSettings>(loadSettings);
  const engineRef = useRef<RehabEngine | null>(null);
  if (!engineRef.current) engineRef.current = new RehabEngine(settings);
  const engine = engineRef.current;

  const [screen, setScreen] = useState<Screen>('home');
  const screenRef = useRef<Screen>('home');
  screenRef.current = screen;
  const [gameId, setGameId] = useState(() => findRehabGame(settings.lastGame).id);
  const [end, setEnd] = useState<SessionEnd | null>(null);
  const [view, setView] = useState<PlayView>(() => engine.view());
  const [demo, setDemo] = useState(false);
  const [wsStatus, setWsStatus] = useState<string | null>(null);
  const mockRef = useRef<MockPoseProvider | null>(null);
  if (!mockRef.current) mockRef.current = new MockPoseProvider(coreConfig.poseFps);

  const game = findRehabGame(gameId);
  const options = useMemo(() => optionsFor(game, settings), [game, settings]);
  const levels = useMemo(() => game.levels(options), [game, options]);
  const lastLevelIndex = Math.min(levels.length - 1, settings.lastLevel[game.lastLevelKey(options)] ?? 0);

  const updateSettings = useCallback(
    (next: RehabSettings) => {
      setSettingsState(next);
      saveSettings(next);
      engine.applySettings(next);
    },
    [engine],
  );
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const leave = useCallback(() => {
    engine.exit();
    dispatch({ type: 'SET_STAGE', stage: 'games_placeholder' });
  }, [dispatch, engine]);

  // Stepping out of the mirror closes the games (not the settings screens, which staff use from the side).
  const walkAway = usePlayerWalkAway(leave, screen === 'home' || screen === 'play' || screen === 'result');
  const { notePose } = walkAway;

  // ---- Pose sources --------------------------------------------------------

  const feedPose = useCallback(
    (pose: Parameters<RehabEngine['onPose']>[0]) => {
      notePose(pose);
      engine.onPose(pose);
    },
    [engine, notePose],
  );
  const { error: cameraError } = usePosePreviewCamera(videoRef, feedPose, settings.poseSource === 'camera');

  useEffect(() => {
    if (settings.poseSource !== 'camera') return;
    const manager = getVisionManager();
    manager.setPosePreviewFps(coreConfig.poseFps);
    return () => manager.setPosePreviewFps(null);
  }, [settings.poseSource]);

  useEffect(() => {
    if (settings.poseSource !== 'mock') return;
    const p = mockRef.current!;
    const off = p.onFrame(feedPose);
    p.start();
    return () => {
      off();
      p.stop();
    };
  }, [feedPose, settings.poseSource]);

  useEffect(() => {
    const p = mockRef.current!;
    p.demo = demo ? (t, params) => engine.session?.demo?.(t, params, engine.status?.frame ?? null) ?? null : null;
  }, [demo, engine]);

  useEffect(() => {
    if (settings.poseSource !== 'websocket') {
      setWsStatus(null);
      return;
    }
    const ws = new WebSocketPoseProvider();
    const off = ws.onFrame(feedPose);
    ws.start();
    const poll = window.setInterval(() => setWsStatus(ws.status), 500);
    return () => {
      window.clearInterval(poll);
      off();
      ws.stop();
    };
  }, [feedPose, settings.poseSource]);

  // ---- Engine wiring ---------------------------------------------------------

  useEffect(() => {
    engine.onEnd = (e) => {
      if (e.endedBy === 'exit') setScreen('home');
      else {
        setEnd(e);
        setScreen('result');
      }
    };
    return () => {
      engine.onEnd = null;
    };
  }, [engine]);

  useEffect(() => () => engine.dispose(), [engine]);

  const canvasRef = useCallback(
    (el: HTMLCanvasElement | null) => {
      if (el) engine.attachCanvas(el);
      else engine.detachCanvas();
    },
    [engine],
  );

  // Stage size and the type unit.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const apply = () => {
      const w = root.clientWidth;
      const h = root.clientHeight;
      engine.display.resize(w, h);
      root.style.setProperty('--u', `${Math.max(14, (Math.min(w, h) / 1080) * 32)}px`);
      const dbg = debugRef.current;
      if (dbg) {
        dbg.width = w;
        dbg.height = h;
      }
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(root);
    return () => ro.disconnect();
  }, [engine]);

  // Animation loop: engine flow + draw, hand-hover cursor, debug skeleton, HUD.
  useEffect(() => {
    let raf = 0;
    let lastHud = 0;
    const dwell = new HoverDwell();
    const loop = (nowMs: number) => {
      engine.tick(nowMs, window.devicePixelRatio || 1);
      const root = rootRef.current;
      const frame = engine.status?.frame ?? null;
      const scr = screenRef.current;

      // Cursor: fingertip of the raised hand (above the hips), mapped onto the reflection.
      let point: { x: number; y: number } | null = null;
      if (frame) {
        const hipY = (frame.pts[LM.lHip].y + frame.pts[LM.rHip].y) / 2;
        let best: { x: number; y: number } | null = null;
        for (const i of [LM.lIndex, LM.rIndex]) {
          const p = frame.pts[i];
          if ((frame.vis[i] ?? 0) < coreConfig.hover.cursorMinVisibility || p.y > hipY) continue;
          if (!best || p.y < best.y) best = p;
        }
        if (best) point = engine.display.toScreen(best);
      }
      const allowAll = scr !== 'play' || engine.canUseHoverMenu();
      const progress = root ? dwell.update(root, point, nowMs / 1000, allowAll, coreConfig.hover.dwellSeconds) : 0;
      const cursor = cursorRef.current;
      if (cursor) {
        cursor.style.transform = point ? `translate(${point.x}px, ${point.y}px)` : 'translate(-9999px, -9999px)';
        cursorArcRef.current?.setAttribute('stroke-dasharray', `${(progress * 63).toFixed(1)} 63`);
      }

      // Alignment markers on hips and shoulders.
      const markers = markersRef.current;
      if (markers) {
        const ids = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip];
        Array.from(markers.children).forEach((el, k) => {
          const span = el as HTMLElement;
          if (!frame) {
            span.style.display = 'none';
            return;
          }
          const s = engine.display.toScreen(frame.pts[ids[k]]);
          span.style.display = 'block';
          span.style.left = `${s.x}px`;
          span.style.top = `${s.y}px`;
        });
      }

      // Debug skeleton (off by default, key D).
      const dbg = debugRef.current;
      const ctx = dbg?.getContext('2d');
      if (dbg && ctx) {
        ctx.clearRect(0, 0, dbg.width, dbg.height);
        if (settingsRef.current.debugSkeleton && frame) {
          ctx.strokeStyle = 'rgba(200,200,200,0.6)';
          ctx.lineWidth = 1.5;
          for (const [a, b] of SKELETON) {
            const pa = engine.display.toScreen(frame.pts[a]);
            const pb = engine.display.toScreen(frame.pts[b]);
            ctx.beginPath();
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
          }
        }
      }

      if (scr === 'play' && nowMs - lastHud > 100) {
        lastHud = nowMs;
        setView(engine.view());
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      dwell.clear();
    };
  }, [engine]);

  // ---- Actions -----------------------------------------------------------------

  const startLevel = useCallback(
    (index: number, g: GameModule = game, opts: OptionValues = options) => {
      const lv = g.levels(opts);
      const level = lv[index];
      if (!level || level.disabled) return;
      const s = settingsRef.current;
      updateSettings({
        ...s,
        lastGame: g.id,
        lastLevel: { ...s.lastLevel, [g.lastLevelKey(opts)]: index },
        firstRunSeen: true,
      });
      engine.start(g, level, opts, g.landmarksFor?.(level, opts) ?? g.requiredLandmarks, g.seatedFor?.(opts) ?? false);
      setEnd(null);
      setView(engine.view());
      setScreen('play');
    },
    [engine, game, options, updateSettings],
  );

  const exitPlay = useCallback(() => {
    engine.exit();
    setScreen('home');
  }, [engine]);

  const setOption = (id: string, value: string | boolean) => {
    const s = settingsRef.current;
    let next: OptionValues = { ...options, [id]: value };
    if (game.normalizeOptions) next = game.normalizeOptions(next);
    updateSettings({ ...s, options: { ...s.options, [game.id]: next } });
  };

  const selectGame = (id: string) => {
    setGameId(id);
    updateSettings({ ...settingsRef.current, lastGame: id });
  };

  // ---- Keyboard ------------------------------------------------------------------

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const scr = screenRef.current;
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (scr === 'play') exitPlay();
        else if (scr === 'home') leave();
        else setScreen('home');
        return;
      }
      if (e.key === 'd' || e.key === 'D') {
        const s = settingsRef.current;
        updateSettings({ ...s, debugSkeleton: !s.debugSkeleton });
        return;
      }
      if (scr === 'alignment') {
        const next = nudgeAlignment(settingsRef.current.alignment, e.key);
        if (next) {
          e.preventDefault();
          updateSettings({ ...settingsRef.current, alignment: next });
        }
        return;
      }
      if (scr === 'play' && e.key === ' ') {
        e.preventDefault();
        engine.togglePause();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const root = rootRef.current;
        if (!root) return;
        const targets = Array.from(root.querySelectorAll<HTMLButtonElement>(`[${HOVER_ATTR}]`)).filter((b) => !b.disabled);
        if (!targets.length) return;
        e.preventDefault();
        const i = targets.indexOf(document.activeElement as HTMLButtonElement);
        const dir = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1;
        targets[(i + dir + targets.length) % targets.length].focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, exitPlay, leave, updateSettings]);

  // ---- Render --------------------------------------------------------------------

  const endIndex = end ? end.module.levels(end.options).findIndex((l) => l.id === end.level.id) : -1;
  const endLevels = end ? end.module.levels(end.options) : [];

  return (
    <div ref={rootRef} className="rehab-root" data-testid="mirror-rehab">
      {/* Feeds pose tracking only. The camera picture is never shown. */}
      <video ref={videoRef} autoPlay playsInline muted aria-hidden style={{ position: 'absolute', width: 1, height: 1, opacity: 0, pointerEvents: 'none' }} />

      {screen === 'play' ? <canvas ref={canvasRef} className="rehab-canvas" aria-label="Game" role="img" /> : null}

      {screen === 'home' ? (
        <RehabHome
          games={REHAB_GAMES}
          game={game}
          levels={levels}
          lastLevelIndex={lastLevelIndex}
          options={options}
          starsFor={(level) => bestStars(game.id, game.levelKey(level, options))}
          showSafetyLine={!settings.firstRunSeen}
          onSelectGame={selectGame}
          onStart={(i) => startLevel(i)}
          onOption={setOption}
          onExit={leave}
          onGear={() => setScreen('gear')}
          notice={
            settings.poseSource === 'camera' && cameraError ? (
              <p className="rehab-small" role="alert" style={{ textAlign: 'center', color: 'var(--rh-caution)' }}>
                {cameraError} You can switch to the mock skeleton in settings.
              </p>
            ) : null
          }
        />
      ) : null}

      {screen === 'play' ? (
        <RehabPlayOverlay
          view={view}
          levelName={engine.current ? `${engine.current.level.number} ${engine.current.level.name}` : ''}
          onExit={exitPlay}
          onPause={() => engine.togglePause()}
          onHurts={() => engine.hurts()}
          onReady={() => engine.confirmReady()}
        />
      ) : null}

      {screen === 'result' && end ? (
        <RehabResult
          end={end}
          hasNext={endIndex >= 0 && endIndex + 1 < endLevels.length && !endLevels[endIndex + 1].disabled}
          hasEasier={endIndex > 0 && !endLevels[endIndex - 1].disabled}
          onNext={() => startLevel(endIndex + 1, end.module, end.options)}
          onEasier={() => startLevel(endIndex - 1, end.module, end.options)}
          onRepeat={() => startLevel(endIndex, end.module, end.options)}
          onLevels={() => setScreen('home')}
          onExit={leave}
        />
      ) : null}

      {screen === 'gear' ? (
        <RehabGear settings={settings} onChange={updateSettings} onAlignment={() => setScreen('alignment')} onBack={() => setScreen('home')} wsStatus={wsStatus} />
      ) : null}

      {screen === 'alignment' ? (
        <RehabAlignment
          ref={markersRef}
          alignment={settings.alignment}
          onChange={(a) => updateSettings({ ...settingsRef.current, alignment: a })}
          onDone={() => setScreen('gear')}
        />
      ) : null}

      {walkAway.secondsLeft !== null ? (
        <div className="rehab-walkaway" role="status" aria-live="polite" data-testid="rehab-walkaway">
          <p>Closing the game in {walkAway.secondsLeft}</p>
          <p className="rehab-small">Step back in front of the mirror to keep playing.</p>
        </div>
      ) : null}

      <canvas ref={debugRef} className="rehab-canvas" style={{ pointerEvents: 'none' }} aria-hidden />

      {settings.poseSource === 'mock' && (screen === 'home' || screen === 'play') ? (
        <MockPosePanel provider={mockRef.current!} demo={demo} onDemo={setDemo} />
      ) : null}

      <div ref={cursorRef} className="rehab-cursor" aria-hidden>
        <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none">
          <circle cx="12" cy="12" r="4" stroke="#fff" strokeWidth="1.5" />
          <circle ref={cursorArcRef} cx="12" cy="12" r="10" stroke="var(--primary)" strokeWidth="2" strokeDasharray="0 63" transform="rotate(-90 12 12)" strokeLinecap="round" />
        </svg>
      </div>
    </div>
  );
}
