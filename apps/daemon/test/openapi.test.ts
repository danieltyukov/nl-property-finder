import { expect, test } from 'vitest';
import { ROUTES, API_PREFIX } from '@nlpf/core';
import { buildOpenApi } from '../src/api/openapi.js';

test('every route appears with its method, and bodies carry zod-derived schemas', () => {
  const doc = buildOpenApi('0.1.0') as { paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { properties?: object } }> } }>> };
  for (const r of Object.values(ROUTES)) {
    const path = API_PREFIX + r.path.replace(/:(\w+)/g, '{$1}');
    expect(doc.paths[path]?.[r.method.toLowerCase()], `${r.method} ${path}`).toBeDefined();
  }
  const resolve = doc.paths[`${API_PREFIX}/tasks/{id}/resolve`]!.post!;
  expect(resolve.requestBody?.content['application/json']?.schema.properties).toHaveProperty('action');
});
