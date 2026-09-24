/*
 * The one-window mark (packages/design/logo) drawn inline so its window can be
 * the agent's status light: it pulses while the agent runs, turns grey when
 * paused and red on an error. Colours come from tokens through CSS classes.
 */
export type AgentLight = 'running' | 'paused' | 'error' | 'idle';

const GABLE = 'M2 15V7h2V4h2V1h4v3h2v3h2v8zM9 9h3v3H9z';

export function Mark({ size = 20, light = 'idle' }: { size?: number; light?: AgentLight }) {
  return (
    <svg className={`mark mark-${light}`} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
      <path className="mark-gable" fillRule="evenodd" d={GABLE} />
      <rect className="mark-window" x="9" y="9" width="3" height="3" />
    </svg>
  );
}

/*
 * The 2D street from the design brief: three gables whose windows light with
 * the same event names the site uses. `found` windows light for listings found
 * today, one window turns the needs-you colour while the inbox has items.
 */
const WINDOWS: [number, number][] = [
  [4, 12], [8, 12], [4, 17], [8, 17],
  [17, 9], [21, 9], [17, 14], [21, 14], [17, 19], [21, 19],
  [30, 13], [34, 13], [30, 18], [34, 18],
];

export function Facade({ found, needsYou, ping }: { found: number; needsYou: boolean; ping?: number }) {
  const lit = Math.min(found, WINDOWS.length);
  return (
    <svg className="facade" viewBox="0 0 40 24" width="80" height="48" aria-hidden="true" focusable="false">
      <path className="facade-gable" d="M1 24V9h2V7h2V5h4v2h2v2h2v15z" />
      <path className="facade-gable" d="M14 24V7c0-2 1.5-3 3-4l2-1.5 2 1.5c1.5 1 3 2 3 4v17z" />
      <path className="facade-gable" d="M27 24V11h1V8h2V6h4v2h2v3h1v13z" />
      {WINDOWS.map(([x, y], i) => {
        const needs = needsYou && i === 5;
        const on = i < lit;
        const cls = needs ? 'facade-w needs' : on ? `facade-w lit${ping !== undefined && i === (ping % Math.max(lit, 1)) ? ' ping' : ''}` : 'facade-w';
        return <rect key={i} className={cls} x={x} y={y} width="2" height="2.5" />;
      })}
    </svg>
  );
}
