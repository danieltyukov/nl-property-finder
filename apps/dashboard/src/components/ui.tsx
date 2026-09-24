/*
 * Small shared pieces: pills, chips, keyboard hints, cards, labelled fields,
 * tooltips, empty states. Styling lives in styles/components.css.
 */
import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from 'react';
import type { Status, Tone } from '../lib/labels';
import { Icon, type IconName } from './Icon';
import { Mark } from './Mark';

export function Pill({ tone, children, busy }: { tone: Tone; children: ReactNode; busy?: boolean }) {
  return <span className={`pill ${tone}${busy ? ' busy' : ''}`}>{children}</span>;
}

export function StatusPill({ status }: { status: Status }) {
  return (
    <Pill tone={status.tone} busy={status.busy}>
      {status.label}
    </Pill>
  );
}

/** A small mono tag, used for source names and match reasons. */
export function Tag({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span className="tag" title={title}>
      {children}
    </span>
  );
}

/** The site's label chip: uppercase mono on a block, with two bars. */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="chip">
      <span>{children}</span>
      <i aria-hidden="true" />
      <i aria-hidden="true" />
    </span>
  );
}

/*
 * A visible key hint. It is hidden from assistive technology because the
 * button it sits in announces the same key through aria-keyshortcuts, which
 * keeps the button's accessible name to its words ("Confirm", not "Confirm A").
 */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="kbd" aria-hidden="true">
      {children}
    </kbd>
  );
}

/** "Ctrl Enter" as the aria-keyshortcuts value "Control+Enter". */
export function keyshortcuts(label: string): string {
  const map: Record<string, string> = { Ctrl: 'Control', Cmd: 'Meta', Esc: 'Escape' };
  return label
    .split(' ')
    .map((k) => map[k] ?? k)
    .join('+');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  shortcut?: string;
  size?: 'sm' | 'md';
};

/*
 * Primary buttons use the site's clipped corner in ink; the clip sits on a
 * pseudo-element so the focus ring is never cut. Secondary buttons are
 * outlined. A shortcut, when given, is shown in a kbd so every key has a
 * visible button.
 */
export function Button({ variant = 'secondary', icon, shortcut, size = 'md', className, children, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      className={`btn btn-${variant} btn-${size}${className ? ` ${className}` : ''}`}
      aria-keyshortcuts={shortcut ? keyshortcuts(shortcut) : undefined}
      {...rest}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children ? <span className="btn-label">{children}</span> : null}
      {shortcut ? <Kbd>{shortcut}</Kbd> : null}
    </button>
  );
}

export function IconButton({ icon, label, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string }) {
  return (
    <button type="button" className="icon-btn" aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

export function Card({
  label,
  count,
  action,
  children,
  className,
  id,
  as: Tag = 'section',
}: {
  label?: ReactNode;
  count?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
  as?: 'section' | 'div' | 'article';
}) {
  const headingId = useId();
  return (
    <Tag className={`card${className ? ` ${className}` : ''}`} aria-labelledby={label ? headingId : undefined} id={id}>
      {label ? (
        <div className="card-head">
          <h2 className="label" id={headingId}>
            {label}
          </h2>
          {count !== undefined && count !== null ? <span className="card-count">{count}</span> : null}
          {action ? <div className="card-action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

export function PageHeader({ eyebrow, title, lede, actions }: { eyebrow: string; title: string; lede?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        <Chip>{eyebrow}</Chip>
        <h1 className="page-title">{title}</h1>
        {lede ? <p className="page-lede">{lede}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
  wide,
}: {
  label: string;
  hint?: ReactNode;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className={`field${wide ? ' wide' : ''}`}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children(id, hintId)}
      {hint ? (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="toggle-row">
      <div className="toggle-text">
        <label htmlFor={id} className="toggle-label">
          {label}
        </label>
        {hint ? (
          <p className="field-hint" id={`${id}-hint`}>
            {hint}
          </p>
        ) : null}
      </div>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
    </div>
  );
}

/** A tooltip that works on hover and on keyboard focus, described to screen readers. */
export function Tip({ tip, children }: { tip: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <span className="tip" tabIndex={0} aria-describedby={id}>
      {children}
      <span role="tooltip" id={id} className="tip-body">
        {tip}
      </span>
    </span>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty grain">
      <Mark size={28} light="idle" />
      <p className="empty-title">{title}</p>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="loading" role="status">
      <span className="live busy" aria-hidden="true" />
      {label}
    </p>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <p className="error-note" role="alert">
      <Icon name="flag" size={14} /> {message}
    </p>
  );
}

/** A dot plus text, for health and connection states. */
export function Dot({ tone, pulse }: { tone: Tone; pulse?: boolean }) {
  return <span className={`dot ${tone}${pulse ? ' pulse' : ''}`} aria-hidden="true" />;
}

export function Disclosure({ summary, children, defaultOpen }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <details className="disclosure" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{summary}</summary>
      <div className="disclosure-body">{children}</div>
    </details>
  );
}
