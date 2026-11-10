-- Apply once in the Supabase SQL Editor. No email addresses or secrets in this file.
begin;
create table public.fa_members (
 email text primary key check (email = lower(trim(email)) and position('@' in email)>1),
 name text not null check(length(name) between 1 and 100),
 role text not null check(role in ('manager','lead','sales')),
 active boolean not null default true
);
create function public.fa_role() returns text language sql stable security definer set search_path='' as $$
 select m.role from public.fa_members m where m.email=lower(auth.jwt()->>'email') and m.active
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null and lower(u.email)=m.email);
$$;
revoke all on function public.fa_role() from public,anon;
grant execute on function public.fa_role() to authenticated;
create table public.fa_settings (
 id boolean primary key default true check(id), stale_days integer not null default 7 check(stale_days between 1 and 90)
);
insert into public.fa_settings default values;
create table public.fa_routes (
 id uuid primary key default gen_random_uuid(), owner_email text not null references public.fa_members(email),
 origin text not null check(length(origin) between 1 and 200),
 warehouse text not null check(warehouse in ('Екатеринбург','Новосибирск','Ратмирово','Краснодар','Иваново')),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 updated_by text not null default '', active boolean not null default true
);
create table public.fa_suppliers (
 id uuid primary key default gen_random_uuid(), owner_email text not null references public.fa_members(email),
 name text not null check(length(name) between 1 and 100), material text not null check(length(material) between 1 and 160),
 fiber_group text not null check(fiber_group in ('LM / БИК','Конжугейт HCS / HC','Регуляр','Вискоза','Другое')),
 country text not null check(length(country) between 1 and 80),
 basis text not null check(basis in ('CPT','FCA','FOB')), currency text not null check(currency in ('USD','CNY')),
 weight numeric not null check(weight>0 and weight<=100000), point text not null check(length(point) between 1 and 200),
 warehouse text not null check(warehouse in ('Екатеринбург','Новосибирск','Ратмирово','Краснодар','Иваново')),
 route_id uuid references public.fa_routes(id), active boolean not null default true,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), updated_by text not null default '',
 check(basis <> 'CPT' or route_id is null)
);
create table public.fa_freight_rates (
 id uuid primary key default gen_random_uuid(), route_id uuid not null references public.fa_routes(id),
 quote_date date not null, card_version timestamptz not null, usd numeric not null check(usd>=0 and usd<=10000000),
 rub numeric not null check(rub>=0 and rub<=1000000000),
 status text not null check(status in ('Ориентир','Предложение','Факт')),
 note text not null default '' check(length(note)<=1000),
 snapshot jsonb not null default '{}', created_by text not null default '', created_at timestamptz not null default now()
);
create table public.fa_quotes (
 id uuid primary key default gen_random_uuid(), supplier_id uuid not null references public.fa_suppliers(id),
 quote_date date not null, card_version timestamptz not null, price numeric not null check(price>0 and price<=1000000),
 usd_rate numeric not null check(usd_rate>0 and usd_rate<=1000000),
 cny_rate numeric not null check(cny_rate>0 and cny_rate<=1000000),
 vat_rate numeric not null default 0 check(vat_rate>=0 and vat_rate<=100),
 note text not null default '' check(length(note)<=1000),
 snapshot jsonb not null default '{}', freight_rate_id uuid references public.fa_freight_rates(id),
 source_quote_id uuid references public.fa_quotes(id),
 created_by text not null default '', created_at timestamptz not null default now()
);
create index on public.fa_quotes(supplier_id,quote_date desc,created_at desc);
create index on public.fa_freight_rates(route_id,quote_date desc,created_at desc);
create index on public.fa_suppliers(owner_email);

