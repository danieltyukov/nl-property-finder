import type {
  Config, EventBus, Logger, MailStatus, Message, Paths, SourceState, StatsView, Store, Task, AiUsage,
} from '@nlpf/core';
import type { z } from 'zod';
import type { ContactBody, DraftBody, ResolveTaskBody, SendMessageBody, SourcePatchBody, WithdrawAllBody } from '@nlpf/core';

export interface DocumentInfo { name: string; sensitivity: 'public' | 'private' | 'identity'; kind: string; size: number; addedAt: string }

/** What the daemon does in response to API calls. The HTTP layer never touches pipelines directly. */
export interface DaemonActions {
  pause(): void;
  resume(): void;
  resolveTask(id: string, body: z.infer<typeof ResolveTaskBody>): Promise<Task>;
  contactProperty(id: string, body: z.infer<typeof ContactBody>): Promise<{ ok: boolean; detail?: string }>;
  skipProperty(id: string): Promise<void>;
  sendMessage(conversationId: string, body: z.infer<typeof SendMessageBody>): Promise<Message>;
  draft(body: z.infer<typeof DraftBody>): Promise<{ subject?: string; body: string }>;
  testSource(id: string): Promise<{ ok: boolean; count: number; sample: unknown[]; error?: string; ms: number }>;
  connectSource(id: string): Promise<void>;
  pollSource(id: string): Promise<void>;
  patchSource(id: string, body: z.infer<typeof SourcePatchBody>): Promise<SourceState>;
  withdrawAll(body: z.infer<typeof WithdrawAllBody>): Promise<{ withdrawn: number; skipped: number }>;
  listDocuments(): DocumentInfo[];
  saveDocument(name: string, sensitivity: DocumentInfo['sensitivity'], kind: string, bytes: Uint8Array): DocumentInfo;
  deleteDocument(name: string): void;
  tenantProfilePdf(): Promise<Uint8Array>;
  stats(): StatsView;
}

export interface DaemonContext {
  version: string;
  startedAt: string;
  demo: boolean;
  paths: Paths;
  port: number;
  token: string;
  lanHost?: string;
  store: Store;
  bus: EventBus;
  log: Logger;
  config(): Config;
  secrets(): Record<string, string>;
  updateConfig(section: keyof Config, value: unknown): Config;
  mailStatus(): MailStatus;
  ai(): { provider: 'claude' | 'rules' | 'demo'; usageThisMonth: AiUsage; budget?: number };
  nextPollAt(): string | undefined;
  actions: DaemonActions;
  dashboardDir?: string;
}
