-- Role mappings only. This does NOT create Auth users or store passwords.
-- Create matching users with passwords in Supabase Authentication, Auto Confirm enabled.
insert into public.fa_members(email,name,role,active) values
 ('manager1@fiberanalytics.invalid','Менеджер 1','manager',true),
 ('manager2@fiberanalytics.invalid','Менеджер 2','manager',true),
 ('manager3@fiberanalytics.invalid','Менеджер 3','manager',true),
 ('head@fiberanalytics.invalid','Руководитель','lead',true),
 ('sales1@fiberanalytics.invalid','Продажи 1','sales',true),
 ('sales2@fiberanalytics.invalid','Продажи 2','sales',true)
on conflict(email) do nothing;
