import assert from 'node:assert/strict';

import { createApp, notifyAdmin } from '../app.js';
import { createSqlMock, startServer } from './helpers.mjs';
import { test } from './runner.mjs';

function makeAnthropicMock(handler) {
  return {
    messages: {
      create: handler,
    },
  };
}

test('chat rejects empty message arrays', async () => {
  const app = createApp({
    anthropic: makeAnthropicMock(async () => assert.fail('anthropic should not be called')),
    sql: createSqlMock(async () => []),
    env: { ADMIN_SECRET: 'secret' },
  });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [] }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: 'messages required' });
  } finally {
    await server.close();
  }
});

test('chat forwards the professional context prompt and returns model text', async () => {
  let payload;
  const app = createApp({
    anthropic: makeAnthropicMock(async request => {
      payload = request;
      return { content: [{ text: '{"message":"What happens most often?","readyToGenerate":false}' }] };
    }),
    sql: createSqlMock(async () => []),
    env: { ADMIN_SECRET: 'secret' },
  });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: 'professional',
        messages: [{ role: 'user', content: 'I lose time on intake.' }],
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { text: '{"message":"What happens most often?","readyToGenerate":false}' });
    assert.equal(payload.model, 'claude-sonnet-4-5');
    assert.match(payload.system, /professional context/i);
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'I lose time on intake.' }]);
  } finally {
    await server.close();
  }
});

test('generate composes the transcript and returns the spec', async () => {
  let payload;
  const app = createApp({
    anthropic: makeAnthropicMock(async request => {
      payload = request;
      return { content: [{ text: '# Intake App\n\nSpec body' }] };
    }),
    sql: createSqlMock(async () => []),
    env: { ADMIN_SECRET: 'secret' },
  });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        context: 'personal',
        messages: [
          { role: 'user', content: 'I forget bills.' },
          { role: 'assistant', content: 'What do you use now?' },
        ],
      }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, { spec: '# Intake App\n\nSpec body' });
    assert.equal(payload.max_tokens, 2500);
    assert.match(payload.system, /This is a personal use case/);
    assert.match(payload.messages[0].content, /User: I forget bills\./);
    assert.match(payload.messages[0].content, /AppForge: What do you use now\?/);
  } finally {
    await server.close();
  }
});

test('lead capture persists the lead and triggers admin notification when SMTP is configured', async () => {
  const sqlCalls = [];
  const sentMail = [];
  const sql = createSqlMock(async (_strings, values) => {
    sqlCalls.push(values);
    return [{ id: 17, created_at: '2026-03-21T00:00:00Z' }];
  });
  const app = createApp({
    anthropic: makeAnthropicMock(async () => assert.fail('anthropic should not be called')),
    sql,
    env: {
      ADMIN_SECRET: 'secret',
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '465',
      SMTP_USER: 'sender@example.com',
      SMTP_PASS: 'password',
      NOTIFICATION_EMAIL: 'ops@example.com',
      APP_URL: 'https://appforge.test',
    },
    mailer: {
      createTransport: config => {
        assert.equal(config.host, 'smtp.example.com');
        return {
          sendMail: async message => {
            sentMail.push(message);
          },
        };
      },
    },
  });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Jordan',
        email: 'jordan@example.com',
        context: 'professional',
        specMarkdown: '# Spec',
        transcript: [{ role: 'user', content: 'Pain point' }],
      }),
    });
    const body = await response.json();
    await new Promise(resolve => setTimeout(resolve, 0));

    assert.equal(response.status, 200);
    assert.deepEqual(body, { ok: true, leadId: 17 });
    assert.deepEqual(sqlCalls[0], [
      'Jordan',
      'jordan@example.com',
      'professional',
      '# Spec',
      JSON.stringify([{ role: 'user', content: 'Pain point' }]),
    ]);
    assert.equal(sentMail.length, 1);
    assert.match(sentMail[0].subject, /Jordan/);
    assert.match(sentMail[0].text, /New build request #17/);
    assert.match(sentMail[0].text, /https:\/\/appforge\.test\/admin/);
  } finally {
    await server.close();
  }
});

