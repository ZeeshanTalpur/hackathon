-- =============================================================================
-- Smart Public Transport & Bus Tracking Platform - Karachi
-- Migration 3/3: row level security, grants and view security mode
--
-- DEMO-GRADE SECURITY. The policies below are deliberately permissive: all
-- transport reference and live-tracking data is world-readable because the
-- passenger app is meant to work without logging in. This is not a production
-- security model - see docs/ASSUMPTIONS.md before reusing it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Staff check. security definer so it can read profiles without tripping the
-- profiles policy (which would recurse).
-- -----------------------------------------------------------------------------
create or replace function public.fn_is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.auth_user_id = auth.uid()
      and p.role in ('operator', 'admin')
  );
$$;

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.drivers         enable row level security;
alter table public.buses           enable row level security;
alter table public.routes          enable row level security;
alter table public.stops           enable row level security;
alter table public.route_stops     enable row level security;
alter table public.trips           enable row level security;
alter table public.bus_locations   enable row level security;
alter table public.trip_stop_times enable row level security;
alter table public.service_alerts  enable row level security;

-- -----------------------------------------------------------------------------
-- profiles: a user sees and edits only their own row; staff see everything.
-- -----------------------------------------------------------------------------
create policy profiles_select_self_or_staff on public.profiles
  for select to authenticated
  using (auth_user_id = auth.uid() or public.fn_is_staff());

create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (auth_user_id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (auth_user_id = auth.uid())
  with check (auth_user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- drivers: personal data, so signed-in users only; staff can write.
-- -----------------------------------------------------------------------------
create policy drivers_select_authenticated on public.drivers
  for select to authenticated
  using (true);

create policy drivers_write_staff on public.drivers
  for all to authenticated
  using (public.fn_is_staff())
  with check (public.fn_is_staff());

-- -----------------------------------------------------------------------------
-- Public transport reference data: readable by everyone, writable by staff.
-- -----------------------------------------------------------------------------
create policy routes_select_public on public.routes
  for select to anon, authenticated using (true);
create policy routes_write_staff on public.routes
  for all to authenticated using (public.fn_is_staff()) with check (public.fn_is_staff());

create policy stops_select_public on public.stops
  for select to anon, authenticated using (true);
create policy stops_write_staff on public.stops
  for all to authenticated using (public.fn_is_staff()) with check (public.fn_is_staff());

create policy route_stops_select_public on public.route_stops
  for select to anon, authenticated using (true);
create policy route_stops_write_staff on public.route_stops
  for all to authenticated using (public.fn_is_staff()) with check (public.fn_is_staff());

create policy buses_select_public on public.buses
  for select to anon, authenticated using (true);
create policy buses_write_staff on public.buses
  for all to authenticated using (public.fn_is_staff()) with check (public.fn_is_staff());

create policy service_alerts_select_public on public.service_alerts
  for select to anon, authenticated using (true);
create policy service_alerts_write_staff on public.service_alerts
  for all to authenticated using (public.fn_is_staff()) with check (public.fn_is_staff());

-- -----------------------------------------------------------------------------
-- Live operational data: public read so the tracking map works logged-out.
-- Writes are limited to signed-in users; the location feed should really run
-- with the service_role key, which bypasses RLS entirely.
-- -----------------------------------------------------------------------------
create policy trips_select_public on public.trips
  for select to anon, authenticated using (true);
create policy trips_write_authenticated on public.trips
  for all to authenticated using (true) with check (true);

create policy bus_locations_select_public on public.bus_locations
  for select to anon, authenticated using (true);
create policy bus_locations_write_authenticated on public.bus_locations
  for all to authenticated using (true) with check (true);

create policy trip_stop_times_select_public on public.trip_stop_times
  for select to anon, authenticated using (true);
create policy trip_stop_times_write_authenticated on public.trip_stop_times
  for all to authenticated using (true) with check (true);

-- -----------------------------------------------------------------------------
-- Views run with the caller's permissions so the policies above still apply.
-- -----------------------------------------------------------------------------
alter view public.v_bus_latest_location set (security_invoker = on);
alter view public.v_fleet_status        set (security_invoker = on);
alter view public.v_active_trips        set (security_invoker = on);
alter view public.v_trip_stop_eta       set (security_invoker = on);
alter view public.v_route_summary       set (security_invoker = on);
alter view public.v_fleet_overview      set (security_invoker = on);

-- -----------------------------------------------------------------------------
-- Grants (RLS still filters rows; these just open the tables to the API roles).
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

grant select on
  public.routes, public.stops, public.route_stops, public.buses,
  public.trips, public.bus_locations, public.trip_stop_times, public.service_alerts,
  public.v_bus_latest_location, public.v_fleet_status, public.v_active_trips,
  public.v_trip_stop_eta, public.v_route_summary, public.v_fleet_overview
to anon, authenticated;

grant select on public.profiles, public.drivers to authenticated;

grant insert, update, delete on
  public.profiles, public.drivers, public.routes, public.stops, public.route_stops,
  public.buses, public.trips, public.bus_locations, public.trip_stop_times,
  public.service_alerts
to authenticated;

grant usage, select on sequence public.bus_locations_id_seq to authenticated;

grant execute on function
  public.fn_haversine_km(numeric, numeric, numeric, numeric),
  public.fn_route_segments(uuid, public.trip_direction),
  public.fn_route_point_at_km(uuid, public.trip_direction, numeric),
  public.fn_trip_eta_minutes(uuid, uuid),
  public.fn_stop_arrivals(uuid, integer),
  public.fn_search_routes(uuid, uuid),
  public.fn_nearby_stops(numeric, numeric, numeric, integer)
to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Demo escape hatch: if RLS blocks the demo and time is short, run this in the
-- Supabase SQL editor to drop straight to open access. Never ship it.
--
--   alter table public.profiles        disable row level security;
--   alter table public.drivers         disable row level security;
--   alter table public.buses           disable row level security;
--   alter table public.routes          disable row level security;
--   alter table public.stops           disable row level security;
--   alter table public.route_stops     disable row level security;
--   alter table public.trips           disable row level security;
--   alter table public.bus_locations   disable row level security;
--   alter table public.trip_stop_times disable row level security;
--   alter table public.service_alerts  disable row level security;
-- -----------------------------------------------------------------------------
