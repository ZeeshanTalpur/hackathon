-- =============================================================================
-- Smart Public Transport & Bus Tracking Platform - Karachi
-- Migration 5: auth profile linking and realtime publication
--
-- Both sections are guarded so this file is safe to run anywhere:
--   * on Supabase it wires up auth.users and supabase_realtime
--   * on a plain Postgres (the validation harness) it skips those parts with a
--     notice instead of failing
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Profile creation / linking on sign-up
--
-- Makes `role` available to the application immediately after sign-in:
--   * if a profile already exists with the same email and no auth link (the
--     demo rows from seed.sql), adopt it and keep its role
--   * otherwise create a profile, taking the role from sign-up metadata
--
-- security definer so it can write to profiles regardless of RLS.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_requested text := new.raw_user_meta_data ->> 'role';
  v_role public.user_role := 'passenger';
begin
  -- Only accept a role we recognise; never cast unvalidated text to the enum.
  if v_requested in ('passenger', 'driver', 'operator', 'admin') then
    v_role := v_requested::public.user_role;
  end if;

  update public.profiles p
  set auth_user_id = new.id,
      role = case when v_requested is null then p.role else v_role end
  where p.email = new.email
    and p.auth_user_id is null;

  if not found then
    insert into public.profiles (auth_user_id, full_name, email, role)
    values (
      new.id,
      coalesce(
        new.raw_user_meta_data ->> 'full_name',
        split_part(coalesce(new.email, 'user'), '@', 1)
      ),
      new.email,
      v_role
    )
    on conflict (auth_user_id) do nothing;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_auth_user is
  'Trigger on auth.users: adopts a matching demo profile by email, otherwise creates one with the role from sign-up metadata.';

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'auth' and table_name = 'users'
  ) then
    execute 'drop trigger if exists on_auth_user_created on auth.users';
    execute 'create trigger on_auth_user_created
               after insert on auth.users
               for each row execute function public.handle_new_auth_user()';
    raise notice 'Installed on_auth_user_created trigger on auth.users';
  else
    raise notice 'auth.users not found - skipping sign-up trigger (not a Supabase instance)';
  end if;
end
$$;

-- -----------------------------------------------------------------------------
-- 2. Realtime
--
-- bus_locations is the live feed: the driver inserts a fix, passengers and the
-- operator receive it. trips carries status and delay changes; service_alerts
-- carries announcements.
--
-- trips gets REPLICA IDENTITY FULL so UPDATE events include the previous row,
-- which lets a client diff a status or delay change. bus_locations is
-- insert-only, so the default replica identity is enough.
-- -----------------------------------------------------------------------------
alter table public.trips replica identity full;

do $$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication not found - skipping realtime setup (not a Supabase instance)';
    return;
  end if;

  foreach v_table in array array['bus_locations', 'trips', 'service_alerts']
  loop
    if exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = v_table
    ) then
      raise notice 'public.% already in supabase_realtime', v_table;
    else
      execute format('alter publication supabase_realtime add table public.%I', v_table);
      raise notice 'Added public.% to supabase_realtime', v_table;
    end if;
  end loop;
end
$$;