-- Store server-authoritative owners, conditions, author and timestamps.
create function public.fa_card_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare r text:=public.fa_role(); me text:=lower(auth.jwt()->>'email'); dest text;
begin
 if r is null or r not in ('manager','lead') then raise exception 'Нет права редактирования'; end if;
 if tg_op='UPDATE' then
  if r<>'lead' and (old.owner_email<>me or new.owner_email<>old.owner_email) then raise exception 'Чужой ответственный'; end if;
  new.id:=old.id; new.created_at:=old.created_at;
 elsif r<>'lead' and new.owner_email<>me then raise exception 'Назначить другого ответственного может руководитель';
 end if;
 if not exists(select 1 from public.fa_members where email=new.owner_email and active and role in ('manager','lead')) then raise exception 'Ответственный должен быть активным менеджером или руководителем'; end if;
 if tg_table_name='fa_routes' and tg_op='UPDATE' then
  if (new.origin<>old.origin or new.warehouse<>old.warehouse) and exists(select 1 from public.fa_freight_rates where route_id=old.id) then raise exception 'Для другого направления создайте новый маршрут'; end if;
 end if;
 if tg_table_name='fa_suppliers' then
  if new.route_id is not null then
   select warehouse into dest from public.fa_routes where id=new.route_id and active;
   if dest is null or dest<>new.warehouse then raise exception 'Маршрут не соответствует складу'; end if;
  end if;
 end if;
 new.updated_at:=clock_timestamp(); new.updated_by:=me;
 if tg_op='INSERT' then new.created_at:=new.updated_at; end if;
 return new;
end;
$$;
create trigger fa_supplier_guard before insert or update on public.fa_suppliers for each row execute function public.fa_card_guard();
create trigger fa_route_guard before insert or update on public.fa_routes for each row execute function public.fa_card_guard();
create function public.fa_terms(s public.fa_suppliers) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(s)-array['owner_email','created_at','updated_at','updated_by','active'];
$$;
create function public.fa_history_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare r text:=public.fa_role(); me text:=lower(auth.jwt()->>'email'); s public.fa_suppliers; route public.fa_routes; previous public.fa_quotes;
begin
 if r is null or r not in ('manager','lead') then raise exception 'Нет права внесения котировки'; end if;
 -- One-day tolerance covers staff in different time zones.
 if new.quote_date>current_date+1 then raise exception 'Дата слишком далеко в будущем'; end if;
 new.created_by:=me; new.created_at:=clock_timestamp();
 if tg_table_name='fa_quotes' then
  select * into s from public.fa_suppliers where id=new.supplier_id for update;
  if not found or not s.active or (r<>'lead' and s.owner_email<>me) then raise exception 'Нет доступа к поставщику'; end if;
  if new.card_version is distinct from s.updated_at then raise exception 'Условия карточки изменились. Обновите данные и повторите'; end if;
  new.snapshot:=public.fa_terms(s);
  new.freight_rate_id:=null;
  if s.basis<>'CPT' and s.route_id is not null then
   select id into new.freight_rate_id from public.fa_freight_rates where route_id=s.route_id and quote_date<=new.quote_date order by quote_date desc,created_at desc,id desc limit 1;
  end if;
  if new.source_quote_id is not null then
   select * into previous from public.fa_quotes where supplier_id=s.id order by quote_date desc,created_at desc,id desc limit 1;
   if previous.id is distinct from new.source_quote_id or previous.snapshot<>new.snapshot or new.price<>previous.price or new.usd_rate<>previous.usd_rate or new.cny_rate<>previous.cny_rate or new.vat_rate<>previous.vat_rate or new.quote_date<previous.quote_date then raise exception 'Условия изменились. Обновите котировку обычным способом'; end if;
  end if;
 else
  select * into route from public.fa_routes where id=new.route_id for update;
  if not found or not route.active or (r<>'lead' and route.owner_email<>me) then raise exception 'Нет доступа к маршруту'; end if;
  if new.card_version is distinct from route.updated_at then raise exception 'Маршрут изменился. Обновите данные и повторите'; end if;
  new.snapshot:=to_jsonb(route)-array['owner_email','created_at','updated_at','updated_by','active'];
 end if;
 return new;
end;
$$;
create trigger fa_quote_guard before insert on public.fa_quotes for each row execute function public.fa_history_guard();
create trigger fa_rate_guard before insert on public.fa_freight_rates for each row execute function public.fa_history_guard();

