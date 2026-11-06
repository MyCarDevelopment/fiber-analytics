from decimal import Decimal, InvalidOperation

WAREHOUSES = ('Екатеринбург', 'Новосибирск', 'Ратмирово', 'Краснодар', 'Иваново')

def number(value):
    try:
        result = Decimal(str(value).replace(',', '.').replace(' ', ''))
    except InvalidOperation:
        raise ValueError('Введите число, например 1,05') from None
    if not result.is_finite() or result < 0:
        raise ValueError('Нужно конечное неотрицательное число')
    return result

def calculate(basis, price, currency, usd, cny, weight, freight_usd, freight_rub):
    if basis not in ('CPT', 'FCA', 'FOB') or currency not in ('USD', 'CNY'):
        raise ValueError('Неизвестный базис или валюта')
    price, usd, cny, weight, freight_usd, freight_rub = map(number, (price, usd, cny, weight, freight_usd, freight_rub))
    if weight == 0 or usd == 0 or cny == 0:
        raise ValueError('Загрузка и курсы должны быть больше нуля')
    goods = price * (usd if currency == 'USD' else cny)
    # For CPT the quoted price already includes delivery to the named point.
    freight = Decimal(0) if basis == 'CPT' else (freight_usd * usd + freight_rub) / weight
    return goods, freight, goods + freight
