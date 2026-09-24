/*
 * Conversations: every thread with a landlord or agency on any channel, with
 * the agent's reasoning under each message it wrote. You can ask the agent
 * for a draft and send it, or write your own.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import type { Conversation } from '@nlpf/core';
import { useConversation, useConversations, useDraft, useProperty, useSendMessage } from '../api/hooks';
import { useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { useNow } from '../components/state';
import { Button, EmptyState, ErrorNote, Loading, PageHeader } from '../components/ui';
import { ago, eur, fullAddress, street } from '../lib/format';
import { sourceName } from '../lib/labels';
import { Thread } from './PropertyDrawer';

export function ConversationsPage() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const conversations = useConversations();
  const now = useNow(30_000);
  const [q, setQ] = useState('');
  const list = useMemo(
    () =>
      [...(conversations.data ?? [])]
        .filter((c) => {
          const hay = `${c.counterpart.name ?? ''} ${c.counterpart.email ?? ''} ${c.subject ?? ''}`.toLowerCase();
          return !q.trim() || hay.includes(q.trim().toLowerCase());
        })
        .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt)),
    [conversations.data, q],
  );
  const selected = params.id;

  return (
    <div className="page page-wide">
      <PageHeader eyebrow="Conversations" title="Every message, sent and received." lede="Messages the agent wrote carry its reasoning. Open one to read why it said what it said." />
      {conversations.isLoading ? <Loading label="Loading conversations" /> : null}
      {conversations.error ? <ErrorNote error={conversations.error} /> : null}
      {conversations.data && conversations.data.length === 0 ? (
        <EmptyState title="No conversations yet.">
          <p>The first message the agent sends to a landlord starts one here.</p>
        </EmptyState>
      ) : null}
      {conversations.data?.length ? (
        <div className={`split${selected ? ' has-selection' : ''}`}>
          <aside className="split-list card" aria-label="Conversations">
            <label className="search-field">
              <span className="sr-only">Search conversations</span>
              <input className="input" type="search" placeholder="Name, email or subject" value={q} onChange={(e) => setQ(e.currentTarget.value)} />
            </label>
            <ul className="conv-list">
              {list.map((c) => (
                <ConversationRow key={c.id} conversation={c} selected={c.id === selected} now={now} />
              ))}
            </ul>
          </aside>
          <section className="split-detail card" aria-label="Conversation">
            {selected ? (
              <ConversationDetail id={selected} onBack={() => navigate('/conversations')} />
            ) : (
              <div className="split-placeholder">
                <p>Pick a conversation to read it.</p>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

function ConversationRow({ conversation, selected, now }: { conversation: Conversation; selected: boolean; now: number }) {
  const property = useProperty(conversation.propertyId);
  const address = property.data ? street(property.data.property.address, property.data.property.title) : conversation.subject;
  return (
    <li>
      <Link href={`/conversations/${conversation.id}`} className={`conv-row${selected ? ' active' : ''}`} aria-current={selected ? 'true' : undefined}>
        <span className="conv-name">{conversation.counterpart.name ?? conversation.counterpart.email ?? 'Unknown sender'}</span>
        <span className="conv-time mono">{ago(conversation.lastMessageAt, now)}</span>
        <span className="conv-sub">
          {address}
          {conversation.counterpart.sourceId ? ` · ${sourceName(conversation.counterpart.sourceId)}` : ''}
        </span>
        {conversation.unread ? (
          <span className="conv-unread">
            {conversation.unread}
            <span className="sr-only"> unread</span>
          </span>
        ) : null}
      </Link>
    </li>
  );
}

function ConversationDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const conversation = useConversation(id);
  const send = useSendMessage(id);
  const draft = useDraft();
  const { toast } = useFeedback();
  const [body, setBody] = useState('');
  const [instructions, setInstructions] = useState('');

  useEffect(() => {
    setBody('');
    setInstructions('');
  }, [id]);

  if (conversation.isLoading) return <Loading label="Loading the conversation" />;
  if (conversation.error) return <ErrorNote error={conversation.error} />;
  const data = conversation.data;
  if (!data) return null;
  const c = data.conversation;
  const p = data.property;

  return (
    <div className="conv-detail">
      <header className="conv-head">
        <button type="button" className="icon-btn conv-back" aria-label="Back to the list" onClick={onBack}>
          <Icon name="left" />
        </button>
        <div>
          <h2 className="conv-title">{c.counterpart.name ?? c.counterpart.email ?? 'Unknown sender'}</h2>
          <p className="cell-sub">
            {c.counterpart.email ? <span className="mono">{c.counterpart.email}</span> : null}
            {c.counterpart.sourceId ? ` · via ${sourceName(c.counterpart.sourceId)}` : ''}
          </p>
        </div>
        {p ? (
          <Link href={`/properties/${p.id}`} className="conv-property">
            {fullAddress(p.address, p.title)}
            {p.priceEur ? <span className="mono"> · {eur(p.priceEur)}</span> : null}
          </Link>
        ) : null}
      </header>
      <Thread messages={data.messages} />
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          if (!body.trim()) return;
          send.mutate(
            { body: body.trim() },
            {
              onSuccess: () => {
                setBody('');
                toast('Message sent.');
              },
              onError: (error) => toast(`Not sent: ${error.message}`, 'error'),
            },
          );
        }}
      >
        <label className="label" htmlFor="composer-body">
          Your message
        </label>
        <textarea
          id="composer-body"
          className="input mono-area"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          placeholder="Write a reply, or ask the agent for a draft."
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="composer-row">
          <label className="sr-only" htmlFor="composer-instructions">
            Instructions for the draft
          </label>
          <input
            id="composer-instructions"
            className="input"
            placeholder="Instructions for the draft (optional), for example: accept Saturday"
            value={instructions}
            onChange={(e) => setInstructions(e.currentTarget.value)}
          />
          <Button
            icon="sparkle"
            disabled={draft.isPending}
            onClick={() =>
              draft.mutate(
                { conversationId: id, instructions: instructions.trim() || undefined },
                {
                  onSuccess: (result) => {
                    setBody(result.body);
                    if (result.rationale) toast(`Draft ready. ${result.rationale}`);
                  },
                  onError: (error) => toast(`No draft: ${error.message}`, 'error'),
                },
              )
            }
          >
            {draft.isPending ? 'Drafting' : 'Draft with the agent'}
          </Button>
          <Button type="submit" variant="primary" disabled={!body.trim() || send.isPending} shortcut="Ctrl Enter">
            Send
          </Button>
        </div>
        <p className="field-hint">Sent through the same channel as the conversation. The agent never sends BSN or bank details.</p>
      </form>
    </div>
  );
}
