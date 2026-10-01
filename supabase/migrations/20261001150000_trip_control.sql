-- =============================================================================
-- Trip lifecycle + deterministic GPS simulation
--
-- DEMO / SIMULATED HACKATHON DATA. The simulation moves a bus along the
-- straight lines between its configured stops. It is not road-snapped and makes
-- no claim to model real traffic.
--
-- Everything the driver app does is one function call so the write is atomic:
-- location fix, trip progress, next stop and stop arrivals move together, and
-- the realtime event the passenger receives is never half-applied.
--
-- No ML. Progress is distance = speed x time, and position is linear
-- interpolation along the route via fn_route_point_at_km.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_trip_live: everything a tracking screen needs, for trips in ANY state.
--
-- v_active_trips deliberately filters to in_progress. A passenger who has a
-- tracking page open when the driver ends the trip still needs a row back, so
-- this view covers every status and exposes a single operational_state that the
-- UI can switch on.
-- -----------------------------------------------------------------------------
create or replace view public.v_trip_live as
with latest as (
  select
    l.bus_id,
    l.latitude,
    l.longitude,
    l.speed_kmh,
    l.heading_deg,
    l.recorded_at,
    l.source
  from public.v_bus_latest_location l
)
select
  t.id as trip_id,
  t.trip_code,
  t.status,
  t.direction,
  t.service_date,
  t.scheduled_start_at,
  t.scheduled_end_at,
  t.actual_start_at,
  t.actual_end_at,
  t.delay_minutes,
  (t.delay_minutes >= 5) as is_delayed,
  t.progress_km,
  t.last_stop_order,
  t.occupancy,
  r.id as route_id,
  r.code as route_code,
  r.name as route_name,
  r.color as route_color,
  r.distance_km as route_distance_km,
  r.expected_duration_min,
  r.avg_speed_kmh,
  r.fare_pkr,
  case
    when r.distance_km > 0 then round(100 * t.progress_km / r.distance_km, 1)
    else 0
  end as progress_pct,
  b.id as bus_id,
  b.registration_no,
  b.label as bus_label,
  b.capacity,
  b.status as bus_status,
  d.id as driver_id,
  d.full_name as driver_name,
  ns.id as next_stop_id,
  ns.name as next_stop_name,
  ns.latitude as next_stop_latitude,
  ns.longitude as next_stop_longitude,
  l.latitude,
  l.longitude,
  l.speed_kmh,
  l.heading_deg,
  l.recorded_at as location_recorded_at,
  l.source as location_source,
  case
    when l.recorded_at is null then null
    else round(extract(epoch from (now() - l.recorded_at)) / 60.0, 2)
  end as location_age_minutes,
  -- A fix older than 3 minutes is not live. The UI must not plot it as current.
  case
    when l.recorded_at is null then 'no_fix'
    when now() - l.recorded_at > interval '3 minutes' then 'stale'
    else 'live'
  end as gps_status,
  -- Single operational state for the UI. GPS trust comes first: if we cannot
  -- vouch for the position, "stopped" and "on time" are both unsupportable.
  case
    when t.status = 'completed' then 'COMPLETED'
    when t.status = 'cancelled' then 'CANCELLED'
    when t.status = 'scheduled' then 'SCHEDULED'
    when l.recorded_at is null
      or now() - l.recorded_at > interval '3 minutes' then 'GPS_UNAVAILABLE'
    when coalesce(l.speed_kmh, 0) = 0 then 'STOPPED'
    when t.delay_minutes >= 5 then 'DELAYED'
    else 'ON_TIME'
  end as operational_state
from public.trips t
join public.routes r on r.id = t.route_id
join public.buses b on b.id = t.bus_id
left join public.drivers d on d.id = t.driver_id
left join public.stops ns on ns.id = t.next_stop_id
left join latest l on l.bus_id = t.bus_id;

comment on view public.v_trip_live is
  'Per-trip live state for any status, with a derived operational_state (SCHEDULED/ON_TIME/DELAYED/STOPPED/GPS_UNAVAILABLE/COMPLETED/CANCELLED).';

