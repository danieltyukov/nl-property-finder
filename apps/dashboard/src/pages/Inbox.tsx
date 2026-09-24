/*
 * Home: the Action inbox, the pipeline strip and the live feed.
 *
 * Only things that need a person land here. Each item says why, shows the
 * property, the agent's draft when there is one, and one primary action.
 * Keyboard: J and K move, Enter expands, A runs the primary action, E edits
 * the draft, X dismisses, S snoozes. Every key also has a visible button.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import type { ContractReview, Task } from '@nlpf/core';
import { useApi } from '../api/client';
import { qk, useProperty, useSourceMutations, useStats, useStatus, useTasks } from '../api/hooks';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { LiveFeed } from '../components/LiveFeed';
import { Mark } from '../components/Mark';
import { PipelineStrip } from '../components/PipelineStrip';
import { copyText, useNow } from '../components/state';
import { Button, Card, Chip, ErrorNote, Loading, Pill, Tag } from '../components/ui';
import { ago, day, dayTime, duration, eur, fullAddress, hm } from '../lib/format';
import { isPlainKey, isTypingTarget, modalOpen } from '../lib/keys';
import { sourceName, TASK_KIND } from '../lib/labels';
import {
  DISMISS,
  payloadString,
  payloadStrings,
  SNOOZE,
  sortTasks,
  taskActions,
  taskDraft,
  taskSlots,
  type TaskAction,
} from '../lib/tasks';

const SYSTEM_KINDS = new Set(['reconnect', 'captcha', 'source_broken', 'config_invalid', 'send_uncertain', 'registration_renewal']);

function numberWord(n: number): string {
  return ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'][n] ?? String(n);
}

export function InboxPage() {
  const tasks = useTasks();
  const status = useStatus();
  const stats = useStats();
  const { hidden } = useFeedback();
  const visible = useMemo(() => sortTasks((tasks.data ?? []).filter((t) => !hidden.has(t.id))), [tasks.data, hidden]);
  const n = visible.length;
  const title = n === 0 ? 'Nothing needs you.' : n === 1 ? 'One thing needs you.' : `${numberWord(n)} things need you.`;

  return (
    <div className="page page-home">
      <div className="page-head compact">
        <div className="page-head-text">
          <Chip>{`Today, ${day(Date.now())}`}</Chip>
          <h1 className="page-title">{title}</h1>
        </div>
      </div>
      <PipelineStrip status={status.data} stats={stats.data} />
      <div className="home-grid">
        <InboxCard tasks={visible} loading={tasks.isLoading} error={tasks.error} />
        <LiveFeed className="home-feed" />
      </div>
    </div>
  );
}

export function InboxCard({ tasks, loading, error }: { tasks: Task[]; loading?: boolean; error?: unknown }) {
  const api = useApi();
  const client = useQueryClient();
  const feedback = useFeedback();
  const sources = useSourceMutations();
  const status = useStatus();
  const now = useNow(5000);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [slots, setSlots] = useState<Record<string, number>>({});
  const listRef = useRef<HTMLUListElement>(null);

  const index = Math.max(0, tasks.findIndex((t) => t.id === selectedId));
  const selected = tasks[index];

  const focusItem = useCallback((id: string | undefined) => {
    if (!id) return;
    setSelectedId(id);
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-task="${id.replace(/["\\]/g, '\\$&')}"]`)?.focus());
  }, []);

  const move = useCallback(
    (delta: number) => {
      if (!tasks.length) return;
      const next = tasks[Math.min(tasks.length - 1, Math.max(0, index + delta))];
      focusItem(next?.id);
    },
    [tasks, index, focusItem],
  );

  const run = useCallback(
    (task: Task, action: TaskAction, extra: { draft?: string } = {}) => {
      if (action.kind === 'connect' || action.kind === 'poll') {
        if (!task.sourceId) return;
        const m = action.kind === 'connect' ? sources.connect : sources.poll;
        m.mutate(task.sourceId, {
          onSuccess: () =>
            feedback.toast(
              action.kind === 'connect'
                ? `A login window for ${sourceName(task.sourceId)} opened on this computer. Log in there; the item clears itself once the session works.`
                : `Checking ${sourceName(task.sourceId)} now.`,
            ),
          onError: (e) => feedback.toast(`Could not reach the agent: ${e.message}`, 'error'),
        });
        return;
      }
      const position = tasks.findIndex((t) => t.id === task.id);
      const neighbour = tasks[position + 1] ?? tasks[position - 1];
      const body: Parameters<typeof api.resolveTask>[1] = { action: action.action };
      const draft = extra.draft ?? drafts[task.id];
      if (action.action === 'send_draft' || (draft !== undefined && action.action === 'approve' && editing === task.id)) {
        body.action = 'send_draft';
        body.draft = draft ?? taskDraft(task) ?? '';
      }
      if (task.kind === 'viewing_choice' && action.action === 'approve') body.slot = slots[task.id] ?? 0;
      if (action.action === 'snooze') body.until = new Date(Date.now() + 3 * 3600_000).toISOString();
      setEditing(null);
      feedback.defer({
        message: `${action.done}: ${task.title}`,
        hide: [task.id],
        commit: async () => {
          await api.resolveTask(task.id, body);
          await Promise.all([client.invalidateQueries({ queryKey: qk.tasks }), client.invalidateQueries({ queryKey: qk.status })]);
        },
      });
      if (neighbour) focusItem(neighbour.id);
    },
    [api, client, drafts, editing, feedback, focusItem, slots, sources.connect, sources.poll, tasks],
  );

  const toggleExpand = useCallback((id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const startEdit = useCallback(
    (task: Task) => {
      setDrafts((d) => ({ ...d, [task.id]: d[task.id] ?? taskDraft(task) ?? '' }));
      setEditing(task.id);
      setExpanded((current) => new Set(current).add(task.id));
      requestAnimationFrame(() => document.getElementById(`draft-${task.id}`)?.focus());
    },
    [],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isPlainKey(event) || isTypingTarget(event.target) || modalOpen()) return;
      if (event.target instanceof HTMLElement && event.target.closest('.drawer, .palette')) return;
      const key = event.key.toLowerCase();
      if (key === 'j') {
        event.preventDefault();
        move(1);
      } else if (key === 'k') {
        event.preventDefault();
        move(-1);
      } else if (!selected) {
        return;
      } else if (key === 'enter' && event.target instanceof HTMLElement && event.target.dataset.task) {
        event.preventDefault();
        toggleExpand(selected.id);
      } else if (key === 'a') {
        event.preventDefault();
        run(selected, taskActions(selected).primary);
      } else if (key === 'e' && taskActions(selected).canEdit) {
        event.preventDefault();
        startEdit(selected);
      } else if (key === 'x') {
        event.preventDefault();
        run(selected, DISMISS);
      } else if (key === 's') {
        event.preventDefault();
        run(selected, SNOOZE);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [move, run, selected, startEdit, toggleExpand]);

  const sourcesAll = status.data?.sources ?? [];
  const enabled = sourcesAll.filter((s) => s.enabled);
  const lastRun = enabled.map((s) => s.lastRunAt).filter((x): x is string => Boolean(x)).sort().pop();

  return (
    <Card
      label="Action inbox"
      count={tasks.length || undefined}
      className="inbox"
      action={
        <div className="inbox-nav">
          <Button variant="ghost" size="sm" shortcut="K" onClick={() => move(-1)} disabled={!tasks.length} aria-label="Previous item">
            Previous
          </Button>
          <Button variant="ghost" size="sm" shortcut="J" onClick={() => move(1)} disabled={!tasks.length} aria-label="Next item">
            Next
          </Button>
        </div>
      }
    >
      {loading ? <Loading label="Loading the inbox" /> : null}
      {error ? <ErrorNote error={error} /> : null}
      {!loading && !error && tasks.length === 0 ? (
        <div className="inbox-empty dotgrid">
          <Mark size={36} light="running" />
          <p className="inbox-empty-title">
            Nothing needs you. {lastRun ? `Last check ${ago(lastRun, now)} on ${enabled.length} ${enabled.length === 1 ? 'source' : 'sources'}.` : 'The first check is on its way.'}
          </p>
          <p className="inbox-empty-body">Replies the agent can answer itself are answered and logged in Activity.</p>
        </div>
      ) : null}
      <ul className="inbox-list" ref={listRef}>
        {tasks.map((task, i) => (
          <InboxItem
            key={task.id}
            task={task}
            selected={i === index}
            expanded={expanded.has(task.id)}
            editing={editing === task.id}
            draft={drafts[task.id]}
            slot={slots[task.id] ?? 0}
            now={now}
            onSelect={() => setSelectedId(task.id)}
            onToggle={() => toggleExpand(task.id)}
            onRun={(action, extra) => run(task, action, extra)}
            onEdit={() => startEdit(task)}
            onCancelEdit={() => setEditing(null)}
            onDraft={(value) => setDrafts((d) => ({ ...d, [task.id]: value }))}
            onSlot={(value) => setSlots((s) => ({ ...s, [task.id]: value }))}
          />
        ))}
      </ul>
    </Card>
  );
}

function deadline(task: Task, now: number): { text: string; overdue: boolean } | null {
  if (!task.dueAt) return null;
  const left = Date.parse(task.dueAt) - now;
  if (left < 0) return { text: `overdue by ${duration(-left)}`, overdue: true };
  return { text: `answer within ${duration(left)}`, overdue: false };
}

function InboxItem(props: {
  task: Task;
  selected: boolean;
  expanded: boolean;
  editing: boolean;
  draft: string | undefined;
  slot: number;
  now: number;
  onSelect: () => void;
  onToggle: () => void;
  onRun: (action: TaskAction, extra?: { draft?: string }) => void;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDraft: (value: string) => void;
  onSlot: (value: number) => void;
}) {
  const { task, selected, expanded, editing, now } = props;
  const property = useProperty(task.propertyId);
  const titleId = useId();
  const actions = taskActions(task);
  const draft = taskDraft(task);
  const system = SYSTEM_KINDS.has(task.kind);
  // Red is for warnings about money and scams, not for good news with a deadline.
  const urgent = task.kind === 'payment_warning' || (task.kind === 'scam_review' && task.priority === 1);
  const due = deadline(task, now);
  const view = property.data;
  const listingSources = [...new Set((view?.listings ?? []).map((l) => sourceName(l.sourceId)))];
  const context = [
    fullAddress(view?.property.address, view?.property.title ?? payloadString(task, 'address')),
    eur(view?.property.priceEur),
    listingSources.join(', ') || sourceName(task.sourceId),
  ].filter(Boolean);
  const slots = taskSlots(task);
  const primaryLabel =
    task.kind === 'viewing_choice' && slots[props.slot] ? `Accept ${dayTime(slots[props.slot]!.start)}` : actions.primary.label;

  return (
    <li className={`inbox-item${system ? ' system' : ' needs'}${urgent ? ' urgent' : ''}${selected ? ' selected' : ''}`}>
      <article
        className="item"
        tabIndex={selected ? 0 : -1}
        data-task={task.id}
        aria-labelledby={titleId}
        onFocus={props.onSelect}
        onClick={props.onSelect}
      >
        <div className="item-top">
          {!system ? <span className="sq" aria-hidden="true" /> : null}
          <Pill tone={urgent ? 'error' : system ? 'closed' : 'needs-you'}>{urgent ? 'Warning' : system ? 'System' : 'Needs you'}</Pill>
          <span className="item-kind">{TASK_KIND[task.kind] ?? task.kind}</span>
          {due ? <span className={`deadline${due.overdue ? ' overdue' : ''}`}>{due.text}</span> : null}
          <span className="item-age">{ago(task.createdAt, now)}</span>
        </div>
        <h3 className="item-title" id={titleId}>
          {task.title}
        </h3>
        {context.length ? (
          <p className="item-context">
            {task.propertyId ? <Link href={`/properties/${task.propertyId}`}>{context[0]}</Link> : context[0]}
            {context.slice(1).map((c) => (
              <span key={c}> · {c}</span>
            ))}
          </p>
        ) : null}
        <p className="item-reason">{task.reason}</p>

        {task.kind === 'offer_or_contract' ? <ContractFindings review={task.payload?.contractReview as ContractReview | undefined} /> : null}
        {task.kind === 'scam_review' || task.kind === 'payment_warning' ? <Signals task={task} /> : null}

        {task.kind === 'viewing_choice' && slots.length ? (
          <fieldset className="slots">
            <legend className="label">Proposed times</legend>
            {slots.map((s, i) => (
              <label key={`${s.start}-${i}`} className="slot">
                <input type="radio" name={`slot-${task.id}`} checked={props.slot === i} onChange={() => props.onSlot(i)} />
                <span>
                  {dayTime(s.start)}
                  {s.end ? `-${hm(s.end)}` : ''}
                </span>
                {!s.certain ? <Tag title="The message was ambiguous about this time">check</Tag> : null}
              </label>
            ))}
          </fieldset>
        ) : null}

        {editing ? (
          <div className="draft-edit">
            <label className="label" htmlFor={`draft-${task.id}`}>
              Your reply
            </label>
            <textarea
              id={`draft-${task.id}`}
              className="input mono-area"
              rows={6}
              value={props.draft ?? draft ?? ''}
              onChange={(e) => props.onDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') props.onCancelEdit();
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) props.onRun({ kind: 'resolve', action: 'send_draft', label: 'Send', done: 'Reply sent' }, { draft: e.currentTarget.value });
              }}
            />
            <div className="draft-edit-actions">
              <Button
                variant="primary"
                onClick={() => props.onRun({ kind: 'resolve', action: 'send_draft', label: 'Send', done: 'Reply sent' }, { draft: props.draft ?? draft ?? '' })}
                shortcut="Ctrl Enter"
              >
                Send
              </Button>
              <Button variant="ghost" onClick={props.onCancelEdit} shortcut="Esc">
                Cancel
              </Button>
            </div>
          </div>
        ) : draft ? (
          <blockquote className={`draft${expanded ? ' open' : ''}`}>
            <span className="draft-label">Draft</span>
            {draft}
          </blockquote>
        ) : null}

        {expanded ? <TaskDetails task={task} /> : null}

        <div className="item-actions">
          <Button variant="primary" shortcut="A" onClick={() => props.onRun(actions.primary)}>
            {primaryLabel}
          </Button>
          {actions.canEdit && !editing ? (
            <Button shortcut="E" onClick={props.onEdit}>
              {task.kind === 'viewing_choice' ? 'Other time' : 'Edit draft'}
            </Button>
          ) : null}
          {actions.secondary.map((a) => (
            <Button key={a.label} onClick={() => props.onRun(a)}>
              {a.label}
            </Button>
          ))}
          {actions.link ? (
            <a className="btn btn-secondary btn-md" href={actions.link.href} target="_blank" rel="noreferrer">
              <Icon name="external" size={14} />
              <span className="btn-label">{actions.link.label}</span>
            </a>
          ) : null}
          {task.kind === 'react_manually' && draft ? (
            <Button icon="copy" onClick={() => void copyText(draft)}>
              Copy message
            </Button>
          ) : null}
          <Button variant="ghost" shortcut="X" onClick={() => props.onRun(DISMISS)}>
            Dismiss
          </Button>
          <Button variant="ghost" shortcut="S" onClick={() => props.onRun(SNOOZE)}>
            Snooze 3 h
          </Button>
          <Button variant="ghost" className="item-more" shortcut="Enter" aria-expanded={expanded} onClick={props.onToggle}>
            {expanded ? 'Less' : 'More'}
          </Button>
        </div>
      </article>
    </li>
  );
}

function ContractFindings({ review }: { review?: ContractReview }) {
  if (!review) return null;
  const order = { illegal: 0, warning: 1, info: 2 } as const;
  const findings = [...(review.findings ?? [])].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div className="review">
      <p className="label">Contract review</p>
      <p className="review-summary">{review.summary}</p>
      <ul className="review-list">
        {findings.map((f, i) => (
          <li key={i}>
            <Pill tone={f.severity === 'illegal' ? 'error' : f.severity === 'warning' ? 'needs-you' : 'closed'}>
              {f.severity === 'illegal' ? 'Not allowed' : f.severity === 'warning' ? 'Check' : 'Note'}
            </Pill>
            <span className="review-topic">{f.topic}</span>
            <span className="review-text">{f.text}</span>
          </li>
        ))}
      </ul>
      <p className="field-hint">Read by the agent. It is not legal advice; the Huurcommissie and Het Juridisch Loket can check a contract for free.</p>
    </div>
  );
}

function Signals({ task }: { task: Task }) {
  const signals = [...payloadStrings(task, 'signals'), ...payloadStrings(task, 'feeFlags')];
  if (!signals.length) return null;
  return (
    <p className="signals">
      {signals.map((s) => (
        <Tag key={s}>{s.replace(/_/g, ' ')}</Tag>
      ))}
    </p>
  );
}

function TaskDetails({ task }: { task: Task }) {
  const message = payloadString(task, 'message');
  const documents = payloadStrings(task, 'documents');
  const questions = payloadStrings(task, 'questions');
  const errors = payloadStrings(task, 'errors');
  const error = payloadString(task, 'error');
  const viewing = task.payload?.viewing as { startsAt?: string; endsAt?: string; location?: string } | undefined;
  return (
    <div className="item-details">
      {viewing?.startsAt ? (
        <p>
          <span className="label">When</span> {dayTime(viewing.startsAt)}
          {viewing.endsAt ? `-${hm(viewing.endsAt)}` : ''}
          {viewing.location ? ` at ${viewing.location}` : ''}
        </p>
      ) : null}
      {message ? (
        <div>
          <p className="label">Their message</p>
          <blockquote className="quote">{message}</blockquote>
        </div>
      ) : null}
      {questions.length ? (
        <div>
          <p className="label">Questions the profile cannot answer</p>
          <ul className="plain-list">
            {questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {documents.length ? (
        <div>
          <p className="label">Documents</p>
          <ul className="plain-list mono">
            {documents.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
          <p className="field-hint">Identity documents are always sent with a watermark naming the recipient, the address and the date.</p>
        </div>
      ) : null}
      {errors.length || error ? (
        <pre className="code-block">{[error, ...errors].filter(Boolean).join('\n')}</pre>
      ) : null}
      <p className="item-meta">
        Opened {ago(task.createdAt)}
        {task.dueAt ? ` · due ${dayTime(task.dueAt)}` : ''}
        {task.conversationId ? (
          <>
            {' · '}
            <Link href={`/conversations/${task.conversationId}`}>Open the conversation</Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
