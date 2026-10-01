-- =============================================================================
-- Smart Public Transport & Bus Tracking Platform - Karachi
-- Migration 2/3: helper functions and read views
--
-- No machine learning anywhere. Every estimate here is a deterministic
-- arithmetic calculation over route geometry, timetable offsets, reported
-- speed and recorded delay. The formula is documented in docs/DATA_MODEL.md.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- fn_haversine_km: great-circle distance in kilometres.
-- Avoids a PostGIS dependency, which keeps the hackathon setup to plain SQL.
-- -----------------------------------------------------------------------------
create or replace function public.fn_haversine_km(
  p_lat1 numeric,
  p_lon1 numeric,
  p_lat2 numeric,
  p_lon2 numeric
) returns numeric
language sql
immutable
as $$
  select round(
    (6371.0088 * 2 * asin(
      sqrt(
        power(sin(radians(p_lat2::double precision - p_lat1::double precision) / 2), 2)
        + cos(radians(p_lat1::double precision))
        * cos(radians(p_lat2::double precision))
        * power(sin(radians(p_lon2::double precision - p_lon1::double precision) / 2), 2)
      )
    ))::numeric,
    3
  );
$$;

comment on function public.fn_haversine_km is
  'Great-circle distance in km between two lat/lon pairs. Straight-line, not road distance.';

-- -----------------------------------------------------------------------------
-- fn_route_segments: consecutive stop pairs of a route direction.
-- Used to interpolate a position at an arbitrary distance along the route.
-- -----------------------------------------------------------------------------
create or replace function public.fn_route_segments(
  p_route_id uuid,
  p_direction public.trip_direction
) returns table (
  stop_order integer,
  km0 numeric,
  lat0 numeric,
  lon0 numeric,
  km1 numeric,
  lat1 numeric,
  lon1 numeric
)
language sql
stable
as $$
  select *
  from (
    select
      rs.stop_order,
      rs.distance_from_start_km as km0,
      s.latitude  as lat0,
      s.longitude as lon0,
      lead(rs.distance_from_start_km) over w as km1,
      lead(s.latitude)  over w as lat1,
      lead(s.longitude) over w as lon1
    from public.route_stops rs
    join public.stops s on s.id = rs.stop_id
    where rs.route_id = p_route_id
      and rs.direction = p_direction
    window w as (order by rs.stop_order)
  ) seg
  where seg.km1 is not null;
$$;

-- -----------------------------------------------------------------------------
-- fn_route_point_at_km: linear interpolation of a point along a route.
-- Straight lines between consecutive stops - good enough for a demo map and
-- for generating plausible seed telemetry. Not road-snapped.
-- -----------------------------------------------------------------------------
create or replace function public.fn_route_point_at_km(
  p_route_id uuid,
  p_direction public.trip_direction,
  p_km numeric
) returns table (
  latitude    numeric,
  longitude   numeric,
  heading_deg numeric
)
language plpgsql
stable
as $$
declare
  v_seg     record;
  v_km      numeric := greatest(coalesce(p_km, 0), 0);
  v_ratio   numeric;
  v_bearing double precision;
begin
  select * into v_seg
  from public.fn_route_segments(p_route_id, p_direction) s
  where s.km0 <= v_km
  order by s.km0 desc
  limit 1;

  if not found then
    select * into v_seg
    from public.fn_route_segments(p_route_id, p_direction) s
    order by s.km0 asc
    limit 1;
  end if;

  if not found then
    return;
  end if;

  v_ratio := case
    when v_seg.km1 = v_seg.km0 then 0
    else least(greatest((v_km - v_seg.km0) / (v_seg.km1 - v_seg.km0), 0), 1)
  end;

  v_bearing := degrees(
    atan2(
      sin(radians(v_seg.lon1::double precision - v_seg.lon0::double precision))
        * cos(radians(v_seg.lat1::double precision)),
      cos(radians(v_seg.lat0::double precision)) * sin(radians(v_seg.lat1::double precision))
        - sin(radians(v_seg.lat0::double precision)) * cos(radians(v_seg.lat1::double precision))
          * cos(radians(v_seg.lon1::double precision - v_seg.lon0::double precision))
    )
  );
  v_bearing := v_bearing - floor(v_bearing / 360.0) * 360.0;

  latitude    := round(v_seg.lat0 + (v_seg.lat1 - v_seg.lat0) * v_ratio, 6);
  longitude   := round(v_seg.lon0 + (v_seg.lon1 - v_seg.lon0) * v_ratio, 6);
  heading_deg := round(v_bearing::numeric, 2);

  if heading_deg >= 360 then
    heading_deg := 0;
  end if;

  return next;
end;
$$;

comment on function public.fn_route_point_at_km is
  'Interpolated lat/lon/bearing at a given distance along a route direction. Straight-line between stops, not road-snapped.';

-- -----------------------------------------------------------------------------
-- v_bus_latest_location: newest fix per bus.
-- -----------------------------------------------------------------------------
create or replace view public.v_bus_latest_location as
select distinct on (bl.bus_id)
  bl.bus_id,
  bl.trip_id,
  bl.recorded_at,
  bl.latitude,
  bl.longitude,
  bl.speed_kmh,
  bl.heading_deg,
  bl.progress_km,
  bl.source,
  (now() - bl.recorded_at) as location_age
