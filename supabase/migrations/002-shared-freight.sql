-- Upgrade existing installations. Preserves supplier/quote/rate history.
-- Run in Supabase SQL Editor. Safe to reapply.
begin;
alter table public.fa_settings add column if not exists workflow_version integer not null default 2;
alter table public.fa_routes add column if not exists kind text check(kind in ('sea','FCA'));
alter table public.fa_routes add column if not exists loading_point text check(length(loading_point) between 1 and 200);
alter table public.fa_suppliers alter column warehouse drop not null;
alter table public.fa_quotes alter column cny_rate drop not null;

create or replace function public.fa_card_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare r text:=public.fa_role(); me text:=lower(auth.jwt()->>'email'); dest text;
begin
 if r is null then raise exception 'Нет доступа'; end if;
 if tg_table_name='fa_suppliers' then
  if r not in ('manager','lead') then raise exception 'Нет права редактирования поставщика'; end if;
  if tg_op='UPDATE' then
   if r<>'lead' and (old.owner_email<>me or new.owner_email<>old.owner_email) then raise exception 'Чужой ответственный'; end if;
  elsif r<>'lead' and new.owner_email<>me then raise exception 'Назначить другого ответственного может руководитель'; end if;
  if not exists(select 1 from public.fa_members where email=new.owner_email and active and role in ('manager','lead')) then raise exception 'Ответственный должен быть активным менеджером или руководителем'; end if;
  if (new.basis='CPT' and new.country<>'Иран') or (new.basis='FCA' and new.country<>'Узбекистан') or (new.country='Иран' and new.basis<>'CPT') or (new.country='Узбекистан' and new.basis<>'FCA') or (new.country='Китай' and new.basis<>'FOB') then raise exception 'Иран — CPT, Узбекистан — FCA, Китай — FOB'; end if;
  if new.route_id is not null then
   select warehouse into dest from public.fa_routes where id=new.route_id and active;
   if dest is null or dest is distinct from new.warehouse then raise exception 'Маршрут не соответствует складу'; end if;
  end if;
 else
  -- Shared routes: any active employee may maintain them; author is audited.
  if tg_op='INSERT' and r<>'lead' and new.owner_email<>me then raise exception 'Автор нового маршрута должен совпадать с пользователем'; end if;
  if tg_op='UPDATE' and r<>'lead' and new.owner_email<>old.owner_email then raise exception 'Назначение автора меняет руководитель'; end if;
  if tg_op='INSERT' then
   if not exists(select 1 from public.fa_members where email=new.owner_email and active) then raise exception 'Автор должен быть активным сотрудником'; end if;
  elsif new.owner_email<>old.owner_email then
   if not exists(select 1 from public.fa_members where email=new.owner_email and active) then raise exception 'Новый автор должен быть активным сотрудником'; end if;
  end if;
  if new.kind is null or new.loading_point is null then raise exception 'Укажите тип фрахта и пункт отгрузки'; end if;
  if tg_op='UPDATE' then
   if exists(select 1 from public.fa_freight_rates where route_id=old.id) and (new.origin<>old.origin or new.warehouse<>old.warehouse or (old.kind is not null and new.kind is distinct from old.kind) or (old.loading_point is not null and new.loading_point is distinct from old.loading_point)) then raise exception 'Для другого направления создайте новый маршрут'; end if;
  end if;
 end if;
 if tg_op='UPDATE' then new.id:=old.id;new.created_at:=old.created_at;else new.created_at:=clock_timestamp();end if;
 new.updated_at:=clock_timestamp();new.updated_by:=me;
 return new;
end;
$$;

create or replace function public.fa_history_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare r text:=public.fa_role();me text:=lower(auth.jwt()->>'email');s public.fa_suppliers;route public.fa_routes;previous public.fa_quotes;
begin
 if r is null then raise exception 'Нет доступа'; end if;
 if new.quote_date>current_date+1 then raise exception 'Дата слишком далеко в будущем'; end if;
 new.created_by:=me;new.created_at:=clock_timestamp();
 if tg_table_name='fa_quotes' then
  if r not in ('manager','lead') then raise exception 'Нет права внесения цены поставщика'; end if;
  select * into s from public.fa_suppliers where id=new.supplier_id for update;
  if not found or not s.active or (r<>'lead' and s.owner_email<>me) then raise exception 'Нет доступа к поставщику'; end if;
  if (s.basis='CPT' and s.country<>'Иран') or (s.basis='FCA' and s.country<>'Узбекистан') then raise exception 'Проверьте страну и базис в карточке поставщика'; end if;
  if new.card_version is distinct from s.updated_at then raise exception 'Условия карточки изменились. Обновите данные и повторите'; end if;
  if s.currency='CNY' and new.cny_rate is null then raise exception 'Укажите курс юаня'; end if;
  if s.currency='USD' then new.cny_rate:=null;end if;
  new.snapshot:=public.fa_terms(s);new.freight_rate_id:=null;
  if s.basis<>'CPT' and s.route_id is not null then
   select id into new.freight_rate_id from public.fa_freight_rates where route_id=s.route_id and quote_date<=new.quote_date order by quote_date desc,created_at desc,id desc limit 1;
  end if;
  if new.source_quote_id is not null then
   select * into previous from public.fa_quotes where supplier_id=s.id order by quote_date desc,created_at desc,id desc limit 1;
   if previous.id is distinct from new.source_quote_id or previous.snapshot<>new.snapshot or new.price<>previous.price or new.usd_rate<>previous.usd_rate or (s.currency='CNY' and new.cny_rate is distinct from previous.cny_rate) or new.vat_rate<>previous.vat_rate or new.quote_date<previous.quote_date then raise exception 'Условия изменились. Обновите котировку обычным способом'; end if;
  end if;
 else
  select * into route from public.fa_routes where id=new.route_id for update;
  if not found or not route.active then raise exception 'Маршрут недоступен'; end if;
  if route.kind is null or route.loading_point is null then raise exception 'Сначала укажите тип и пункт отгрузки маршрута'; end if;
  if new.card_version is distinct from route.updated_at then raise exception 'Маршрут изменился. Обновите данные и повторите'; end if;
  new.snapshot:=to_jsonb(route)-array['owner_email','created_at','updated_at','updated_by','active'];
 end if;
 return new;
end;
$$;

drop policy if exists fa_routes_add on public.fa_routes;
drop policy if exists fa_routes_edit on public.fa_routes;
drop policy if exists fa_rates_add on public.fa_freight_rates;
create policy fa_routes_add on public.fa_routes for insert to authenticated with check(public.fa_role() is not null and (owner_email=lower(auth.jwt()->>'email') or public.fa_role()='lead'));
create policy fa_routes_edit on public.fa_routes for update to authenticated using(public.fa_role() is not null) with check(public.fa_role() is not null);
create policy fa_rates_add on public.fa_freight_rates for insert to authenticated with check(public.fa_role() is not null and exists(select 1 from public.fa_routes where id=route_id and active));
update public.fa_settings set workflow_version=2;
-- Existing routes deliberately retain null kind/loading_point until classified by a person.
-- Do not infer transport type or departure point from free text.
commit;
