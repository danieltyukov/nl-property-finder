/*
 * TanStack Query hooks, one per read route, and the mutations the pages use.
 * The live event stream (sse.ts) invalidates these keys as the daemon reports
 * changes, so most queries never poll; status keeps a slow poll as a backstop
 * for when the stream is down.
 */
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import type { Config } from '@nlpf/core';
import { useApi } from './client';
import { items, toApplicationView } from './views';
import type { ConfigView } from './views';

export const qk = {
  status: ['status'] as const,
  tasks: ['tasks'] as const,
  properties: (params: Record<string, unknown> = {}) => ['properties', params] as const,
  propertiesAll: ['properties'] as const,
  property: (id: string) => ['property', id] as const,
  applications: ['applications'] as const,
  conversations: ['conversations'] as const,
  conversation: (id: string) => ['conversation', id] as const,
  viewings: ['viewings'] as const,
  sources: ['sources'] as const,
  config: ['config'] as const,
  activity: (params: Record<string, unknown> = {}) => ['activity', params] as const,
  stats: ['stats'] as const,
  documents: ['documents'] as const,
};

export function useStatus() {
  const api = useApi();
  return useQuery({ queryKey: qk.status, queryFn: api.status, refetchInterval: 20_000 });
}

export function useTasks() {
  const api = useApi();
  // No state filter: the daemon's default is the active list (open, plus snoozed items that are due again).
  return useQuery({
    queryKey: qk.tasks,
    queryFn: async () => items(await api.tasks()).filter((t) => t.state === 'open' || t.state === 'snoozed'),
  });
}

export function useProperties(params: { status?: string; q?: string; limit?: number } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: qk.properties(params),
    queryFn: async () => items(await api.properties({ limit: 200, ...params })),
    placeholderData: (previous) => previous,
  });
}

export function useProperty(id: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.property(id ?? ''),
    queryFn: () => api.property(id as string),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

export function useApplications() {
  const api = useApi();
  return useQuery({ queryKey: qk.applications, queryFn: async () => items(await api.applications()).flatMap(toApplicationView) });
}

export function useConversations() {
  const api = useApi();
  return useQuery({ queryKey: qk.conversations, queryFn: async () => items(await api.conversations()) });
}

export function useConversation(id: string | null | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: qk.conversation(id ?? ''),
    queryFn: () => api.conversation(id as string),
    enabled: Boolean(id),
  });
}

export function useViewings() {
  const api = useApi();
  return useQuery({ queryKey: qk.viewings, queryFn: async () => items(await api.viewings()) });
}

export function useSources() {
  const api = useApi();
  return useQuery({ queryKey: qk.sources, queryFn: async () => items(await api.sources()) });
}

export function useConfig() {
  const api = useApi();
  return useQuery({ queryKey: qk.config, queryFn: api.config, staleTime: 60_000 });
}

export function useActivity(params: { types?: string; limit?: number } = {}) {
  const api = useApi();
  return useQuery({
    queryKey: qk.activity(params),
    queryFn: async () => items(await api.activity({ limit: 100, ...params })),
  });
}

export function useStats() {
  const api = useApi();
  return useQuery({ queryKey: qk.stats, queryFn: api.stats, staleTime: 60_000 });
}

export function useDocuments() {
  const api = useApi();
  return useQuery({ queryKey: qk.documents, queryFn: async () => items(await api.documents()) });
}

/* ---------- mutations ---------- */

function useInvalidate() {
  const client = useQueryClient();
  return (...keys: QueryKey[]) => Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

export function usePauseResume() {
  const api = useApi();
  const client = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (pause: boolean) => (pause ? api.pause() : api.resume()),
    onMutate: (pause) => {
      // The header should flip the moment the switch is pressed.
      client.setQueryData(qk.status, (old: unknown) => (old ? { ...(old as object), paused: pause } : old));
    },
    onSettled: () => invalidate(qk.status, qk.config),
  });
}

/** PATCH /config for one section. The daemon validates it and answers with the new config. */
export function usePatchConfig() {
  const api = useApi();
  const client = useQueryClient();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: async ({ section, value }: { section: keyof Config; value: unknown }) => api.patchConfig(section, value),
    onSuccess: (data, { section, value }) => {
      if (data && typeof data === 'object' && 'profile' in data) {
        client.setQueryData(qk.config, data);
      } else {
        client.setQueryData(qk.config, (old: ConfigView | undefined) => (old ? { ...old, [section]: value } : old));
      }
    },
    onSettled: () => invalidate(qk.config, qk.status, qk.sources),
  });
}

export function useSourceMutations() {
  const api = useApi();
  const invalidate = useInvalidate();
  const done = () => invalidate(qk.sources, qk.status, qk.config);
  return {
    patch: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Parameters<typeof api.patchSource>[1] }) => api.patchSource(id, body),
      onSettled: done,
    }),
    test: useMutation({ mutationFn: (id: string) => api.testSource(id), onSettled: done }),
    connect: useMutation({ mutationFn: (id: string) => api.connectSource(id), onSettled: done }),
    poll: useMutation({ mutationFn: (id: string) => api.pollSource(id), onSettled: done }),
  };
}

export function usePropertyMutations() {
  const api = useApi();
  const invalidate = useInvalidate();
  const done = () => invalidate(qk.propertiesAll, ['property'], qk.applications, qk.status);
  return {
    contact: useMutation({ mutationFn: (id: string) => api.contactProperty(id, { force: true }), onSettled: done }),
    skip: useMutation({ mutationFn: (id: string) => api.skipProperty(id), onSettled: done }),
  };
}

export function useWithdrawAll() {
  const api = useApi();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.withdrawAll>[0]) => api.withdrawAll(body),
    onSettled: () => invalidate(qk.applications, qk.status, qk.config, qk.conversations),
  });
}

export function useSendMessage(conversationId: string) {
  const api = useApi();
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (body: { body: string; subject?: string }) => api.sendMessage(conversationId, { ...body, send: true }),
    onSettled: () => invalidate(qk.conversation(conversationId), qk.conversations, qk.applications),
  });
}

export function useDraft() {
  const api = useApi();
  return useMutation({ mutationFn: (body: Parameters<typeof api.draft>[0]) => api.draft(body) });
}

export function useDocumentMutations() {
  const api = useApi();
  const invalidate = useInvalidate();
  return {
    upload: useMutation({ mutationFn: (form: FormData) => api.uploadDocument(form), onSettled: () => invalidate(qk.documents) }),
    remove: useMutation({ mutationFn: (name: string) => api.deleteDocument(name), onSettled: () => invalidate(qk.documents) }),
  };
}