alter table public.fa_members enable row level security;
alter table public.fa_settings enable row level security;
alter table public.fa_suppliers enable row level security;
alter table public.fa_routes enable row level security;
alter table public.fa_quotes enable row level security;
alter table public.fa_freight_rates enable row level security;
create policy fa_members_read on public.fa_members for select to authenticated using(public.fa_role() is not null);
create policy fa_settings_read on public.fa_settings for select to authenticated using(public.fa_role() is not null);
create policy fa_settings_write on public.fa_settings for update to authenticated using(public.fa_role()='lead') with check(public.fa_role()='lead');
create policy fa_suppliers_read on public.fa_suppliers for select to authenticated using(public.fa_role() in ('lead','sales') or (public.fa_role()='manager' and owner_email=lower(auth.jwt()->>'email')));
create policy fa_suppliers_add on public.fa_suppliers for insert to authenticated with check(public.fa_role()='lead' or (public.fa_role()='manager' and owner_email=lower(auth.jwt()->>'email')));
create policy fa_suppliers_edit on public.fa_suppliers for update to authenticated using(public.fa_role()='lead' or (public.fa_role()='manager' and owner_email=lower(auth.jwt()->>'email'))) with check(public.fa_role()='lead' or (public.fa_role()='manager' and owner_email=lower(auth.jwt()->>'email')));
create policy fa_routes_read on public.fa_routes for select to authenticated using(public.fa_role() is not null);
create policy fa_routes_add on public.fa_routes for insert to authenticated with check(public.fa_role()='lead' or (public.fa_role()='manager' and owner_email=lower(auth.jwt()->>'email')));
create policy fa_routes_edit on public.fa_routes for update to authenticated using(public.fa_role()='lead' or (public.fa_role()='manager' and owner_email=lower(auth.jwt()->>'email'))) with check(public.fa_role()='lead' or (public.fa_role()='manager' and owner_email=lower(auth.jwt()->>'email')));
create policy fa_quotes_read on public.fa_quotes for select to authenticated using(exists(select 1 from public.fa_suppliers where id=supplier_id));
create policy fa_quotes_add on public.fa_quotes for insert to authenticated with check(public.fa_role() in ('manager','lead') and exists(select 1 from public.fa_suppliers where id=supplier_id));
create policy fa_rates_read on public.fa_freight_rates for select to authenticated using(public.fa_role() is not null);
create policy fa_rates_add on public.fa_freight_rates for insert to authenticated with check(public.fa_role() in ('manager','lead') and exists(select 1 from public.fa_routes where id=route_id and (owner_email=lower(auth.jwt()->>'email') or public.fa_role()='lead')));

-- Membership changes are serialized and cannot remove the last active leader.
create function public.fa_set_member(p_email text,p_name text,p_role text,p_active boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(7026191);
 if public.fa_role() is distinct from 'lead' then raise exception 'Только руководитель управляет доступом'; end if;
 if p_role not in ('manager','lead','sales') then raise exception 'Неверная роль'; end if;
 if exists(select 1 from public.fa_members where email=lower(trim(p_email)) and active and role='lead') and (not p_active or p_role<>'lead') and (select count(*) from public.fa_members where active and role='lead')<=1 then raise exception 'Нельзя отключить последнего руководителя'; end if;
 insert into public.fa_members(email,name,role,active) values(lower(trim(p_email)),trim(p_name),p_role,p_active)
 on conflict(email) do update set name=excluded.name,role=excluded.role,active=excluded.active;
end;
$$;
revoke all on public.fa_members,public.fa_settings,public.fa_suppliers,public.fa_routes,public.fa_quotes,public.fa_freight_rates from public,anon,authenticated;
grant select on public.fa_members,public.fa_settings,public.fa_suppliers,public.fa_routes,public.fa_quotes,public.fa_freight_rates to authenticated;
grant insert,update on public.fa_suppliers,public.fa_routes to authenticated;
grant insert on public.fa_quotes,public.fa_freight_rates to authenticated;
grant update on public.fa_settings to authenticated;
revoke all on function public.fa_set_member(text,text,text,boolean) from public,anon;
grant execute on function public.fa_set_member(text,text,text,boolean) to authenticated;
revoke all on function public.fa_card_guard(),public.fa_history_guard(),public.fa_terms(public.fa_suppliers) from public,anon,authenticated;
commit;
