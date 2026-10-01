-- =============================================================================
-- Smart Public Transport & Bus Tracking Platform - Karachi
-- Migration 1/3: core relational schema
--
-- DEMO / SIMULATED DATA NOTICE
-- This schema is built for a hackathon demonstration. Route names, stop
-- groupings, schedules, fares, bus registrations and driver records that are
-- loaded by supabase/seed.sql are INVENTED for the demo. Stop coordinates point
-- at real, well-known Karachi landmarks so the map looks plausible, but no part
-- of this dataset should be presented as the actual Karachi public transport
-- network. See docs/ASSUMPTIONS.md.
--
-- All timestamps are timestamptz (stored UTC). Karachi is UTC+05:00 with no
-- daylight saving; render with `AT TIME ZONE 'Asia/Karachi'` in the UI.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('passenger', 'driver', 'operator', 'admin');

create type public.driver_status as enum ('active', 'off_duty', 'on_leave');

create type public.bus_status as enum ('active', 'idle', 'maintenance', 'offline');

create type public.trip_status as enum ('scheduled', 'in_progress', 'completed', 'cancelled');

create type public.trip_direction as enum ('outbound', 'inbound');

create type public.stop_arrival_status as enum ('pending', 'arrived', 'skipped');

create type public.alert_severity as enum ('info', 'warning', 'critical');

