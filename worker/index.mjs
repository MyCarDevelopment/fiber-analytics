export const warehouses = ['Екатеринбург', 'Новосибирск', 'Ратмирово', 'Краснодар', 'Иваново'];
export function number(text, positive = false) {
  const s = String(text).trim().replaceAll(' ', '').replace(',', '.');
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) throw Error('Введите неотрицательное число, например 1,05.');
  const n = Number(s);
  if (!Number.isFinite(n) || n > 1e12 || (positive && n === 0)) throw Error('Некорректное число. Загрузка и курсы должны быть больше нуля.');
  return n;
}
export function calculate(v) {
  if (!['CPT', 'FCA', 'FOB'].includes(v.basis) || !['USD', 'CNY'].includes(v.currency)) throw Error('Неверный базис или валюта');
  const goods = number(v.price) * number(v.currency === 'USD' ? v.usd : v.cny, true);
  const weight = number(v.weight, true);
  const freight = v.basis === 'CPT' ? 0 : (number(v.freightUsd) * number(v.usd, true) + number(v.freightRub)) / weight;
  return { goods, freight, total: goods + freight };
}
const questions = [
  ['material', 'Название и характеристики волокна:'],
  ['warehouse', 'Выберите склад:', warehouses],
  ['basis', 'Выберите базис: Иран CPT, Узбекистан FCA, Китай FOB.', ['CPT', 'FCA', 'FOB']],
  ['point', 'Укажите пункт CPT/FCA/FOB и дату предложения. Для CPT выбранный склад должен совпадать с пунктом включённой доставки.'],
  ['currency', 'Валюта цены за кг:', ['USD', 'CNY']],
  ['price', 'Цена за кг:'],
  ['weight', 'Загрузка машины/контейнера, кг:'],
  ['usd', 'Курс USD/RUB для расчёта:'],
  ['cny', 'Курс CNY/RUB для расчёта:'],
  ['freightUsd', 'Полная USD-часть доставки до склада за машину/контейнер:'],
  ['freightRub', 'Полная RUB-часть доставки до склада за машину/контейнер (не дублируйте USD-часть; 0, если нет):'],
];
const help = 'Аналитика волокна\n/calculate — расчёт\n/cancel — отмена\n/id — ваш Telegram ID\nВ расчёте: товар и введённая доставка. Без пошлин, НДС, сборов, страхования и финансирования. Автоматических рыночных прогнозов пока нет.';
async function telegram(env, method, data) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const result = await response.json();
  if (!response.ok || !result.ok) throw Error('Telegram request failed');
  return result.result;
}
function message(text, options) {
  return { text, reply_markup: options ? { keyboard: options.map(x => [x]), resize_keyboard: true, one_time_keyboard: true } : { remove_keyboard: true } };
}
function prompt(step) { const [, text, options] = questions[step]; return message(text, options); }
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') return new Response('Fiber Analytics worker is running.');
    if (url.pathname !== '/telegram' || request.method !== 'POST') return new Response('Not found', { status: 404 });
    if (!env.WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) return new Response('Not configured', { status: 503 });
    if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) return new Response('Forbidden', { status: 403 });
    if (Number(request.headers.get('content-length')) > 65536) return new Response('Too large', { status: 413 });
    let update;
    try { const raw = await request.text(); if (raw.length > 65536) return new Response('Too large', { status: 413 }); update = JSON.parse(raw); }
    catch { return new Response('Invalid JSON', { status: 400 }); }
    const m = update.message;
    if (!Number.isSafeInteger(update.update_id) || !m?.from?.id || m.chat?.type !== 'private' || typeof m.text !== 'string') return new Response('OK');
    const id = env.SESSIONS.idFromName(String(m.from.id));
    return env.SESSIONS.get(id).fetch('https://session/update', { method: 'POST', body: JSON.stringify(update) });
  },
};
export class UserSession {
  constructor(ctx, env) { this.ctx = ctx; this.env = env; }
  async fetch(request) {
    const update = await request.json();
    // Serialize updates for each user, including Telegram delivery and persistent state.
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const saved = await this.ctx.storage.get('state') || { last: -1, session: null };
        if (update.update_id <= saved.last) return new Response('OK');
        const m = update.message;
        const text = m.text.trim();
        const allowed = String(this.env.ALLOWED_USER_IDS || '').split(',').map(s => s.trim());
        let reply;
        let next = saved.session ? structuredClone(saved.session) : null;
        if (text === '/id') reply = message(`Ваш Telegram ID: ${m.from.id}`);
        else if (!allowed.includes(String(m.from.id))) reply = message(`Доступ закрыт. Ваш Telegram ID: ${m.from.id}. Передайте администратору.`);
        else if (['/start', '/help', '/cancel'].includes(text)) { next = null; reply = message(help); }
        else if (text === '/calculate') { next = { step: 0, values: {} }; reply = prompt(0); }
        else if (!next) reply = message('Начните с /calculate');
        else {
          const [key, , options] = questions[next.step];
          try {
            if (!text || text.length > 300) throw Error('Введите от 1 до 300 символов.');
            if (options && !options.includes(text)) throw Error('Выберите вариант кнопкой.');
            if (['price', 'weight', 'usd', 'cny', 'freightUsd', 'freightRub'].includes(key)) number(text, ['weight', 'usd', 'cny'].includes(key));
            next.values[key] = text;
            next.step++;
            // CPT already includes freight: never ask to add it again.
            if (next.step === 9 && next.values.basis === 'CPT') { next.values.freightUsd = '0'; next.values.freightRub = '0'; next.step = 11; }
            if (next.step < questions.length) reply = prompt(next.step);
            else {
              const v = next.values, r = calculate(v);
              let result = `${v.material} → ${v.warehouse}\n${v.basis}: ${v.point}\nТовар${v.basis === 'CPT' ? ' с включённой доставкой CPT' : ''}: ${r.goods.toFixed(2)} ₽/кг\nДоп. доставка: ${r.freight.toFixed(2)} ₽/кг\nИтого товар + доставка: ${r.total.toFixed(2)} ₽/кг\n`;
              result += v.basis === 'CPT' ? 'Фрахт уже включён. При его изменении нужна новая котировка поставщика.\n' : `Доставка +10%: ${(r.goods + r.freight * 1.1).toFixed(2)} ₽/кг\nДоставка +20%: ${(r.goods + r.freight * 1.2).toFixed(2)} ₽/кг\n`;
              reply = message(result + 'Без пошлин, НДС, сборов, страхования и финансирования. Сценарии — не прогноз.\nНовый расчёт: /calculate');
              next = null;
            }
          } catch (e) { next = saved.session; reply = message(e.message + '\n' + questions[next.step][1], questions[next.step][2]); }
        }
        // An ambiguous network failure can repeat a response on Telegram retry, but does not advance state twice.
        await telegram(this.env, 'sendMessage', { chat_id: m.chat.id, ...reply });
        await this.ctx.storage.put('state', { last: update.update_id, session: next });
        return new Response('OK');
      } catch { return new Response('Temporary failure', { status: 503 }); }
    });
  }
}
