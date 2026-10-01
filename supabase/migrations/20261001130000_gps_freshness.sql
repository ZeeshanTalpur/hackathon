-- =============================================================================
-- Smart Public Transport & Bus Tracking Platform - Karachi
-- Migration 4: GPS freshness and ETA input exposure
--
-- Why this is a separate migration: migrations 1-3 are already committed and may
-- already be applied to the Supabase project, so they are treated as immutable.
--
-- What it adds:
--   * A GPS freshness signal on every live view, so the UI can say
--     "Location temporarily unavailable" instead of rendering a stale pin as if
--     it were live (required by demo scenario 4 / GPS_UNAVAILABLE).
--   * elapsed_minutes on v_active_trips, the one deterministic ETA input that
--     was previously only derivable by the caller.
--
-- Two deliberately different staleness thresholds, because they answer
-- different questions:
--   * 3 minutes  - passenger-facing: "is this pin safe to draw as live?"
--   * 10 minutes - operator-facing: "has this vehicle stopped reporting?"
--     (kept as v_fleet_status.telemetry_stale, unchanged)
--
-- No table changes. Views are replaced with columns appended at the end, which
-- is all CREATE OR REPLACE VIEW permits.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- v_active_trips: + elapsed_minutes, location_age, location_is_stale, gps_status
-- -----------------------------------------------------------------------------
create or replace view public.v_active_trips as
select
  t.id as trip_id,
  t.trip_code,
  t.status,
  t.direction,
  t.service_date,
  t.scheduled_start_at,
  t.scheduled_end_at,
  t.actual_start_at,
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
  r.fare_pkr,
  case
    when r.distance_km > 0 then round(100 * t.progress_km / r.distance_km, 1)
    else 0
  end as progress_pct,
  b.id as bus_id,
  b.registration_no,
  b.label as bus_label,
  b.capacity,
  case
    when b.capacity > 0 then round(100.0 * t.occupancy / b.capacity, 1)
    else 0
  end as occupancy_pct,
  d.id as driver_id,
  d.full_name as driver_name,
  d.phone as driver_phone,
  ns.id as next_stop_id,
  ns.name as next_stop_name,
  l.latitude,
  l.longitude,
  l.speed_kmh,
  l.heading_deg,
  l.recorded_at as location_recorded_at,
  -- appended by migration 4
  round(extract(epoch from (now() - coalesce(t.actual_start_at, t.scheduled_start_at))) / 60.0)::integer
    as elapsed_minutes,
  (now() - l.recorded_at) as location_age,
  (l.recorded_at is null or l.recorded_at < now() - interval '3 minutes') as location_is_stale,
  case
    when l.recorded_at is null then 'no_fix'
    when l.recorded_at < now() - interval '3 minutes' then 'stale'
    else 'live'
  end as gps_status
from public.trips t
join public.routes r on r.id = t.route_id
join public.buses b on b.id = t.bus_id
left join public.drivers d on d.id = t.driver_id
left join public.stops ns on ns.id = t.next_stop_id
left join public.v_bus_latest_location l on l.bus_id = t.bus_id
where t.status = 'in_progress';

comment on view public.v_active_trips is
  'Live trips joined to route, bus, driver, next stop and latest GPS fix. Check gps_status before drawing the pin as live: live | stale | no_fix.';

-- -----------------------------------------------------------------------------
-- v_trip_stop_eta: + gps_status, so an arrivals board can mark or suppress an
-- ETA that was computed from an old position rather than presenting it as live.
-- -----------------------------------------------------------------------------
create or replace view public.v_trip_stop_eta as
select
  c.trip_id,
  c.trip_code,
  c.route_id,
  c.route_code,
  c.direction,
  c.stop_id,
  c.stop_code,
  c.stop_name,
  c.stop_order,
  c.latitude,
  c.longitude,
  c.distance_from_start_km,
  c.remaining_km,
  c.effective_speed_kmh,
  c.stops_ahead,
  c.eta_minutes,
  (now() + (c.eta_minutes * interval '1 minute')) as estimated_arrival_at,
  c.scheduled_arrival_at,
  round(
    extract(epoch from (now() + (c.eta_minutes * interval '1 minute')) - c.scheduled_arrival_at) / 60.0
  )::integer as projected_delay_minutes,
  -- appended by migration 4
  c.gps_status