-- -----------------------------------------------------------------------------
-- Shared trigger: keep updated_at fresh
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- profiles
-- auth_user_id is nullable on purpose: demo rows are seeded without creating
-- Supabase auth users. Real sign-ups link themselves by setting auth_user_id.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid unique,
  full_name     text not null,
  email         text unique,
  phone         text,
  role          public.user_role not null default 'passenger',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'Application users. auth_user_id links to auth.users(id) once a real account exists; demo rows leave it null.';

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- drivers
-- -----------------------------------------------------------------------------
create table public.drivers (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid unique references public.profiles (id) on delete set null,
  full_name   text not null,
  license_no  text not null unique,
  phone       text,
  status      public.driver_status not null default 'off_duty',
  rating      numeric(2, 1) check (rating between 0 and 5),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.drivers is 'Bus drivers. Demo licence numbers are fabricated (DEMO-LIC-*).';

create index drivers_status_idx on public.drivers (status);

create trigger drivers_set_updated_at
  before update on public.drivers
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- buses
-- -----------------------------------------------------------------------------
create table public.buses (
  id                 uuid primary key default gen_random_uuid(),
  registration_no    text not null unique,
  label              text,
  model              text,
  capacity           integer not null default 45 check (capacity > 0),
  has_ac             boolean not null default false,
  status             public.bus_status not null default 'offline',
  assigned_driver_id uuid references public.drivers (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.buses is
  'Fleet vehicles. status is the live vehicle state: active (running a trip), idle (available), maintenance, offline (no telemetry).';

create index buses_status_idx on public.buses (status);

create trigger buses_set_updated_at
  before update on public.buses
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- routes
-- -----------------------------------------------------------------------------
create table public.routes (
  id                   uuid primary key default gen_random_uuid(),
  code                 text not null unique,
  name                 text not null,
  description          text,
  color                text not null default '#2563eb' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  distance_km          numeric(6, 2) not null check (distance_km > 0),
  avg_speed_kmh        numeric(5, 2) not null default 18 check (avg_speed_kmh > 0),
  expected_duration_min integer not null check (expected_duration_min > 0),
  fare_pkr             numeric(7, 2) not null default 50 check (fare_pkr >= 0),
  headway_min          integer not null default 20 check (headway_min > 0),
  first_departure      time,
  last_departure       time,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.routes is
  'Demo bus corridors. avg_speed_kmh is the planning speed used by the deterministic ETA fallback.';

create trigger routes_set_updated_at
  before update on public.routes
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- stops
-- -----------------------------------------------------------------------------
create table public.stops (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  area       text,
  latitude   numeric(9, 6) not null check (latitude between -90 and 90),
  longitude  numeric(9, 6) not null check (longitude between -180 and 180),
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.stops is
  'Physical stop locations. Coordinates are approximate positions of real Karachi landmarks; the stops themselves are demo constructs.';

create index stops_lat_lon_idx on public.stops (latitude, longitude);

-- -----------------------------------------------------------------------------
-- route_stops: ordered sequence of stops per route and direction
-- -----------------------------------------------------------------------------
create table public.route_stops (
  id                     uuid primary key default gen_random_uuid(),
  route_id               uuid not null references public.routes (id) on delete cascade,
  stop_id                uuid not null references public.stops (id) on delete restrict,
  direction              public.trip_direction not null default 'outbound',
  stop_order             integer not null check (stop_order > 0),
  distance_from_start_km numeric(6, 2) not null default 0 check (distance_from_start_km >= 0),
  scheduled_offset_min   integer not null default 0 check (scheduled_offset_min >= 0),
  is_major_stop          boolean not null default false,
  constraint route_stops_unique_order unique (route_id, direction, stop_order),
  constraint route_stops_unique_stop  unique (route_id, direction, stop_id)
);

comment on table public.route_stops is
  'Route -> stop ordering. distance_from_start_km drives distance-based ETA; scheduled_offset_min is minutes after trip start for the timetable.';

create index route_stops_route_dir_order_idx on public.route_stops (route_id, direction, stop_order);
create index route_stops_stop_idx on public.route_stops (stop_id);

-- -----------------------------------------------------------------------------
-- trips: one bus running one route in one direction at a point in time
-- -----------------------------------------------------------------------------
create table public.trips (
  id                 uuid primary key default gen_random_uuid(),
  trip_code          text not null unique,
  route_id           uuid not null references public.routes (id) on delete cascade,
  bus_id             uuid not null references public.buses (id) on delete restrict,
  driver_id          uuid references public.drivers (id) on delete set null,
  direction          public.trip_direction not null default 'outbound',
  service_date       date not null default current_date,
  scheduled_start_at timestamptz not null,
  scheduled_end_at   timestamptz not null,
  actual_start_at    timestamptz,
  actual_end_at      timestamptz,
  status             public.trip_status not null default 'scheduled',
  delay_minutes      integer not null default 0,
  progress_km        numeric(6, 2) not null default 0 check (progress_km >= 0),
  last_stop_order    integer check (last_stop_order >= 0),
  next_stop_id       uuid references public.stops (id) on delete set null,
  occupancy          integer not null default 0 check (occupancy >= 0),
  notes              text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint trips_schedule_order check (scheduled_end_at > scheduled_start_at)
);

comment on table public.trips is
  'A scheduled or running service. delay_minutes is positive when late, negative when early. progress_km is distance covered from the route origin.';

create index trips_status_idx on public.trips (status);
create index trips_route_idx on public.trips (route_id, service_date);
create index trips_bus_idx on public.trips (bus_id, service_date);

create trigger trips_set_updated_at
  before update on public.trips
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- bus_locations: GPS history (the "trip_locations" equivalent)
-- trip_id is nullable so a parked/idle bus can still report a last known fix.
-- -----------------------------------------------------------------------------
create table public.bus_locations (
  id          bigint generated always as identity primary key,
  bus_id      uuid not null references public.buses (id) on delete cascade,
  trip_id     uuid references public.trips (id) on delete set null,
  recorded_at timestamptz not null default now(),
  latitude    numeric(9, 6) not null check (latitude between -90 and 90),
  longitude   numeric(9, 6) not null check (longitude between -180 and 180),
  speed_kmh   numeric(5, 2) not null default 0 check (speed_kmh >= 0),
  heading_deg numeric(5, 2) check (heading_deg >= 0 and heading_deg < 360),
  progress_km numeric(6, 2) check (progress_km >= 0),
  source      text not null default 'simulated' check (source in ('simulated', 'device', 'manual'))
);

comment on table public.bus_locations is
  'Append-only location history for every bus. Latest row per bus is exposed by v_bus_latest_location.';

create index bus_locations_bus_recorded_idx on public.bus_locations (bus_id, recorded_at desc);
create index bus_locations_trip_recorded_idx on public.bus_locations (trip_id, recorded_at desc);

-- -----------------------------------------------------------------------------
-- trip_stop_times: scheduled vs estimated vs actual arrival per stop
-- stop_id is denormalised from route_stops to keep passenger queries cheap.
-- -----------------------------------------------------------------------------
create table public.trip_stop_times (
  id                   uuid primary key default gen_random_uuid(),
  trip_id              uuid not null references public.trips (id) on delete cascade,
  route_stop_id        uuid not null references public.route_stops (id) on delete cascade,
  stop_id              uuid not null references public.stops (id) on delete restrict,
  stop_order           integer not null check (stop_order > 0),
  scheduled_arrival_at timestamptz not null,
  estimated_arrival_at timestamptz,
  actual_arrival_at    timestamptz,
  status               public.stop_arrival_status not null default 'pending',
  constraint trip_stop_times_unique unique (trip_id, route_stop_id)
);

comment on table public.trip_stop_times is
  'Per-stop timetable for a trip. Persisted snapshot; v_trip_stop_eta recomputes live estimates deterministically.';

create index trip_stop_times_trip_order_idx on public.trip_stop_times (trip_id, stop_order);
create index trip_stop_times_stop_idx on public.trip_stop_times (stop_id);

-- -----------------------------------------------------------------------------
-- service_alerts
-- -----------------------------------------------------------------------------
create table public.service_alerts (
  id         uuid primary key default gen_random_uuid(),
  title      text not null,
  message    text not null,
  severity   public.alert_severity not null default 'info',
  route_id   uuid references public.routes (id) on delete cascade,
  bus_id     uuid references public.buses (id) on delete cascade,
  stop_id    uuid references public.stops (id) on delete cascade,
  starts_at  timestamptz not null default now(),
  ends_at    timestamptz,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  constraint service_alerts_window check (ends_at is null or ends_at > starts_at)
);

comment on table public.service_alerts is
  'Operator notices. route_id / bus_id / stop_id are all optional so an alert can be network-wide or narrowly scoped.';

create index service_alerts_active_idx on public.service_alerts (is_active, starts_at desc);