from public.bus_locations bl
order by bl.bus_id, bl.recorded_at desc;

comment on view public.v_bus_latest_location is 'Most recent location row for each bus.';

-- -----------------------------------------------------------------------------
-- v_fleet_status: one row per bus for the operator monitoring screen.
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
  (l.recorded_at is null or l.recorded_at < now() - interval '10 minutes') as telemetry_stale
from public.buses b
left join public.drivers d on d.id = b.assigned_driver_id
left join public.trips t on t.bus_id = b.id and t.status = 'in_progress'
left join public.routes r on r.id = t.route_id
left join public.v_bus_latest_location l on l.bus_id = b.id;

comment on view public.v_fleet_status is
  'One row per bus with its live trip (if any), latest fix and a telemetry_stale flag for offline detection.';

-- -----------------------------------------------------------------------------
-- v_active_trips: everything the live map needs for currently running trips.
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
  l.recorded_at as location_recorded_at
from public.trips t
join public.routes r on r.id = t.route_id
join public.buses b on b.id = t.bus_id
left join public.drivers d on d.id = t.driver_id
left join public.stops ns on ns.id = t.next_stop_id
left join public.v_bus_latest_location l on l.bus_id = t.bus_id
where t.status = 'in_progress';

comment on view public.v_active_trips is 'Live trips joined to route, bus, driver, next stop and latest GPS fix.';

-- -----------------------------------------------------------------------------
-- v_trip_stop_eta: deterministic ETA for every upcoming stop of a live trip.
--
--   remaining_km = max(stop_distance_from_start - trip_progress, 0)
--   speed        = latest non-zero reported speed, else route planning speed
--   travel_min   = remaining_km / speed * 60
--   dwell_min    = 0.5 min per intermediate stop still to be served
--   eta_minutes  = ceil(travel_min + dwell_min)
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
  )::integer as projected_delay_minutes
