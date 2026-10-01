/**
 * Hand-maintained types for the schema in supabase/migrations.
 *
 * Replace this file with generated types once the project has credentials:
 *
 *   npx supabase gen types typescript --project-id <ref> --schema public \
 *     > src/lib/types/database.ts
 *
 * Until then this is the typed contract for the golden path. It covers the
 * tables, views and RPC functions the application actually uses.
 *
 * NOTE: every row shape below is a `type` alias, not an `interface`. postgrest-js
 * constrains rows to `Record<string, unknown>`, and TypeScript only gives
 * implicit index signatures to type aliases - an interface silently fails the
 * constraint and every query result collapses to `never`.
 */

// ---------------------------------------------------------------------------
// Enums (mirror the Postgres enum types)
// ---------------------------------------------------------------------------

export type UserRole = 'passenger' | 'driver' | 'operator' | 'admin';
export type DriverStatus = 'active' | 'off_duty' | 'on_leave';
export type BusStatus = 'active' | 'idle' | 'maintenance' | 'offline';
export type TripStatus = 'scheduled' | 'in_progress' | 'completed' | 'cancelled';
export type TripDirection = 'outbound' | 'inbound';
export type StopArrivalStatus = 'pending' | 'arrived' | 'skipped';
export type AlertSeverity = 'info' | 'warning' | 'critical';

/** Derived in the live views from the age of the newest GPS fix. */
export type GpsStatus = 'live' | 'stale' | 'no_fix';

/** bus_locations.source - distinguishes a real phone fix from a simulated one. */
export type LocationSource = 'simulated' | 'device' | 'manual';

// ---------------------------------------------------------------------------
// Table rows
// ---------------------------------------------------------------------------