-- -----------------------------------------------------------------------------
-- fn_trip_sync_position: shared bookkeeping after progress changes.
--
-- Keeps last_stop_order, next_stop_id and trip_stop_times consistent with
-- progress_km. Called by both the simulator and the real-GPS path so the two
-- can never drift apart.
-- -----------------------------------------------------------------------------
create or replace function public.fn_trip_sync_position(
  p_trip_id uuid,
  p_progress_km numeric
) returns void
language plpgsql
as $$
declare
  v_trip   record;
  v_last   integer;
  v_next   uuid;
begin
  select t.*, r.distance_km
    into v_trip
  from public.trips t
  join public.routes r on r.id = t.route_id
  where t.id = p_trip_id;

  if not found then
    raise exception 'Trip % not found', p_trip_id using errcode = 'no_data_found';
  end if;

  -- Highest stop already passed, and the first one still ahead.
  select max(rs.stop_order)
    into v_last
  from public.route_stops rs
  where rs.route_id = v_trip.route_id
    and rs.direction = v_trip.direction
    and rs.distance_from_start_km <= p_progress_km;

  select rs.stop_id
    into v_next
  from public.route_stops rs
  where rs.route_id = v_trip.route_id
    and rs.direction = v_trip.direction
    and rs.distance_from_start_km > p_progress_km
  order by rs.stop_order asc
  limit 1;

  update public.trips
  set progress_km     = p_progress_km,
      last_stop_order = coalesce(v_last, 0),
      next_stop_id    = v_next
  where id = p_trip_id;

  -- Stamp arrivals for stops we have now reached.
  update public.trip_stop_times tst
  set status            = 'arrived',
      actual_arrival_at = now()
  where tst.trip_id = p_trip_id
    and tst.status = 'pending'
    and tst.stop_order <= coalesce(v_last, 0);
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_start_trip: SCHEDULED -> IN_PROGRESS.
--
-- Refuses to start a trip that is not scheduled, and refuses to give a bus a
-- second concurrent trip.
-- -----------------------------------------------------------------------------
create or replace function public.fn_start_trip(p_trip_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_trip     record;
  v_conflict text;
  v_point    record;
begin
  select * into v_trip from public.trips where id = p_trip_id for update;

  if not found then
    raise exception 'Trip % not found', p_trip_id using errcode = 'no_data_found';
  end if;

  if v_trip.status = 'in_progress' then
    return v_trip.id; -- idempotent: already running
  end if;

  if v_trip.status <> 'scheduled' then
    raise exception 'Cannot start trip %: status is %, expected scheduled', v_trip.trip_code, v_trip.status
      using errcode = 'check_violation';
  end if;

  select t.trip_code into v_conflict
  from public.trips t
  where t.bus_id = v_trip.bus_id
    and t.status = 'in_progress'
    and t.id <> v_trip.id
  limit 1;

  if v_conflict is not null then
    raise exception 'Bus already has trip % in progress', v_conflict
      using errcode = 'check_violation';
  end if;

  update public.trips
  set status          = 'in_progress',
      actual_start_at = now(),
      actual_end_at   = null,
      progress_km     = 0
  where id = p_trip_id;

  update public.buses set status = 'active' where id = v_trip.bus_id;

  perform public.fn_trip_sync_position(p_trip_id, 0);

  -- Opening fix at the origin so the passenger map has something immediately.
  select * into v_point
  from public.fn_route_point_at_km(v_trip.route_id, v_trip.direction, 0);

  if v_point.latitude is not null then
    insert into public.bus_locations
      (bus_id, trip_id, recorded_at, latitude, longitude, speed_kmh, heading_deg, progress_km, source)
    values
      (v_trip.bus_id, p_trip_id, now(), v_point.latitude, v_point.longitude, 0, v_point.heading_deg, 0, 'simulated');
  end if;

  return p_trip_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_end_trip: IN_PROGRESS -> COMPLETED.
-- -----------------------------------------------------------------------------
create or replace function public.fn_end_trip(p_trip_id uuid)
returns uuid
language plpgsql
as $$
declare
  v_trip     record;
  v_distance numeric;
  v_maxorder integer;
begin
  select t.*, r.distance_km
    into v_trip
  from public.trips t
  join public.routes r on r.id = t.route_id
  where t.id = p_trip_id
  for update of t;

  if not found then
    raise exception 'Trip % not found', p_trip_id using errcode = 'no_data_found';
  end if;

  if v_trip.status = 'completed' then
    return p_trip_id; -- idempotent
  end if;

  if v_trip.status <> 'in_progress' then
    raise exception 'Cannot end trip %: status is %, expected in_progress', v_trip.trip_code, v_trip.status
      using errcode = 'check_violation';
  end if;

  v_distance := v_trip.distance_km;

  select max(rs.stop_order) into v_maxorder
  from public.route_stops rs
  where rs.route_id = v_trip.route_id
    and rs.direction = v_trip.direction;

  update public.trips
  set status          = 'completed',
      actual_end_at   = now(),
      progress_km     = v_distance,
      last_stop_order = v_maxorder,
      next_stop_id    = null
  where id = p_trip_id;

  update public.trip_stop_times
  set status            = 'arrived',
      actual_arrival_at = coalesce(actual_arrival_at, now())
  where trip_id = p_trip_id
    and status = 'pending';

  -- Free the bus unless it is out of service.
  update public.buses
  set status = 'idle'
  where id = v_trip.bus_id
    and status = 'active';

  return p_trip_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_advance_trip: one deterministic simulation tick.
--
--   delta_km     = speed_kmh * tick_seconds / 3600
--   new_progress = min(progress + delta_km, route distance)
--
-- Position comes from fn_route_point_at_km, so the bus always sits exactly on
-- the configured route. Auto-completes on arrival at the final stop.
-- -----------------------------------------------------------------------------
create or replace function public.fn_advance_trip(
  p_trip_id       uuid,
  p_tick_seconds  numeric default 5,
  p_speed_kmh     numeric default null
) returns uuid
language plpgsql
as $$
declare
  v_trip     record;
  v_speed    numeric;
  v_delta    numeric;
  v_progress numeric;
  v_point    record;
begin
  select t.*, r.distance_km, r.avg_speed_kmh
    into v_trip
  from public.trips t
  join public.routes r on r.id = t.route_id
  where t.id = p_trip_id;

  if not found then
    raise exception 'Trip % not found', p_trip_id using errcode = 'no_data_found';
  end if;

  if v_trip.status <> 'in_progress' then
    raise exception 'Cannot advance trip %: status is %, expected in_progress', v_trip.trip_code, v_trip.status
      using errcode = 'check_violation';
  end if;

  -- A caller-supplied 0 is meaningful (bus halted), so only fall back on NULL.
  v_speed := coalesce(p_speed_kmh, v_trip.avg_speed_kmh);
  v_delta := v_speed * coalesce(p_tick_seconds, 5) / 3600.0;

  v_progress := least(v_trip.progress_km + v_delta, v_trip.distance_km);

  select * into v_point
  from public.fn_route_point_at_km(v_trip.route_id, v_trip.direction, v_progress);

  if v_point.latitude is null then
    raise exception 'Route % has no geometry for direction %', v_trip.route_id, v_trip.direction;
  end if;

  insert into public.bus_locations
    (bus_id, trip_id, recorded_at, latitude, longitude, speed_kmh, heading_deg, progress_km, source)
  values
    (v_trip.bus_id, p_trip_id, now(), v_point.latitude, v_point.longitude,
     round(v_speed, 2), v_point.heading_deg, round(v_progress, 3), 'simulated');

  perform public.fn_trip_sync_position(p_trip_id, v_progress);

  if v_progress >= v_trip.distance_km then
    perform public.fn_end_trip(p_trip_id);
  end if;

  return p_trip_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_record_trip_location: real browser GPS.
--
-- Progress is snapped to the nearest stop on the route and never allowed to go
-- backwards, which keeps ETA monotonic without needing real map matching.
-- -----------------------------------------------------------------------------
create or replace function public.fn_record_trip_location(
  p_trip_id     uuid,
  p_latitude    numeric,
  p_longitude   numeric,
  p_speed_kmh   numeric default 0,
  p_heading_deg numeric default null
) returns uuid
language plpgsql
as $$
declare
  v_trip     record;
  v_snapped  numeric;
  v_progress numeric;
begin
  if p_latitude is null or p_longitude is null
     or p_latitude < -90 or p_latitude > 90
     or p_longitude < -180 or p_longitude > 180 then
    raise exception 'Invalid coordinates: %, %', p_latitude, p_longitude
      using errcode = 'check_violation';
  end if;

  select t.*, r.distance_km
    into v_trip
  from public.trips t
  join public.routes r on r.id = t.route_id
  where t.id = p_trip_id;

  if not found then
    raise exception 'Trip % not found', p_trip_id using errcode = 'no_data_found';
  end if;

  if v_trip.status <> 'in_progress' then
    raise exception 'Cannot record location for trip %: status is %', v_trip.trip_code, v_trip.status
      using errcode = 'check_violation';
  end if;

  select rs.distance_from_start_km
    into v_snapped
  from public.route_stops rs
  join public.stops s on s.id = rs.stop_id
  where rs.route_id = v_trip.route_id
    and rs.direction = v_trip.direction
  order by public.fn_haversine_km(p_latitude, p_longitude, s.latitude, s.longitude) asc
  limit 1;

  v_progress := least(greatest(coalesce(v_snapped, 0), v_trip.progress_km), v_trip.distance_km);

  insert into public.bus_locations
    (bus_id, trip_id, recorded_at, latitude, longitude, speed_kmh, heading_deg, progress_km, source)
  values
    (v_trip.bus_id, p_trip_id, now(), p_latitude, p_longitude,
     round(coalesce(p_speed_kmh, 0), 2), p_heading_deg, round(v_progress, 3), 'device');

  perform public.fn_trip_sync_position(p_trip_id, v_progress);

  return p_trip_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_set_trip_delay: operator/demo delay control.
--
-- Delay is stored on the trip; v_trip_live turns >= 5 min into DELAYED and
-- v_trip_stop_eta adds it to every downstream projection.
-- -----------------------------------------------------------------------------
create or replace function public.fn_set_trip_delay(
  p_trip_id       uuid,
  p_delay_minutes integer
) returns uuid
language plpgsql
as $$
begin
  if p_delay_minutes is null or p_delay_minutes < 0 or p_delay_minutes > 240 then
    raise exception 'Delay must be between 0 and 240 minutes, got %', p_delay_minutes
      using errcode = 'check_violation';
  end if;

  update public.trips
  set delay_minutes = p_delay_minutes
  where id = p_trip_id;

  if not found then
    raise exception 'Trip % not found', p_trip_id using errcode = 'no_data_found';
  end if;

  return p_trip_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- fn_route_path: ordered polyline for drawing a route on the map.
-- -----------------------------------------------------------------------------
create or replace function public.fn_route_path(
  p_route_id  uuid,
  p_direction public.trip_direction default 'outbound'
) returns table (
  stop_order             integer,
  stop_id                uuid,
  stop_code              text,
  stop_name              text,
  latitude               numeric,
  longitude              numeric,
  distance_from_start_km numeric,
  is_major_stop          boolean
)
language sql
stable
as $$
  select
    rs.stop_order,
    s.id,
    s.code,
    s.name,
    s.latitude,
    s.longitude,
    rs.distance_from_start_km,
    rs.is_major_stop
  from public.route_stops rs
  join public.stops s on s.id = rs.stop_id
  where rs.route_id = p_route_id
    and rs.direction = p_direction
  order by rs.stop_order;
$$;

comment on function public.fn_route_path is 'Ordered stops for a route direction, used as the map polyline.';

-- -----------------------------------------------------------------------------
-- Access. Reads stay public (demo data); state changes are server-side only.
-- Guarded so the migration also runs on a plain Postgres without Supabase roles.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    grant select on public.v_trip_live to anon, authenticated;
    grant execute on function public.fn_route_path(uuid, public.trip_direction) to anon, authenticated;
  end if;

  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select on public.v_trip_live to service_role;
    grant execute on function public.fn_start_trip(uuid) to service_role;
    grant execute on function public.fn_end_trip(uuid) to service_role;
    grant execute on function public.fn_advance_trip(uuid, numeric, numeric) to service_role;
    grant execute on function public.fn_record_trip_location(uuid, numeric, numeric, numeric, numeric) to service_role;
    grant execute on function public.fn_set_trip_delay(uuid, integer) to service_role;
    grant execute on function public.fn_route_path(uuid, public.trip_direction) to service_role;
  end if;
end;
$$;

alter view public.v_trip_live set (security_invoker = on);
