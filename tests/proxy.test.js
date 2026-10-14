import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../api/loyverse.js';

test('server connection status requires login and never returns the secret', async () => {
  const password = process.env.APP_PASSWORD, token = process.env.LOYVERSE_TOKEN;
  try {
    process.env.APP_PASSWORD = 'test-password';
    process.env.LOYVERSE_TOKEN = 'test-server-token';
    const forbidden = await GET(new Request('https://example.test/api/loyverse?path=/ping'));
    assert.equal(forbidden.status, 401);
    const response = await GET(new Request('https://example.test/api/loyverse?path=/ping', { headers: { 'x-clave': 'test-password' } }));
    const body = await response.text();
    assert.deepEqual(JSON.parse(body), { ok: true, loyverseConfigured: true });
    assert.ok(!body.includes('test-server-token'));
    delete process.env.LOYVERSE_TOKEN;
    const unconfigured = await GET(new Request('https://example.test/api/loyverse?path=/ping', { headers: { 'x-clave': 'test-password' } }));
    assert.equal((await unconfigured.json()).loyverseConfigured, false);
  } finally {
    if (password === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = password;
    if (token === undefined) delete process.env.LOYVERSE_TOKEN; else process.env.LOYVERSE_TOKEN = token;
  }
});

test('server token takes priority over an older device token; device-only fallback still works', async () => {
  const password = process.env.APP_PASSWORD, token = process.env.LOYVERSE_TOKEN, fetch = globalThis.fetch;
  try {
    process.env.APP_PASSWORD = 'test-password';
    process.env.LOYVERSE_TOKEN = 'test-server-token';
    let authorization;
    globalThis.fetch = async (url, options) => { authorization = options.headers.Authorization; return Response.json({ receipts: [] }); };
    const request = () => new Request('https://example.test/api/loyverse?path=/receipts', { headers: { 'x-clave': 'test-password', 'x-token': 'test-device-token' } });
    assert.equal((await GET(request())).status, 200);
    assert.equal(authorization, 'Bearer test-server-token');
    delete process.env.LOYVERSE_TOKEN;
    assert.equal((await GET(request())).status, 200);
    assert.equal(authorization, 'Bearer test-device-token');
  } finally {
    globalThis.fetch = fetch;
    if (password === undefined) delete process.env.APP_PASSWORD; else process.env.APP_PASSWORD = password;
    if (token === undefined) delete process.env.LOYVERSE_TOKEN; else process.env.LOYVERSE_TOKEN = token;
  }
});
