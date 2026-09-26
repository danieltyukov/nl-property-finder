/*
 * What each Action inbox item offers. Every kind has one primary action (key
 * A), and every kind can be dismissed (X) and snoozed (S). Items with a
 * drafted message can be edited (E). The daemon decides what an action does;
 * the dashboard only names it and sends it through POST /tasks/:id/resolve.
 */
import type { ProposedSlot, Task } from '@nlpf/core';
import type { ResolveTaskInput } from '../core';
import { safeHref } from './url';

export type ResolveAction = ResolveTaskInput['action'];

export type TaskAction =
  | { kind: 'resolve'; action: ResolveAction; label: string; done: string }
  | { kind: 'connect'; label: string; done: string }
  | { kind: 'poll'; label: string; done: string };

export interface TaskActions {
  primary: TaskAction;
  secondary: TaskAction[];
  canEdit: boolean;
  link?: { label: string; href: string };
}

const resolve = (action: ResolveAction, label: string, done: string): TaskAction => ({ kind: 'resolve', action, label, done });

export function payloadString(task: Task, key: string): string | undefined {
  const value = task.payload?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

export function payloadStrings(task: Task, key: string): string[] {
  const value = task.payload?.[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

export function taskSlots(task: Task): ProposedSlot[] {
  const value = task.payload?.slots;
  return Array.isArray(value) ? (value as ProposedSlot[]).filter((s) => s && typeof s.start === 'string') : [];
}

export function taskDraft(task: Task): string | undefined {
  return payloadString(task, 'draft');
}

export function taskActions(task: Task): TaskActions {
  const url = safeHref(payloadString(task, 'url'));
  const draft = taskDraft(task);
  switch (task.kind) {
    case 'viewing_booked':
      return {
        primary: resolve('approve', 'Confirm', 'Viewing confirmed'),
        secondary: [resolve('reject', 'Cancel viewing', 'Viewing cancelled')],
        canEdit: false,
      };
    case 'viewing_choice':
      return { primary: resolve('approve', 'Accept time', 'Time accepted'), secondary: [], canEdit: true };
    case 'reply_needed':
      return { primary: resolve('send_draft', 'Send reply', 'Reply sent'), secondary: [], canEdit: true };
    case 'documents_approval':
      return { primary: resolve('approve', 'Approve and send', 'Documents approved'), secondary: [], canEdit: Boolean(draft) };
    case 'approve_outreach':
      return { primary: resolve('approve', 'Approve and send', 'Message approved'), secondary: [], canEdit: true };
    case 'application_form':
      return {
        primary: resolve('done', 'Mark done', 'Marked done'),
        secondary: [],
        canEdit: false,
        link: url ? { label: 'Open form', href: url } : undefined,
      };
    case 'offer_or_contract':
      return { primary: resolve('done', 'Mark handled', 'Marked handled'), secondary: [], canEdit: Boolean(draft) };
    case 'payment_warning':
      return { primary: resolve('done', 'I will not pay', 'Marked handled'), secondary: [], canEdit: false };
    case 'scam_review':
      return {
        primary: resolve('reject', 'Mark as scam', 'Marked as scam'),
        secondary: [resolve('approve', 'Not a scam', 'Cleared')],
        canEdit: false,
      };
    case 'react_manually':
      return {
        primary: resolve('done', 'Mark as sent', 'Marked as sent'),
        secondary: [],
        canEdit: false,
        link: url ? { label: 'Open listing', href: url } : undefined,
      };
    case 'send_uncertain':
      return {
        primary: resolve('done', 'It was sent', 'Marked as sent'),
        secondary: [resolve('approve', 'Send again', 'Sending again')],
        canEdit: false,
      };
    case 'reconnect':
      return { primary: { kind: 'connect', label: 'Log in', done: 'Login window opened' }, secondary: [], canEdit: false };
    case 'captcha':
      // The agent never solves a captcha: the person opens the listing and sends the ready message.
      return {
        primary: resolve('done', 'Mark as sent', 'Marked as sent'),
        secondary: [],
        canEdit: false,
        link: url ? { label: 'Open listing', href: url } : undefined,
      };
    case 'source_broken':
      return { primary: { kind: 'poll', label: 'Check now', done: 'Check started' }, secondary: [], canEdit: false };
    case 'config_invalid':
      return { primary: resolve('done', 'Mark fixed', 'Marked fixed'), secondary: [], canEdit: false };
    case 'call_now': {
      const phone = payloadString(task, 'phone');
      return {
        primary: resolve('done', 'Mark called', 'Marked called'),
        secondary: [],
        canEdit: false,
        link: phone ? { label: `Call ${phone}`, href: `tel:${phone.replace(/\s+/g, '')}` } : undefined,
      };
    }
    case 'registration_renewal':
      return {
        primary: resolve('done', 'Mark renewed', 'Marked renewed'),
        secondary: [],
        canEdit: false,
        link: url ? { label: 'Open portal', href: url } : undefined,
      };
    default:
      return { primary: resolve('done', 'Mark done', 'Marked done'), secondary: [], canEdit: Boolean(draft) };
  }
}

export const DISMISS = resolve('dismiss', 'Dismiss', 'Dismissed');
export const SNOOZE = resolve('snooze', 'Snooze 3 h', 'Snoozed for 3 hours');

/** Priority first, then the nearest deadline, then the item that has waited longest. */
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const da = a.dueAt ? Date.parse(a.dueAt) : Infinity;
    const db = b.dueAt ? Date.parse(b.dueAt) : Infinity;
    if (da !== db) return da - db;
    return Date.parse(a.createdAt) - Date.parse(b.createdAt);
  });
}
