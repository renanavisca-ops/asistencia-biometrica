-- Simula lo mínimo de Supabase para probar migraciones y RLS en un Postgres local.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create extension pgcrypto with schema extensions;
grant usage on schema auth, extensions, public to anon, authenticated, service_role;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', email_confirmed_at timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on functions to service_role;
-- Stub mínimo de Supabase Vault.
create schema vault;
create table vault.secrets (name text primary key, secret text not null);
create view vault.decrypted_secrets as select name, secret as decrypted_secret from vault.secrets;
insert into vault.secrets values ('template_enc_key', encode(extensions.gen_random_bytes(32), 'base64'));
insert into vault.secrets values ('pii_enc_key', encode(extensions.gen_random_bytes(32), 'base64'));
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid
language sql as $$ insert into vault.secrets (name, secret) values (new_name, new_secret); select gen_random_uuid(); $$;
-- Stub mínimo de Supabase Storage (tablas y helper usados por las políticas).
create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (id text primary key, name text not null, public boolean default false, file_size_limit bigint);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text not null,
  owner uuid, created_at timestamptz not null default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to authenticated, service_role;
create function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant execute on function storage.foldername(text) to anon, authenticated, service_role;
