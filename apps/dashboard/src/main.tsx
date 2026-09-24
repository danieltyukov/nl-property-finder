/*
 * Entry point. Fonts and tokens come from @nlpf/design so the dashboard and
 * the site read the same file; the app's own CSS only uses its variables.
 */
import '@nlpf/design/fonts.css';
import '@nlpf/design/tokens.css';
import './styles/app.css';
import './styles/components.css';
import favicon from '@nlpf/design/logo/favicon.svg?url';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createApi, httpTransport } from './api/client';
import { Root } from './app';

const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (icon) icon.href = favicon;

const container = document.getElementById('root');
if (container) {
  createRoot(container).render(
    <StrictMode>
      <Root api={createApi(httpTransport())} />
    </StrictMode>,
  );
}
