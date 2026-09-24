import type { ActionChannel, Config, Logger, Mailbox, Notifier } from '@nlpf/core';
import { createDesktopNotifier, type DesktopOptions } from './desktop.js';
import { createEmailNotifier } from './email.js';
import { createNtfyActionChannel, createNtfyNotifier } from './ntfy.js';
import { createTelegramActionChannel, createTelegramNotifier } from './telegram.js';

export { callbackData, generateActionSecret, parseCallbackData, signAction, verifyAction } from './sign.js';
export { actionsTopic, createNtfyActionChannel, createNtfyNotifier, ntfyActions, type NtfyActionChannelOptions, type NtfyConfig, type NtfyNotifierOptions } from './ntfy.js';
export {
  createTelegramActionChannel,
  createTelegramNotifier,
  escapeHtml,
  REPLY_ACTION,
  telegramText,
  type TelegramActionChannelOptions,
  type TelegramConfig,
  type TelegramOptions,
} from './telegram.js';
export { createDesktopNotifier, type DesktopOptions, type ExecFileFn } from './desktop.js';
export { createEmailNotifier, type EmailNotifierConfig } from './email.js';
export {
  createNotifyDispatcher,
  NEUTRAL_BODY,
  type DigestNotifier,
  type DispatcherOptions,
  type DispatchResult,
  type NotifyDispatcher,
} from './dispatcher.js';

export interface NotifySetupDeps {
  /** Values from secrets.env, for the Telegram token. */
  secrets: Record<string, string | undefined>;
  /** Per-install secret that signs phone buttons. Without it there are no buttons and no action channels. */
  actionSecret?: string;
  /** The agent mailbox, for the email channel. */
  mailbox?: Mailbox | null;
  log: Logger;
  desktop?: DesktopOptions;
}

export interface NotifySetup {
  notifiers: Notifier[];
  channels: ActionChannel[];
  /** Plain sentences about channels that are configured but cannot run, for the dashboard and `nlpf doctor`. */
  problems: string[];
}

/**
 * Builds the notifiers and action channels `notify` asks for. A channel that
 * cannot run (a missing token, no mailbox) is left out and reported in
 * `problems`; nothing here throws, so a notification setting can never stop
 * the daemon from starting.
 */
export function createNotifySetup(cfg: Config['notify'], deps: NotifySetupDeps): NotifySetup {
  const notifiers: Notifier[] = [];
  const channels: ActionChannel[] = [];
  const problems: string[] = [];
  const secret = deps.actionSecret;
  const log = deps.log.child({ scope: 'notify' });
  let wantsButtons = false;

  if (cfg.ntfy) {
    notifiers.push(createNtfyNotifier(cfg.ntfy, { secret }));
    if (cfg.ntfy.actions) {
      wantsButtons = true;
      if (secret) channels.push(createNtfyActionChannel(cfg.ntfy, secret, log));
    }
  }
  if (cfg.telegram) {
    const token = deps.secrets[cfg.telegram.tokenEnv];
    if (!token) {
      problems.push(`${cfg.telegram.tokenEnv} is not set, so Telegram is off`);
    } else {
      notifiers.push(createTelegramNotifier(cfg.telegram, token, { secret }));
      if (cfg.telegram.actions) {
        wantsButtons = true;
        if (secret) channels.push(createTelegramActionChannel(cfg.telegram, token, secret, log));
      }
    }
  }
  if (cfg.email) {
    if (deps.mailbox) notifiers.push(createEmailNotifier(deps.mailbox, cfg.email));
    else problems.push('notify.email needs the agent mailbox, which is off');
  }
  if (cfg.desktop) notifiers.push(createDesktopNotifier(deps.desktop));
  if (wantsButtons && !secret) problems.push('no action secret, so phone buttons are off');
  return { notifiers, channels, problems };
}
