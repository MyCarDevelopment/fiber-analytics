"""Telegram long-polling bot; Python 3.12+, standard library only."""
import json
import os
import sqlite3
import time
import urllib.error
import urllib.request
from calculator import WAREHOUSES, calculate, number

TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
ALLOWED = {int(x.strip()) for x in os.environ.get('ALLOWED_USER_IDS', '').split(',') if x.strip()}
DB = os.environ.get('DATABASE_PATH', 'bot.sqlite3')
QUESTIONS = [
    ('material', 'Название и характеристики волокна, например LM Huaxing белый:'),
    ('warehouse', 'Склад назначения:', WAREHOUSES),
    ('basis', 'Базис: CPT — Иран, FCA — Узбекистан, FOB — Китай.', ('CPT', 'FCA', 'FOB')),
    ('point', 'Укажите пункт CPT / FCA / FOB и дату предложения. Для CPT склад назначения должен совпадать с пунктом включённой доставки.'),
    ('currency', 'Валюта цены:', ('USD', 'CNY')),
    ('price', 'Цена волокна за кг:'),
    ('weight', 'Фактическая загрузка машины/контейнера, кг:'),
    ('usd', 'Курс USD в рублях для расчёта:'),
    ('cny', 'Курс CNY в рублях для расчёта:'),
    ('freight_usd', 'FCA/FOB: вся доставка до выбранного склада в USD за машину/контейнер. Для CPT введите 0 — доставка уже включена.'),
    ('freight_rub', 'FCA/FOB: рублёвая часть доставки за машину/контейнер (без повторения USD-части). Для CPT введите 0.'),
]

def api(method, payload):
    req = urllib.request.Request(f'https://api.telegram.org/bot{TOKEN}/{method}',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=45) as response:
        data = json.load(response)
    if not data.get('ok'):
        raise RuntimeError('Telegram API returned an error')
    return data['result']

def send(chat, text, options=None):
    markup = {'keyboard': [[x] for x in options], 'resize_keyboard': True, 'one_time_keyboard': True} if options else {'remove_keyboard': True}
    api('sendMessage', {'chat_id': chat, 'text': text, 'reply_markup': markup})

def prompt(chat, step):
    q = QUESTIONS[step]
    send(chat, q[1], q[2] if len(q) > 2 else None)

def handle(conn, msg):
    user = msg['from']['id']
    chat = msg['chat']['id']
    text = msg.get('text', '').strip()
    if msg['chat']['type'] != 'private':
        return
    if text == '/id':
        send(chat, f'Ваш Telegram ID: {user}')
        return
    if user not in ALLOWED:
        send(chat, f'Доступ ещё не открыт. Ваш Telegram ID: {user}. Передайте его администратору.')
        return
    if text in ('/start', '/help', '/cancel'):
        conn.execute('DELETE FROM sessions WHERE user_id=?', (user,))
        conn.commit()
        send(chat, 'Аналитика волокна: /calculate — новый расчёт, /cancel — отмена, /id — ваш ID.\nРезультат включает товар и указанную доставку. Пошлины, НДС, сборы, страхование и финансирование отдельно не рассчитываются. Рыночного прогноза в этой версии нет.')
        return
    if text == '/calculate':
        conn.execute('INSERT OR REPLACE INTO sessions VALUES (?, ?, ?)', (user, 0, '{}'))
        conn.commit()
        prompt(chat, 0)
        return
    row = conn.execute('SELECT step, data FROM sessions WHERE user_id=?', (user,)).fetchone()
    if not row:
        send(chat, 'Начните с /calculate')
        return
    step, raw = row
    values = json.loads(raw)
    key = QUESTIONS[step][0]
    try:
        if not text or len(text) > 300:
            raise ValueError('Введите текст длиной от 1 до 300 символов')
        if len(QUESTIONS[step]) > 2 and text not in QUESTIONS[step][2]:
            raise ValueError('Выберите вариант кнопкой')
        if key in ('price', 'weight', 'usd', 'cny', 'freight_usd', 'freight_rub'):
            value = number(text)
            if key in ('weight', 'usd', 'cny') and value == 0:
                raise ValueError('Значение должно быть больше нуля')
            if key.startswith('freight') and values['basis'] == 'CPT' and value != 0:
                raise ValueError('Для CPT введите 0: доставка включена. Для другого пункта нужен отдельный расчёт.')
        values[key] = text
    except ValueError as exc:
        send(chat, str(exc))
        prompt(chat, step)
        return
    step += 1
    if step < len(QUESTIONS):
        conn.execute('UPDATE sessions SET step=?, data=? WHERE user_id=?', (step, json.dumps(values), user))
        conn.commit()
        prompt(chat, step)
        return
    goods, freight, total = calculate(**{k: values[k] for k in ('basis', 'price', 'currency', 'usd', 'cny', 'weight', 'freight_usd', 'freight_rub')})
    result = (f"{values['material']} → {values['warehouse']}\n{values['basis']}: {values['point']}\n"
        f"Товар: {goods:.2f} ₽/кг\nДополнительная доставка: {freight:.2f} ₽/кг\n"
        f"Товар + доставка: {total:.2f} ₽/кг\n")
    if values['basis'] != 'CPT':
        result += f'При росте указанной доставки на 10%: {goods + freight * number("1.1"):.2f} ₽/кг\nПри росте на 20%: {goods + freight * number("1.2"):.2f} ₽/кг\n'
    else:
        result += 'Доставка CPT уже включена; её изменение требует новой цены поставщика.\n'
    result += 'Сценарии не являются прогнозом. Без отдельно рассчитанных пошлин, НДС, сборов, страхования и финансирования.\nНовый расчёт: /calculate'
    send(chat, result)
    conn.execute('DELETE FROM sessions WHERE user_id=?', (user,))
    conn.commit()

def main():
    if not TOKEN or not ALLOWED:
        raise SystemExit('Set TELEGRAM_BOT_TOKEN and ALLOWED_USER_IDS in server environment')
    conn = sqlite3.connect(DB)
    conn.execute('CREATE TABLE IF NOT EXISTS sessions (user_id INTEGER PRIMARY KEY, step INTEGER, data TEXT)')
    conn.execute('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value INTEGER)')
    conn.commit()
    # Do not replace an existing webhook without an explicit operator action.
    if api('getWebhookInfo', {}).get('url'):
        raise SystemExit('Webhook exists. Disable it explicitly before starting polling.')
    while True:
        row = conn.execute("SELECT value FROM settings WHERE key='offset'").fetchone()
        offset = row[0] if row else 0
        try:
            updates = api('getUpdates', {'offset': offset, 'timeout': 30, 'allowed_updates': ['message']})
            for update in updates:
                if 'message' in update:
                    handle(conn, update['message'])
                conn.execute("INSERT OR REPLACE INTO settings VALUES ('offset', ?)", (update['update_id'] + 1,))
                conn.commit()
        except (urllib.error.URLError, TimeoutError, RuntimeError):
            # Never log request URLs: they contain the bot token.
            print('Telegram connection error; retrying', flush=True)
            time.sleep(5)

if __name__ == '__main__':
    main()