from (
  select
    live.trip_id,
    live.trip_code,
    live.route_id,
    live.route_code,
    live.direction,
    live.gps_status,
    s.id   as stop_id,
    s.code as stop_code,
    s.name as stop_name,
    s.latitude,
    s.longitude,
    rs.stop_order,
    rs.distance_from_start_km,
    greatest(rs.distance_from_start_km - live.progress_km, 0) as remaining_km,
    live.effective_speed_kmh,
    (rs.stop_order - coalesce(live.last_stop_order, 0)) as stops_ahead,
    ceil(
      (greatest(rs.distance_from_start_km - live.progress_km, 0) / live.effective_speed_kmh) * 60
      + greatest(rs.stop_order - coalesce(live.last_stop_order, 0) - 1, 0) * 0.5
    )::integer as eta_minutes,
    live.scheduled_start_at + (rs.scheduled_offset_min * interval '1 minute') as scheduled_arrival_at
  from (
    select
      t.id as trip_id,
      t.trip_code,
      t.route_id,
      t.direction,
      t.progress_km,
      t.last_stop_order,
      t.scheduled_start_at,
      r.code as route_code,
      coalesce(nullif(l.speed_kmh, 0), r.avg_speed_kmh) as effective_speed_kmh,
      case
        when l.recorded_at is null then 'no_fix'
        when l.recorded_at < now() - interval '3 minutes' then 'stale'
        else 'live'
      end as gps_status
    from public.trips t
    join public.routes r on r.id = t.route_id
    left join public.v_bus_latest_location l on l.bus_id = t.bus_id
    where t.status = 'in_progress'
  ) live
  join public.route_stops rs
    on rs.route_id = live.route_id
   and rs.direction = live.direction
   and rs.stop_order > coalesce(live.last_stop_order, 0)
  join public.stops s on s.id = rs.stop_id
) c;

comment on view public.v_trip_stop_eta is
  'Deterministic per-stop ETA for in-progress trips. Distance / speed arithmetic plus a fixed dwell allowance - no model inference. When gps_status is not live the estimate is extrapolated from an old fix: label it, do not present it as live.';

-- -----------------------------------------------------------------------------
-- v_fleet_status: + gps_status alongside the existing 10-minute telemetry_stale
-- -----------------------------------------------------------------------------
create or replace view public.v_fleet_status as
select
  b.id as bus_id,
  b.registration_no,
  b.label as bus_label,
  b.status as bus_status,
  b.capacity,
  d.id   as driver_id,
  d.full_name as driver_name,
  t.id   as trip_id,
  t.trip_code,
  t.status as trip_status,
  r.id   as route_id,
  r.code as route_code,
  r.name as route_name,
  r.color as route_color,
  t.delay_minutes,
  coalesce(t.delay_minutes, 0) >= 5 as is_delayed,
  t.progress_km,
  l.latitude,
  l.longitude,
  l.speed_kmh,
  l.heading_deg,
  l.recorded_at as location_recorded_at,
  l.location_age,
  (l.recorded_at is null or l.recorded_at < now() - interval '10 minutes') as telemetry_stale,
  -- appended by migration 4
  case
    when l.recorded_at is null then 'no_fix'
    when l.recorded_at < now() - interval '3 minutes' then 'stale'
    else 'live'
  end as gps_status
from public.buses b
left join public.drivers d on d.id = b.assigned_driver_id
left join public.trips t on t.bus_id = b.id and t.status = 'in_progress'
left join public.routes r on r.id = t.route_id
left join public.v_bus_latest_location l on l.bus_id = b.id;

comment on view public.v_fleet_status is
  'One row per bus with its live trip (if any) and latest fix. telemetry_stale (10 min) means the vehicle has stopped reporting; gps_status (3 min) means the pin is not safe to draw as live.';

-- -----------------------------------------------------------------------------
-- fn_stop_arrivals: + gps_status. Dropped and recreated because CREATE OR
-- REPLACE FUNCTION cannot change a return type.
-- -----------------------------------------------------------------------------
drop function if exists public.fn_stop_arrivals(uuid, integer);

create function public.fn_stop_arrivals(
  p_stop_id uuid,
  p_limit integer default 10
) returns table (
  trip_id                 uuid,
  trip_code               text,
  route_code              text,
  route_name              text,
  route_color             text,
  bus_registration_no     text,
  eta_minutes             integer,
  estimated_arrival_at    timestamptz,
  scheduled_arrival_at    timestamptz,
  projected_delay_minutes integer,
  gps_status              text
)
language sql
stable
as $$
  select
    e.trip_id,
    e.trip_code,
    e.route_code,
    r.name,
    r.color,
    b.registration_no,
    e.eta_minutes,
    e.estimated_arrival_at,
    e.scheduled_arrival_at,
    e.projected_delay_minutes,
    e.gps_status
  from public.v_trip_stop_eta e
  join public.trips t on t.id = e.trip_id
  join public.routes r on r.id = e.route_id
  join public.buses b on b.id = t.bus_id
  where e.stop_id = p_stop_id
  order by e.eta_minutes
  limit greatest(coalesce(p_limit, 10), 1);
$$;

comment on function public.fn_stop_arrivals is
  'Next buses arriving at a stop, soonest first. Rows where gps_status is not live are extrapolated from an old fix.';

grant execute on function public.fn_stop_arrivals(uuid, integer) to anon, authenticated;

alter view public.v_active_trips  set (security_invoker = on);
alter view public.v_trip_stop_eta set (security_invoker = on);
alter view public.v_fleet_status  set (security_invoker = on);