export type Profile = {
  id: string;
  auth_user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type Driver = {
  id: string;
  profile_id: string | null;
  full_name: string;
  license_no: string;
  phone: string | null;
  status: DriverStatus;
  rating: number | null;
  created_at: string;
  updated_at: string;
};

export type Bus = {
  id: string;
  registration_no: string;
  label: string | null;
  model: string | null;
  capacity: number;
  has_ac: boolean;
  status: BusStatus;
  assigned_driver_id: string | null;
  created_at: string;
  updated_at: string;
};

export type Route = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  color: string;
  distance_km: number;
  avg_speed_kmh: number;
  expected_duration_min: number;
  fare_pkr: number;
  headway_min: number;
  first_departure: string | null;
  last_departure: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Stop = {
  id: string;
  code: string;
  name: string;
  area: string | null;
  latitude: number;
  longitude: number;
  is_active: boolean;
  created_at: string;
};

export type RouteStop = {
  id: string;
  route_id: string;
  stop_id: string;
  direction: TripDirection;
  stop_order: number;
  distance_from_start_km: number;
  scheduled_offset_min: number;
  is_major_stop: boolean;
};

export type Trip = {
  id: string;
  trip_code: string;
  route_id: string;
  bus_id: string;
  driver_id: string | null;
  direction: TripDirection;
  service_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  status: TripStatus;
  delay_minutes: number;
  progress_km: number;
  last_stop_order: number | null;
  next_stop_id: string | null;
  occupancy: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BusLocation = {
  id: number;
  bus_id: string;
  trip_id: string | null;
  recorded_at: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  heading_deg: number | null;
  progress_km: number | null;
  source: LocationSource;
};

/** The payload the driver app inserts on each GPS tick. */
export type BusLocationInsert = Pick<BusLocation, 'bus_id' | 'latitude' | 'longitude'> &
  Partial<
    Pick<
      BusLocation,
      'trip_id' | 'recorded_at' | 'speed_kmh' | 'heading_deg' | 'progress_km' | 'source'
    >
  >;

export type TripStopTime = {
  id: string;
  trip_id: string;
  route_stop_id: string;
  stop_id: string;
  stop_order: number;
  scheduled_arrival_at: string;
  estimated_arrival_at: string | null;
  actual_arrival_at: string | null;
  status: StopArrivalStatus;
};

export type ServiceAlert = {
  id: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  route_id: string | null;
  bus_id: string | null;
  stop_id: string | null;
  starts_at: string;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
};

// ---------------------------------------------------------------------------
// View rows
// ---------------------------------------------------------------------------

/** v_active_trips - the live map payload. */
export type ActiveTrip = {
  trip_id: string;
  trip_code: string;
  status: TripStatus;
  direction: TripDirection;
  service_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  actual_start_at: string | null;
  delay_minutes: number;
  is_delayed: boolean;
  progress_km: number;
  last_stop_order: number | null;
  occupancy: number;
  route_id: string;
  route_code: string;
  route_name: string;
  route_color: string;
  route_distance_km: number;
  fare_pkr: number;
  progress_pct: number;
  bus_id: string;
  registration_no: string;
  bus_label: string | null;
  capacity: number;
  occupancy_pct: number;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  next_stop_id: string | null;
  next_stop_name: string | null;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  location_recorded_at: string | null;
  elapsed_minutes: number;
  location_age: string | null;
  /** True when the newest fix is older than 3 minutes - do not draw as live. */
  location_is_stale: boolean;
  gps_status: GpsStatus;
};

/** v_trip_stop_eta - deterministic per-stop ETA. */
export type TripStopEta = {
  trip_id: string;
  trip_code: string;
  route_id: string;
  route_code: string;
  direction: TripDirection;
  stop_id: string;
  stop_code: string;
  stop_name: string;
  stop_order: number;
  latitude: number;
  longitude: number;
  distance_from_start_km: number;
  remaining_km: number;
  effective_speed_kmh: number;
  stops_ahead: number;
  eta_minutes: number;
  estimated_arrival_at: string;
  scheduled_arrival_at: string;
  projected_delay_minutes: number;
  gps_status: GpsStatus;
};

/** v_fleet_status - one row per bus, for operator monitoring. */
export type FleetStatus = {
  bus_id: string;
  registration_no: string;
  bus_label: string | null;
  bus_status: BusStatus;
  capacity: number;
  driver_id: string | null;
  driver_name: string | null;
  trip_id: string | null;
  trip_code: string | null;
  trip_status: TripStatus | null;
  route_id: string | null;
  route_code: string | null;
  route_name: string | null;
  route_color: string | null;
  delay_minutes: number | null;
  is_delayed: boolean;
  progress_km: number | null;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  location_recorded_at: string | null;
  location_age: string | null;
  /** True when the newest fix is older than 10 minutes. */
  telemetry_stale: boolean;
  gps_status: GpsStatus;
};

/** v_fleet_overview - single-row KPI strip. */
export type FleetOverview = {
  total_buses: number;
  active_buses: number;
  idle_buses: number;
  maintenance_buses: number;
  offline_buses: number;
  active_routes: number;
  active_stops: number;
  trips_in_progress: number;
  delayed_trips: number;
  upcoming_trips: number;
  avg_delay_minutes: number;
  active_alerts: number;
};

/** v_route_summary - route catalogue. */
export type RouteSummary = {
  route_id: string;
  code: string;
  name: string;
  description: string | null;
  color: string;
  distance_km: number;
  expected_duration_min: number;
  fare_pkr: number;
  headway_min: number;
  first_departure: string | null;
  last_departure: string | null;
  is_active: boolean;
  outbound_stop_count: number;
  inbound_stop_count: number;
  origin_stop_name: string | null;
  destination_stop_name: string | null;
  active_trip_count: number;
  delayed_trip_count: number;
};

/**
 * v_trip_live - per-trip state for ANY status, with one derived
 * `operational_state` for the UI to switch on. Used by the tracking screen,
 * which must keep working after the driver ends the trip.
 */
export type OperationalState =
  | 'SCHEDULED'
  | 'ON_TIME'
  | 'DELAYED'
  | 'STOPPED'
  | 'GPS_UNAVAILABLE'
  | 'COMPLETED'
  | 'CANCELLED';

export type TripLive = {
  trip_id: string;
  trip_code: string;
  status: TripStatus;
  direction: TripDirection;
  service_date: string;
  scheduled_start_at: string;
  scheduled_end_at: string;
  actual_start_at: string | null;
  actual_end_at: string | null;
  delay_minutes: number;
  is_delayed: boolean;
  progress_km: number;
  last_stop_order: number | null;
  occupancy: number;
  route_id: string;
  route_code: string;
  route_name: string;
  route_color: string;
  route_distance_km: number;
  expected_duration_min: number;
  avg_speed_kmh: number;
  fare_pkr: number;
  progress_pct: number;
  bus_id: string;
  registration_no: string;
  bus_label: string | null;
  capacity: number;
  bus_status: BusStatus;
  driver_id: string | null;
  driver_name: string | null;
  next_stop_id: string | null;
  next_stop_name: string | null;
  next_stop_latitude: number | null;
  next_stop_longitude: number | null;
  latitude: number | null;
  longitude: number | null;
  speed_kmh: number | null;
  heading_deg: number | null;
  location_recorded_at: string | null;
  location_source: LocationSource | null;
  location_age_minutes: number | null;
  gps_status: GpsStatus;
  operational_state: OperationalState;
};

/** fn_route_path - ordered stops used as the map polyline. */
export type RoutePathStop = {
  stop_order: number;
  stop_id: string;
  stop_code: string;
  stop_name: string;
  latitude: number;
  longitude: number;
  distance_from_start_km: number;
  is_major_stop: boolean;
};

export type BusLatestLocation = {
  bus_id: string;
  trip_id: string | null;
  recorded_at: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  heading_deg: number | null;
  progress_km: number | null;
  source: LocationSource;
  location_age: string;
};

// ---------------------------------------------------------------------------
// RPC return rows
// ---------------------------------------------------------------------------

/** fn_search_routes - direct routes from one stop to another. */
export type RouteSearchResult = {
  route_id: string;
  route_code: string;
  route_name: string;
  route_color: string;
  direction: TripDirection;
  origin_stop_order: number;
  destination_stop_order: number;
  intermediate_stops: number;
  distance_km: number;
  estimated_duration_min: number;
  fare_pkr: number;
  active_trip_count: number;
  next_departure_at: string | null;
};

/** fn_stop_arrivals - next buses approaching a stop. */
export type StopArrival = {
  trip_id: string;
  trip_code: string;
  route_code: string;
  route_name: string;
  route_color: string;
  bus_registration_no: string;
  eta_minutes: number;
  estimated_arrival_at: string;
  scheduled_arrival_at: string;
  projected_delay_minutes: number;
  gps_status: GpsStatus;
};

/** fn_nearby_stops - stops within a radius, nearest first. */
export type NearbyStop = {
  stop_id: string;
  code: string;
  name: string;
  area: string | null;
  latitude: number;
  longitude: number;
  distance_km: number;
};

export type RoutePoint = {
  latitude: number;
  longitude: number;
  heading_deg: number;
};

// ---------------------------------------------------------------------------
// Database shape for the supabase-js generic
// ---------------------------------------------------------------------------

/**
 * `Relationships` is required by postgrest-js's GenericTable / GenericView
 * constraint. We declare no embedded relationships, so an empty tuple is
 * correct - joins are written explicitly.
 */
type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type View<Row> = {
  Row: Row;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<Profile>;
      drivers: Table<Driver>;
      buses: Table<Bus>;
      routes: Table<Route>;
      stops: Table<Stop>;
      route_stops: Table<RouteStop>;
      trips: Table<Trip>;
      bus_locations: Table<BusLocation, BusLocationInsert>;
      trip_stop_times: Table<TripStopTime>;
      service_alerts: Table<ServiceAlert>;
    };
    Views: {
      v_active_trips: View<ActiveTrip>;
      v_trip_stop_eta: View<TripStopEta>;
      v_fleet_status: View<FleetStatus>;
      v_fleet_overview: View<FleetOverview>;
      v_route_summary: View<RouteSummary>;
      v_bus_latest_location: View<BusLatestLocation>;
      v_trip_live: View<TripLive>;
    };
    Functions: {
      fn_route_path: {
        Args: { p_route_id: string; p_direction?: TripDirection };
        Returns: RoutePathStop[];
      };
      fn_start_trip: { Args: { p_trip_id: string }; Returns: string };
      fn_end_trip: { Args: { p_trip_id: string }; Returns: string };
      fn_advance_trip: {
        Args: { p_trip_id: string; p_tick_seconds?: number; p_speed_kmh?: number };
        Returns: string;
      };
      fn_record_trip_location: {
        Args: {
          p_trip_id: string;
          p_latitude: number;
          p_longitude: number;
          p_speed_kmh?: number;
          p_heading_deg?: number;
        };
        Returns: string;
      };
      fn_set_trip_delay: {
        Args: { p_trip_id: string; p_delay_minutes: number };
        Returns: string;
      };
      fn_search_routes: {
        Args: { p_origin_stop_id: string; p_destination_stop_id: string };
        Returns: RouteSearchResult[];
      };
      fn_stop_arrivals: {
        Args: { p_stop_id: string; p_limit?: number };
        Returns: StopArrival[];
      };
      fn_nearby_stops: {
        Args: {
          p_latitude: number;
          p_longitude: number;
          p_radius_km?: number;
          p_limit?: number;
        };
        Returns: NearbyStop[];
      };
      fn_trip_eta_minutes: {
        Args: { p_trip_id: string; p_stop_id: string };
        Returns: number | null;
      };
      fn_route_point_at_km: {
        Args: { p_route_id: string; p_direction: TripDirection; p_km: number };
        Returns: RoutePoint[];
      };
      fn_haversine_km: {
        Args: { p_lat1: number; p_lon1: number; p_lat2: number; p_lon2: number };
        Returns: number;
      };
    };
    Enums: {
      user_role: UserRole;
      driver_status: DriverStatus;
      bus_status: BusStatus;
      trip_status: TripStatus;
      trip_direction: TripDirection;
      stop_arrival_status: StopArrivalStatus;
      alert_severity: AlertSeverity;
    };
  };
};