from (
  select
    live.trip_id,
    live.trip_code,
    live.route_id,
    live.route_code,
    live.direction,
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
      coalesce(nullif(l.speed_kmh, 0), r.avg_speed_kmh) as effective_speed_kmh
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
  'Deterministic per-stop ETA for in-progress trips. Distance / speed arithmetic plus a fixed dwell allowance - no model inference.';

-- -----------------------------------------------------------------------------
-- fn_trip_eta_minutes: scalar ETA lookup for one trip/stop pair.
-- -----------------------------------------------------------------------------
create or replace function public.fn_trip_eta_minutes(
  p_trip_id uuid,
  p_stop_id uuid
) returns integer
language sql
stable
as $$
  select e.eta_minutes
  from public.v_trip_stop_eta e
  where e.trip_id = p_trip_id
    and e.stop_id = p_stop_id
  order by e.stop_order
  limit 1;
$$;

comment on function public.fn_trip_eta_minutes is
  'Minutes until the given live trip reaches the given stop. Null if the trip is not running or the stop is already passed.';

-- -----------------------------------------------------------------------------
-- fn_stop_arrivals: next buses arriving at a stop (passenger "when is my bus").
-- -----------------------------------------------------------------------------
create or replace function public.fn_stop_arrivals(
  p_stop_id uuid,
  p_limit integer default 10
) returns table (
  trip_id              uuid,
  trip_code            text,
  route_code           text,
  route_name           text,
  route_color          text,
  bus_registration_no  text,
  eta_minutes          integer,
  estimated_arrival_at timestamptz,
  scheduled_arrival_at timestamptz,
  projected_delay_minutes integer
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
    e.projected_delay_minutes
  from public.v_trip_stop_eta e
  join public.trips t on t.id = e.trip_id
  join public.routes r on r.id = e.route_id
  join public.buses b on b.id = t.bus_id
  where e.stop_id = p_stop_id
  order by e.eta_minutes
  limit greatest(coalesce(p_limit, 10), 1);
$$;

-- -----------------------------------------------------------------------------
-- fn_search_routes: direct routes from one stop to another.
-- Single-route journeys only; no transfer planning in the hackathon scope.
-- -----------------------------------------------------------------------------
create or replace function public.fn_search_routes(
  p_origin_stop_id      uuid,
  p_destination_stop_id uuid
) returns table (
  route_id                uuid,
  route_code              text,
  route_name              text,
  route_color             text,
  direction               public.trip_direction,
  origin_stop_order       integer,
  destination_stop_order  integer,
  intermediate_stops      integer,
  distance_km             numeric,
  estimated_duration_min  integer,
  fare_pkr                numeric,
  active_trip_count       integer,
  next_departure_at       timestamptz
)
language sql
stable
as $$
  select
    r.id,
    r.code,
    r.name,
    r.color,
    o.direction,
    o.stop_order,
    d.stop_order,
    (d.stop_order - o.stop_order - 1)::integer,
    round(d.distance_from_start_km - o.distance_from_start_km, 2),
    (d.scheduled_offset_min - o.scheduled_offset_min)::integer,
    r.fare_pkr,
    (
      select count(*)::integer
      from public.trips t
      where t.route_id = r.id
        and t.direction = o.direction
        and t.status = 'in_progress'
    ),
    (
      select min(t.scheduled_start_at + (o.scheduled_offset_min * interval '1 minute'))
      from public.trips t
      where t.route_id = r.id
        and t.direction = o.direction
        and t.status in ('scheduled', 'in_progress')
        and t.scheduled_start_at + (o.scheduled_offset_min * interval '1 minute') >= now()
    )
  from public.route_stops o
  join public.route_stops d
    on d.route_id = o.route_id
   and d.direction = o.direction
   and d.stop_order > o.stop_order
  join public.routes r on r.id = o.route_id
  where o.stop_id = p_origin_stop_id
    and d.stop_id = p_destination_stop_id
    and r.is_active
  order by (d.scheduled_offset_min - o.scheduled_offset_min),
           (d.distance_from_start_km - o.distance_from_start_km);
$$;

comment on function public.fn_search_routes is
  'Direct (no-transfer) routes serving origin -> destination, ordered by scheduled journey time.';

-- -----------------------------------------------------------------------------
-- fn_nearby_stops: stops within a radius, nearest first.
-- -----------------------------------------------------------------------------
create or replace function public.fn_nearby_stops(
  p_latitude   numeric,
  p_longitude  numeric,
  p_radius_km  numeric default 2,
  p_limit      integer default 10
) returns table (
  stop_id     uuid,
  code        text,
  name        text,
  area        text,
  latitude    numeric,
  longitude   numeric,
  distance_km numeric
)
language sql
stable
as $$
  select
    s.id,
    s.code,
    s.name,
    s.area,
    s.latitude,
    s.longitude,
    public.fn_haversine_km(p_latitude, p_longitude, s.latitude, s.longitude)
  from public.stops s
  where s.is_active
    and public.fn_haversine_km(p_latitude, p_longitude, s.latitude, s.longitude) <= coalesce(p_radius_km, 2)
  order by public.fn_haversine_km(p_latitude, p_longitude, s.latitude, s.longitude)
  limit greatest(coalesce(p_limit, 10), 1);
$$;

-- -----------------------------------------------------------------------------
-- v_route_summary: route list for passengers and the operator dashboard.
-- -----------------------------------------------------------------------------
create or replace view public.v_route_summary as
select
  r.id as route_id,
  r.code,
  r.name,
  r.description,
  r.color,
  r.distance_km,
  r.expected_duration_min,
  r.fare_pkr,
  r.headway_min,
  r.first_departure,
  r.last_departure,
  r.is_active,
  (select count(*) from public.route_stops rs
    where rs.route_id = r.id and rs.direction = 'outbound')::integer as outbound_stop_count,
  (select count(*) from public.route_stops rs
    where rs.route_id = r.id and rs.direction = 'inbound')::integer as inbound_stop_count,
  (select s.name from public.route_stops rs
     join public.stops s on s.id = rs.stop_id
    where rs.route_id = r.id and rs.direction = 'outbound'
    order by rs.stop_order asc limit 1) as origin_stop_name,
  (select s.name from public.route_stops rs
     join public.stops s on s.id = rs.stop_id
    where rs.route_id = r.id and rs.direction = 'outbound'
    order by rs.stop_order desc limit 1) as destination_stop_name,
  (select count(*) from public.trips t
    where t.route_id = r.id and t.status = 'in_progress')::integer as active_trip_count,
  (select count(*) from public.trips t
    where t.route_id = r.id and t.status = 'in_progress' and t.delay_minutes >= 5)::integer as delayed_trip_count
from public.routes r;

comment on view public.v_route_summary is 'Route catalogue with stop counts, endpoints and live trip counts.';

-- -----------------------------------------------------------------------------
-- v_fleet_overview: single-row KPI strip for the operator dashboard.
-- -----------------------------------------------------------------------------
create or replace view public.v_fleet_overview as
select
  (select count(*) from public.buses)::integer as total_buses,
  (select count(*) from public.buses where status = 'active')::integer as active_buses,
  (select count(*) from public.buses where status = 'idle')::integer as idle_buses,
  (select count(*) from public.buses where status = 'maintenance')::integer as maintenance_buses,
  (select count(*) from public.buses where status = 'offline')::integer as offline_buses,
  (select count(*) from public.routes where is_active)::integer as active_routes,
  (select count(*) from public.stops where is_active)::integer as active_stops,
  (select count(*) from public.trips where status = 'in_progress')::integer as trips_in_progress,
  (select count(*) from public.trips where status = 'in_progress' and delay_minutes >= 5)::integer as delayed_trips,
  (select count(*) from public.trips where status = 'scheduled' and scheduled_start_at >= now())::integer as upcoming_trips,
  (select coalesce(round(avg(delay_minutes), 1), 0) from public.trips where status = 'in_progress') as avg_delay_minutes,
  (select count(*) from public.service_alerts where is_active)::integer as active_alerts;

comment on view public.v_fleet_overview is 'Aggregate KPIs for the operator monitoring header.';
