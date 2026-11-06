// Called by GitHub Actions. Secrets are never printed.
const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: cfToken, TELEGRAM_BOT_TOKEN: token, WEBHOOK_SECRET: secret } = process.env;
if (![account, cfToken, token, secret].every(Boolean)) throw Error('Missing deployment secrets');
if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw Error('WEBHOOK_SECRET: use 16–256 letters, digits, underscores or hyphens');
const cf = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/subdomain`, { headers: { Authorization: `Bearer ${cfToken}` } });
const subdomain = await cf.json();
if (!cf.ok || !subdomain.success || !subdomain.result?.subdomain) throw Error('Cannot read workers.dev subdomain; enable it in Cloudflare');
const url = `https://fiberanalytics-bot.${subdomain.result.subdomain}.workers.dev/telegram`;
async function telegram(method, data) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const json = await r.json();
  if (!r.ok || !json.ok) throw Error(`Telegram ${method} failed`);
  return json.result;
}
const old = await telegram('getWebhookInfo', {});
if (old.url && old.url !== url) throw Error('Another webhook exists. Check and disable it before switching.');
await telegram('setWebhook', { url, secret_token: secret, allowed_updates: ['message'], max_connections: 1 });
const info = await telegram('getWebhookInfo', {});
if (info.url !== url) throw Error('Webhook verification failed');
console.log('Webhook configured successfully.');