test('lead capture validates required fields', async () => {
  const app = createApp({
    anthropic: makeAnthropicMock(async () => assert.fail('anthropic should not be called')),
    sql: createSqlMock(async () => []),
    env: { ADMIN_SECRET: 'secret' },
  });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'jordan@example.com' }),
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body, { error: 'email and specMarkdown required' });
  } finally {
    await server.close();
  }
});

test('admin routes reject missing or invalid secrets', async () => {
  const app = createApp({
    anthropic: makeAnthropicMock(async () => assert.fail('anthropic should not be called')),
    sql: createSqlMock(async () => []),
    env: { ADMIN_SECRET: 'secret' },
  });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/admin/leads`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.deepEqual(body, { error: 'Unauthorized' });
  } finally {
    await server.close();
  }
});

test('admin lead routes list, fetch, and update leads when authorized', async () => {
  const queries = [];
  const sql = createSqlMock(async (strings, values) => {
    const text = strings.join(' ');
    queries.push({ text, values });

    if (text.includes('ORDER BY created_at DESC')) {
      return [{ id: 1, email: 'a@example.com', spec_preview: '# Spec' }];
    }
    if (text.includes('SELECT * FROM leads WHERE id =')) {
      return [{ id: 12, email: 'lead@example.com', status: 'new' }];
    }
    if (text.includes('UPDATE leads SET')) {
      return [{ id: 12, status: 'won', notes: 'Priority account' }];
    }
    return [];
  });
  const app = createApp({
    anthropic: makeAnthropicMock(async () => assert.fail('anthropic should not be called')),
    sql,
    env: { ADMIN_SECRET: 'secret' },
  });
  const server = await startServer(app);

  try {
    const listResponse = await fetch(`${server.baseUrl}/api/admin/leads`, {
      headers: { 'x-admin-secret': 'secret' },
    });
    const listBody = await listResponse.json();

    const detailResponse = await fetch(`${server.baseUrl}/api/admin/leads/12?secret=secret`);
    const detailBody = await detailResponse.json();

    const patchResponse = await fetch(`${server.baseUrl}/api/admin/leads/12`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-admin-secret': 'secret',
      },
      body: JSON.stringify({ status: 'won', notes: 'Priority account' }),
    });
    const patchBody = await patchResponse.json();

    assert.equal(listResponse.status, 200);
    assert.deepEqual(listBody, [{ id: 1, email: 'a@example.com', spec_preview: '# Spec' }]);
    assert.equal(detailResponse.status, 200);
    assert.deepEqual(detailBody, { id: 12, email: 'lead@example.com', status: 'new' });
    assert.equal(patchResponse.status, 200);
    assert.deepEqual(patchBody, { id: 12, status: 'won', notes: 'Priority account' });
    assert.equal(queries.length, 3);
    assert.deepEqual(queries[1].values, ['12']);
    assert.deepEqual(queries[2].values, ['won', 'Priority account', '12']);
  } finally {
    await server.close();
  }
});

test('admin lead detail returns 404 when the lead does not exist', async () => {
  const app = createApp({
    anthropic: makeAnthropicMock(async () => assert.fail('anthropic should not be called')),
    sql: createSqlMock(async () => []),
    env: { ADMIN_SECRET: 'secret' },
  });
  const server = await startServer(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/admin/leads/404`, {
      headers: { 'x-admin-secret': 'secret' },
    });
    const body = await response.json();

    assert.equal(response.status, 404);
    assert.deepEqual(body, { error: 'Not found' });
  } finally {
    await server.close();
  }
});

test('notifyAdmin returns early when SMTP is not configured', async () => {
  let transporterCreated = false;

  await notifyAdmin({
    leadId: 9,
    name: 'Jordan',
    email: 'jordan@example.com',
    spec: '# Spec',
    env: {},
    mailer: {
      createTransport: () => {
        transporterCreated = true;
        return { sendMail: async () => {} };
      },
    },
  });

  assert.equal(transporterCreated, false);
});
