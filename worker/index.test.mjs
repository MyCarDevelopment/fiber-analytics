import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { calculate, number, UserSession } from './index.mjs';
const base = { basis: 'FCA', currency: 'USD', price: '.85', usd: '100', cny: '14', weight: '22000', freightUsd: '2250', freightRub: '0' };
test('FCA and mixed FOB freight', () => {
  assert.ok(Math.abs(calculate({ ...base, price: '0.85' }).total - 95.227272727) < 1e-6);
  assert.equal(calculate({ ...base, basis: 'FOB', currency: 'CNY', price: '9.20', weight: '26800', freightUsd: '4250', freightRub: '400000' }).total, 128.8 + 825000 / 26800);
});
test('CPT never adds included freight', () => assert.equal(calculate({ ...base, basis: 'CPT', price: '1.05', freightUsd: '4000' }).total, 105));
test('invalid numbers rejected', () => {
  for (const v of ['NaN', 'Infinity', '-1', '', '1e309']) assert.throws(() => number(v));
  assert.throws(() => number('0', true));
  assert.equal(number('1,05'), 1.05);
});
test('webhook rejects missing secret and malformed body', async () => {
  const env = { WEBHOOK_SECRET: 'secret', TELEGRAM_BOT_TOKEN: 'token' };
  assert.equal((await worker.fetch(new Request('https://test/telegram', { method: 'POST', body: '{}' }), env)).status, 403);
  assert.equal((await worker.fetch(new Request('https://test/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' }, body: 'bad' }), env)).status, 400);
});
test('guided CPT flow, invalid input, duplicate delivery and allowlist', async () => {
  let state;
  const sent = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true, result: {} })); };
  try {
    const ctx = { blockConcurrencyWhile: fn => fn(), storage: { get: async () => state, put: async (_, v) => { state = v; } } };
    const session = new UserSession(ctx, { TELEGRAM_BOT_TOKEN: 'test', ALLOWED_USER_IDS: '42' });
    let id = 0;
    const update = (text, user = 42, updateId = ++id) => session.fetch(new Request('https://session/update', { method: 'POST', body: JSON.stringify({ update_id: updateId, message: { from: { id: user }, chat: { id: user, type: 'private' }, text } }) }));
    for (const text of ['/calculate', 'LM', 'Ратмирово', 'CPT', 'Ратмирово, дата тест', 'USD', '1.05', '20000', '100', '14']) assert.equal((await update(text)).status, 200);
    assert.match(sent.at(-1).text, /105.00 ₽\/кг/);
    assert.match(sent.at(-1).text, /Фрахт уже включён/);
    const count = sent.length;
    await update('14', 42, id);
    assert.equal(sent.length, count);
    await update('/calculate');
    await update('LM');
    const step = state.session.step;
    await update('несуществующий склад');
    assert.equal(state.session.step, step);
    await update('/calculate', 43);
    assert.match(sent.at(-1).text, /Доступ закрыт/);
  } finally { globalThis.fetch = original; }
});
