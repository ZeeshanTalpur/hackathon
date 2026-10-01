-- =============================================================================
-- Smart Public Transport & Bus Tracking Platform - Karachi
-- DEMO SEED DATA
--
-- ##########################################################################
-- # EVERYTHING BELOW IS SIMULATED HACKATHON DATA.                          #
-- # The corridors, timetables, fares, headways, bus registrations, drivers #
-- # and passengers are INVENTED. They do not describe any real Karachi bus #
-- # service, operator, schedule or fare. Stop coordinates are approximate  #
-- # positions of real, well-known Karachi landmarks so the map renders      #
-- # believably - the stops themselves are demo constructs.                 #
-- ##########################################################################
--
-- The script is idempotent: it truncates the demo tables and reloads them, so
-- it can be re-run to refresh the "live" timestamps before a demo.
--
-- All trip times are generated relative to now(), so there is always at least
-- one in-progress trip, one delayed bus and one offline bus whenever you run it.
-- =============================================================================

begin;

truncate table
  public.bus_locations,
  public.trip_stop_times,
  public.trips,
  public.service_alerts,
  public.route_stops,
  public.buses,
  public.drivers,
  public.stops,
  public.routes,
  public.profiles
restart identity cascade;

-- -----------------------------------------------------------------------------
-- profiles (10) - emails use the reserved .invalid TLD so they can never
-- resolve to a real mailbox; phone numbers are placeholders.
-- -----------------------------------------------------------------------------
insert into public.profiles (full_name, email, phone, role) values
  ('Hamza Qureshi',   'hamza.qureshi@demo.invalid',   '+92-300-0000001', 'admin'),
  ('Ayesha Siddiqui', 'ayesha.siddiqui@demo.invalid', '+92-300-0000002', 'operator'),
  ('Bilal Raza',      'bilal.raza@demo.invalid',      '+92-300-0000003', 'operator'),
  ('Muhammad Asif',   'm.asif@demo.invalid',          '+92-300-0000011', 'driver'),
  ('Zubair Ahmed',    'zubair.ahmed@demo.invalid',    '+92-300-0000012', 'driver'),
  ('Noman Shaikh',    'noman.shaikh@demo.invalid',    '+92-300-0000013', 'driver'),
  ('Sana Fatima',     'sana.fatima@demo.invalid',     '+92-300-0000021', 'passenger'),
  ('Usman Tariq',     'usman.tariq@demo.invalid',     '+92-300-0000022', 'passenger'),
  ('Mehwish Khan',    'mehwish.khan@demo.invalid',    '+92-300-0000023', 'passenger'),
  ('Danish Ali',      'danish.ali@demo.invalid',      '+92-300-0000024', 'passenger');

-- -----------------------------------------------------------------------------
-- drivers (8) - three are linked to a profile, the rest are operator records only
-- -----------------------------------------------------------------------------
insert into public.drivers (full_name, license_no, phone, status, rating, profile_id)
select v.full_name, v.license_no, v.phone, v.status::public.driver_status, v.rating, p.id
from (values
  ('Muhammad Asif',  'DEMO-LIC-1001', '+92-300-0000011', 'active',   4.6, 'm.asif@demo.invalid'),
  ('Zubair Ahmed',   'DEMO-LIC-1002', '+92-300-0000012', 'active',   4.2, 'zubair.ahmed@demo.invalid'),
  ('Noman Shaikh',   'DEMO-LIC-1003', '+92-300-0000013', 'active',   4.8, 'noman.shaikh@demo.invalid'),
  ('Faisal Mehmood', 'DEMO-LIC-1004', '+92-300-0000014', 'active',   4.1, null),
  ('Rashid Ali',     'DEMO-LIC-1005', '+92-300-0000015', 'active',   3.9, null),
  ('Sajid Hussain',  'DEMO-LIC-1006', '+92-300-0000016', 'active',   4.4, null),
  ('Imtiaz Baloch',  'DEMO-LIC-1007', '+92-300-0000017', 'off_duty', 4.0, null),
  ('Waqar Siddiqui', 'DEMO-LIC-1008', '+92-300-0000018', 'on_leave', 4.3, null)
) as v(full_name, license_no, phone, status, rating, profile_email)
left join public.profiles p on p.email = v.profile_email;

-- -----------------------------------------------------------------------------
-- buses (10): 4 active, 3 idle, 1 maintenance, 2 offline
-- -----------------------------------------------------------------------------
insert into public.buses (registration_no, label, model, capacity, has_ac, status, assigned_driver_id)
select v.registration_no, v.label, v.model, v.capacity, v.has_ac,
       v.status::public.bus_status, d.id
from (values
  ('DEMO-KHI-101', 'Bus 101', 'Hino AK1J',        52, false, 'active',      'DEMO-LIC-1001'),
  ('DEMO-KHI-102', 'Bus 102', 'Hino AK1J',        52, false, 'active',      'DEMO-LIC-1002'),
  ('DEMO-KHI-103', 'Bus 103', 'Isuzu LT134',      45, true,  'active',      'DEMO-LIC-1003'),
  ('DEMO-KHI-104', 'Bus 104', 'Isuzu LT134',      45, true,  'idle',        'DEMO-LIC-1007'),
  ('DEMO-KHI-105', 'Bus 105', 'Hino AK1J',        52, false, 'idle',        'DEMO-LIC-1005'),
  ('DEMO-KHI-106', 'Bus 106', 'Toyota Coaster',   32, true,  'maintenance', null),
  ('DEMO-KHI-107', 'Bus 107', 'Hino AK1J',        52, false, 'offline',     null),
  ('DEMO-KHI-108', 'Bus 108', 'Daewoo BH116',     60, true,  'active',      'DEMO-LIC-1004'),
  ('DEMO-KHI-109', 'Bus 109', 'Isuzu LT134',      45, false, 'idle',        'DEMO-LIC-1006'),
  ('DEMO-KHI-110', 'Bus 110', 'Toyota Coaster',   32, false, 'offline',     null)
) as v(registration_no, label, model, capacity, has_ac, status, license_no)
left join public.drivers d on d.license_no = v.license_no;

-- -----------------------------------------------------------------------------
-- stops (31) - coordinates are approximate positions of real Karachi landmarks
-- -----------------------------------------------------------------------------
insert into public.stops (code, name, area, latitude, longitude) values
  ('ST-TWR',  'Tower',                        'Kharadar',          24.850300, 66.996800),
  ('ST-KMR',  'Keamari',                      'Keamari',           24.842600, 66.986900),
  ('ST-IICR', 'I.I. Chundrigar Road',         'City',              24.853400, 67.004300),
  ('ST-JCM',  'Jama Cloth Market',            'Saddar',            24.854000, 67.012000),
  ('ST-SDR',  'Saddar (Empress Market)',      'Saddar',            24.860700, 67.009900),
  ('ST-NMS',  'Numaish Chowrangi',            'Soldier Bazaar',    24.872700, 67.030000),
  ('ST-LSB',  'Lasbela Chowk',                'Garden',            24.882900, 67.027900),
  ('ST-TNH',  'Teen Hatti',                   'Jamshed Town',      24.889400, 67.033000),
  ('ST-NZ1',  'Nazimabad No. 1',              'Nazimabad',         24.906400, 67.031800),
  ('ST-BRD',  'Board Office',                 'North Nazimabad',   24.922200, 67.039400),
  ('ST-FSC',  'Five Star Chowrangi',          'North Nazimabad',   24.931800, 67.037500),
  ('ST-PWH',  'Power House Chowrangi',        'North Karachi',     24.949900, 67.065900),
  ('ST-NGC',  'Nagan Chowrangi',              'North Karachi',     24.958900, 67.063600),
  ('ST-UPM',  'UP More',                      'North Nazimabad',   24.946600, 67.054500),
  ('ST-SRJ',  'Surjani Town Sector 5-C',      'Surjani Town',      25.007200, 67.058500),
  ('ST-FTC',  'FTC Flyover',                  'Shahrah-e-Faisal',  24.859300, 67.054100),
  ('ST-NUR',  'Nursery',                      'Shahrah-e-Faisal',  24.865000, 67.067800),
  ('ST-BLC',  'Baloch Colony Flyover',        'Shahrah-e-Faisal',  24.861700, 67.074900),
  ('ST-KSZ',  'Karsaz',                       'Shahrah-e-Faisal',  24.874400, 67.090600),
  ('ST-MLM',  'Millennium Mall',              'Gulshan-e-Iqbal',   24.883000, 67.099900),
  ('ST-NPA',  'NIPA Chowrangi',               'Gulshan-e-Iqbal',   24.918300, 67.091900),
  ('ST-GLC',  'Gulshan-e-Iqbal Chowrangi',    'Gulshan-e-Iqbal',   24.923000, 67.089000),
  ('ST-MDC',  'Model Colony',                 'Malir',             24.905400, 67.178800),
  ('ST-MLH',  'Malir Halt',                   'Malir',             24.893000, 67.177000),
  ('ST-APT',  'Jinnah International Airport', 'Airport',           24.906500, 67.160800),
  ('ST-STG',  'Star Gate',                    'Airport',           24.893000, 67.145200),
  ('ST-NTK',  'Natha Khan',                   'Shahrah-e-Faisal',  24.878100, 67.124600),
  ('ST-BTB',  'Boat Basin',                   'Clifton',           24.821500, 67.034500),
  ('ST-TTL',  'Teen Talwar',                  'Clifton',           24.816700, 67.031000),
  ('ST-KRC',  'Korangi Crossing',             'Korangi',           24.826500, 67.131400),
  ('ST-QYB',  'Qayyumabad',                   'Korangi Road',      24.834900, 67.087500);

-- -----------------------------------------------------------------------------
-- routes (5) - invented corridors. avg_speed_kmh = distance_km / duration * 60.
-- -----------------------------------------------------------------------------
insert into public.routes
  (code, name, description, color, distance_km, avg_speed_kmh, expected_duration_min,
   fare_pkr, headway_min, first_departure, last_departure)
values
  ('KHI-D1', 'D1 Tower - Power House',
   'Demo corridor: old city to North Karachi via Nazimabad.',
   '#16a34a', 16.00, 16.00, 60, 60.00, 15, '06:00', '22:30'),
  ('KHI-D2', 'D2 Keamari - Gulshan-e-Iqbal',
   'Demo corridor: port area to Gulshan via Shahrah-e-Faisal.',
   '#2563eb', 18.00, 17.40, 62, 70.00, 20, '06:15', '22:00'),
  ('KHI-D3', 'D3 Surjani Town - Saddar',
   'Demo corridor: northern suburbs to the city centre.',
   '#f59e0b', 18.80, 17.30, 65, 70.00, 25, '05:45', '21:30'),
  ('KHI-D4', 'D4 Model Colony - Clifton',
   'Demo corridor: Malir and the airport to the seafront.',
   '#db2777', 22.50, 18.70, 72, 80.00, 30, '06:30', '21:00'),
  ('KHI-D5', 'D5 Korangi Crossing - Tower',
   'Demo corridor: Korangi to the old city via Clifton.',
   '#7c3aed', 15.50, 18.20, 51, 55.00, 25, '06:00', '22:00');

-- -----------------------------------------------------------------------------
-- route_stops - outbound sequences.
-- distance_from_start_km and scheduled_offset_min are hand-set so that the last
-- stop's offset equals the route's expected_duration_min.
-- -----------------------------------------------------------------------------
insert into public.route_stops
  (route_id, stop_id, direction, stop_order, distance_from_start_km, scheduled_offset_min, is_major_stop)
select r.id, s.id, 'outbound'::public.trip_direction, v.stop_order, v.km, v.offset_min, v.major
from (values
  -- D1 Tower -> Power House (16.0 km / 60 min)
  ('KHI-D1', 'ST-TWR',   1,  0.00,  0, true),
  ('KHI-D1', 'ST-IICR',  2,  1.10,  4, false),
  ('KHI-D1', 'ST-SDR',   3,  2.30,  9, true),
  ('KHI-D1', 'ST-NMS',   4,  4.80, 17, false),
  ('KHI-D1', 'ST-LSB',   5,  6.00, 22, false),
  ('KHI-D1', 'ST-TNH',   6,  7.00, 26, false),
  ('KHI-D1', 'ST-NZ1',   7,  9.00, 33, true),
  ('KHI-D1', 'ST-BRD',   8, 11.00, 40, false),
  ('KHI-D1', 'ST-FSC',   9, 12.60, 45, true),
  ('KHI-D1', 'ST-PWH',  10, 16.00, 60, true),
  -- D2 Keamari -> Gulshan-e-Iqbal (18.0 km / 62 min)
  ('KHI-D2', 'ST-KMR',   1,  0.00,  0, true),
  ('KHI-D2', 'ST-TWR',   2,  1.50,  6, true),
  ('KHI-D2', 'ST-SDR',   3,  3.50, 14, true),
  ('KHI-D2', 'ST-FTC',   4,  7.30, 25, false),
  ('KHI-D2', 'ST-NUR',   5,  9.00, 30, false),
  ('KHI-D2', 'ST-BLC',   6, 10.20, 34, false),
  ('KHI-D2', 'ST-KSZ',   7, 12.30, 41, false),
  ('KHI-D2', 'ST-MLM',   8, 13.70, 45, false),
  ('KHI-D2', 'ST-NPA',   9, 17.00, 57, true),
  ('KHI-D2', 'ST-GLC',  10, 18.00, 62, true),
  -- D3 Surjani Town -> Saddar (18.8 km / 65 min)
  ('KHI-D3', 'ST-SRJ',   1,  0.00,  0, true),
  ('KHI-D3', 'ST-NGC',   2,  6.00, 18, true),
  ('KHI-D3', 'ST-PWH',   3,  7.50, 23, true),
  ('KHI-D3', 'ST-UPM',   4,  9.00, 28, false),
  ('KHI-D3', 'ST-BRD',   5, 11.00, 35, false),
  ('KHI-D3', 'ST-NZ1',   6, 13.00, 42, true),
  ('KHI-D3', 'ST-LSB',   7, 15.00, 49, false),
  ('KHI-D3', 'ST-NMS',   8, 16.30, 54, false),
  ('KHI-D3', 'ST-SDR',   9, 18.80, 65, true),
  -- D4 Model Colony -> Clifton (22.5 km / 72 min)
  ('KHI-D4', 'ST-MDC',   1,  0.00,  0, true),
  ('KHI-D4', 'ST-MLH',   2,  2.00,  7, false),
  ('KHI-D4', 'ST-APT',   3,  5.00, 16, true),
  ('KHI-D4', 'ST-STG',   4,  7.20, 23, false),
  ('KHI-D4', 'ST-NTK',   5, 10.00, 32, false),
  ('KHI-D4', 'ST-MLM',   6, 12.50, 39, false),
  ('KHI-D4', 'ST-KSZ',   7, 14.00, 44, false),
  ('KHI-D4', 'ST-NUR',   8, 16.80, 53, false),
  ('KHI-D4', 'ST-BTB',   9, 21.50, 68, false),
  ('KHI-D4', 'ST-TTL',  10, 22.50, 72, true),
  -- D5 Korangi Crossing -> Tower (15.5 km / 51 min)
  ('KHI-D5', 'ST-KRC',   1,  0.00,  0, true),
  ('KHI-D5', 'ST-QYB',   2,  5.50, 18, false),
  ('KHI-D5', 'ST-BTB',   3,  9.50, 30, true),
  ('KHI-D5', 'ST-TTL',   4, 10.50, 34, false),
  ('KHI-D5', 'ST-SDR',   5, 13.50, 44, true),
  ('KHI-D5', 'ST-JCM',   6, 14.30, 47, false),
  ('KHI-D5', 'ST-TWR',   7, 15.50, 51, true)
) as v(route_code, stop_code, stop_order, km, offset_min, major)
join public.routes r on r.code = v.route_code
join public.stops  s on s.code = v.stop_code;

-- Inbound sequences for D1 and D2 only: the outbound list reversed, with
-- distances and timetable offsets mirrored. D3/D4/D5 are one-direction in the
-- demo dataset to keep it small.
insert into public.route_stops
  (route_id, stop_id, direction, stop_order, distance_from_start_km, scheduled_offset_min, is_major_stop)
select
  rs.route_id,
  rs.stop_id,
  'inbound'::public.trip_direction,
  (tot.max_order - rs.stop_order + 1),
  round(r.distance_km - rs.distance_from_start_km, 2),
  (r.expected_duration_min - rs.scheduled_offset_min),
  rs.is_major_stop
from public.route_stops rs
join public.routes r on r.id = rs.route_id
join (
  select route_id, max(stop_order) as max_order
  from public.route_stops
  where direction = 'outbound'
  group by route_id
) tot on tot.route_id = rs.route_id
where rs.direction = 'outbound'
  and r.code in ('KHI-D1', 'KHI-D2');

-- -----------------------------------------------------------------------------
-- trips (8): 4 in progress (one badly delayed, one running early), 2 scheduled,
-- 1 completed, 1 cancelled. All times are relative to now().
-- -----------------------------------------------------------------------------
insert into public.trips
  (trip_code, route_id, bus_id, driver_id, direction, service_date,
   scheduled_start_at, scheduled_end_at, actual_start_at, actual_end_at,
   status, delay_minutes, progress_km, occupancy, notes)
select
  v.trip_code,
  r.id,
  b.id,
  d.id,
  v.direction::public.trip_direction,
  (date_trunc('minute', now()) + (v.start_offset_min * interval '1 minute'))::date,
  date_trunc('minute', now()) + (v.start_offset_min * interval '1 minute'),
  date_trunc('minute', now()) + ((v.start_offset_min + r.expected_duration_min) * interval '1 minute'),
  case
    when v.status in ('in_progress', 'completed')
    then date_trunc('minute', now()) + (v.start_offset_min * interval '1 minute')
  end,
  case
    when v.status = 'completed'
    then date_trunc('minute', now())
         + ((v.start_offset_min + r.expected_duration_min + v.delay_minutes) * interval '1 minute')
  end,
  v.status::public.trip_status,
  v.delay_minutes,
  v.progress_km,
  v.occupancy,
  v.notes
from (values
  ('TRP-D1-0001', 'KHI-D1', 'DEMO-KHI-101', 'DEMO-LIC-1001', 'outbound', 'in_progress',  -35,   2,  9.60, 38, null::text),
  ('TRP-D2-0001', 'KHI-D2', 'DEMO-KHI-102', 'DEMO-LIC-1002', 'outbound', 'in_progress',  -52,  14, 11.20, 47, 'Held up in traffic before Karsaz (demo).'),
  ('TRP-D3-0001', 'KHI-D3', 'DEMO-KHI-103', 'DEMO-LIC-1003', 'outbound', 'in_progress',  -20,  -3,  7.30, 22, 'Running slightly ahead of schedule (demo).'),
  ('TRP-D4-0001', 'KHI-D4', 'DEMO-KHI-108', 'DEMO-LIC-1004', 'outbound', 'in_progress',  -45,   6, 12.80, 29, null),
  ('TRP-D1-0002', 'KHI-D1', 'DEMO-KHI-105', 'DEMO-LIC-1005', 'inbound',  'scheduled',     25,   0,  0.00,  0, null),
  ('TRP-D5-0001', 'KHI-D5', 'DEMO-KHI-109', 'DEMO-LIC-1006', 'outbound', 'scheduled',     40,   0,  0.00,  0, null),
  ('TRP-D2-0002', 'KHI-D2', 'DEMO-KHI-104', 'DEMO-LIC-1007', 'inbound',  'completed',   -180,   8, 18.00,  0, null),
  ('TRP-D1-0003', 'KHI-D1', 'DEMO-KHI-106', 'DEMO-LIC-1008', 'outbound', 'cancelled',     70,   0,  0.00,  0, 'Cancelled - vehicle moved to maintenance (demo).')
) as v(trip_code, route_code, bus_reg, license_no, direction, status,
       start_offset_min, delay_minutes, progress_km, occupancy, notes)
join public.routes  r on r.code = v.route_code
join public.buses   b on b.registration_no = v.bus_reg
join public.drivers d on d.license_no = v.license_no;

-- Derive last_stop_order / next_stop_id from progress_km so the three values can
-- never disagree with the route geometry.
update public.trips t
set last_stop_order = coalesce((
      select max(rs.stop_order)
      from public.route_stops rs
      where rs.route_id = t.route_id
        and rs.direction = t.direction
        and rs.distance_from_start_km <= t.progress_km
    ), 0),
    next_stop_id = (
      select rs.stop_id
      from public.route_stops rs
      where rs.route_id = t.route_id
        and rs.direction = t.direction
        and rs.distance_from_start_km > t.progress_km
      order by rs.stop_order
      limit 1
    )
where t.status = 'in_progress';

update public.trips t
set last_stop_order = (
      select max(rs.stop_order)
      from public.route_stops rs
      where rs.route_id = t.route_id and rs.direction = t.direction
    ),
    next_stop_id = null
where t.status = 'completed';

update public.trips t
set last_stop_order = 0,
    next_stop_id = (
      select rs.stop_id
      from public.route_stops rs
      where rs.route_id = t.route_id
        and rs.direction = t.direction
      order by rs.stop_order
      limit 1
    )
where t.status = 'scheduled';

-- -----------------------------------------------------------------------------
-- trip_stop_times - timetable per trip, generated from route_stops.
-- Stops already served get an actual arrival; the rest stay pending.
-- -----------------------------------------------------------------------------
insert into public.trip_stop_times
  (trip_id, route_stop_id, stop_id, stop_order,
   scheduled_arrival_at, estimated_arrival_at, actual_arrival_at, status)
select
  t.id,
  rs.id,
  rs.stop_id,
  rs.stop_order,
  t.scheduled_start_at + (rs.scheduled_offset_min * interval '1 minute'),
  t.scheduled_start_at + ((rs.scheduled_offset_min + t.delay_minutes) * interval '1 minute'),
  case
    when t.status = 'completed'
      or (t.status = 'in_progress' and rs.stop_order <= coalesce(t.last_stop_order, 0))
    then t.scheduled_start_at + ((rs.scheduled_offset_min + t.delay_minutes) * interval '1 minute')
  end,
  case
    when t.status = 'completed'
      or (t.status = 'in_progress' and rs.stop_order <= coalesce(t.last_stop_order, 0))
    then 'arrived'::public.stop_arrival_status
    else 'pending'::public.stop_arrival_status
  end
from public.trips t
join public.route_stops rs
  on rs.route_id = t.route_id
 and rs.direction = t.direction
where t.status <> 'cancelled';

-- -----------------------------------------------------------------------------
-- bus_locations - a GPS trail for each live trip.
-- Positions are interpolated along the real route geometry by
-- fn_route_point_at_km, so every point sits on the drawn polyline.
-- 8 samples per trip, 2 minutes apart, newest ~30 seconds old.
-- -----------------------------------------------------------------------------
do $$
declare
  v_trip    record;
  v_point   record;
  v_sample  integer;
  v_km      numeric;
  v_speed   numeric;
  v_factor  numeric;
begin
  for v_trip in
    select t.id as trip_id, t.bus_id, t.route_id, t.direction,
           t.progress_km, t.delay_minutes, r.avg_speed_kmh
    from public.trips t
    join public.routes r on r.id = t.route_id
    where t.status = 'in_progress'
  loop
    -- A delayed bus crawls; an on-time bus runs near its planning speed.
    v_factor := case when v_trip.delay_minutes >= 10 then 0.45 else 0.85 end;

    for v_sample in reverse 7..0 loop
      v_km := greatest(
        v_trip.progress_km - (v_sample * v_trip.avg_speed_kmh * v_factor * 2 / 60.0),
        0
      );

      v_speed := round(v_trip.avg_speed_kmh * (v_factor + 0.05 * (v_sample % 4)), 2);

      -- Newest fix of the badly delayed bus: stationary in traffic. The ETA view
      -- falls back to the route planning speed when the reported speed is zero.
      if v_sample = 0 and v_trip.delay_minutes >= 10 then
        v_speed := 0;
      end if;

      select * into v_point
      from public.fn_route_point_at_km(v_trip.route_id, v_trip.direction, v_km);

      insert into public.bus_locations
        (bus_id, trip_id, recorded_at, latitude, longitude, speed_kmh, heading_deg, progress_km, source)
      values (
        v_trip.bus_id,
        v_trip.trip_id,
        now() - make_interval(secs => v_sample * 120 + 30),
        v_point.latitude,
        v_point.longitude,
        v_speed,
        v_point.heading_deg,
        round(v_km, 2),
        'simulated'
      );
    end loop;
  end loop;
end
$$;

-- Last known fix for every bus that is not on a trip. The two offline buses have
-- deliberately stale timestamps so v_fleet_status.telemetry_stale flags them.
insert into public.bus_locations
  (bus_id, trip_id, recorded_at, latitude, longitude, speed_kmh, heading_deg, progress_km, source)
select
  b.id,
  null,
  now() - (v.age_minutes * interval '1 minute'),
  s.latitude,
  s.longitude,
  0,
  0,
  0,
  'simulated'
from (values
  ('DEMO-KHI-104', 'ST-KMR',    95),     -- idle at the Keamari end of D2
  ('DEMO-KHI-105', 'ST-PWH',    40),     -- idle, waiting to start the D1 inbound
  ('DEMO-KHI-106', 'ST-NZ1',   300),     -- maintenance
  ('DEMO-KHI-107', 'ST-SRJ',  4320),     -- offline: no data for 3 days
  ('DEMO-KHI-109', 'ST-KRC',    55),     -- idle at the Korangi end of D5
  ('DEMO-KHI-110', 'ST-MDC',  1440)      -- offline: no data for 1 day
) as v(registration_no, stop_code, age_minutes)
join public.buses b on b.registration_no = v.registration_no
join public.stops s on s.code = v.stop_code;

-- -----------------------------------------------------------------------------
-- service_alerts (5) - 4 active, 1 expired
-- -----------------------------------------------------------------------------
insert into public.service_alerts
  (title, message, severity, route_id, bus_id, stop_id, starts_at, ends_at, is_active)
select
  v.title,
  v.message,
  v.severity::public.alert_severity,
  r.id,
  b.id,
  s.id,
  now() + (v.starts_in_min * interval '1 minute'),
  case when v.ends_in_min is not null then now() + (v.ends_in_min * interval '1 minute') end,
  v.is_active
from (values
  ('Heavy traffic on Shahrah-e-Faisal',
   'D2 services are running up to 15 minutes late between FTC and Karsaz.',
   'warning', 'KHI-D2', null, 'ST-KSZ', -40, null::integer, true),
  ('Vehicle telemetry lost',
   'Bus DEMO-KHI-107 has not reported a position for over 48 hours. Workshop check requested.',
   'critical', null, 'DEMO-KHI-107', null, -2880, null, true),
  ('Extra buses for the evening peak',
   'Two additional buses are being added to D1 between 17:00 and 20:00.',
   'info', 'KHI-D1', null, null, -180, 300, true),
  ('Road work near Star Gate',
   'D4 is diverting around the Star Gate junction. Expect delays of 5-10 minutes.',
   'warning', 'KHI-D4', null, 'ST-STG', -1440, 2880, true),
  ('Resolved: D3 diversion at Nagan Chowrangi',
   'The Nagan Chowrangi diversion has been lifted and D3 is back on its normal path.',
   'info', 'KHI-D3', null, 'ST-NGC', -4320, -120, false)
) as v(title, message, severity, route_code, bus_reg, stop_code, starts_in_min, ends_in_min, is_active)
left join public.routes r on r.code = v.route_code
left join public.buses  b on b.registration_no = v.bus_reg
left join public.stops  s on s.code = v.stop_code;

commit;

-- -----------------------------------------------------------------------------
-- Row counts after seeding
-- -----------------------------------------------------------------------------
select 'profiles' as table_name, count(*) from public.profiles
union all select 'drivers',         count(*) from public.drivers
union all select 'buses',           count(*) from public.buses
union all select 'stops',           count(*) from public.stops
union all select 'routes',          count(*) from public.routes
union all select 'route_stops',     count(*) from public.route_stops
union all select 'trips',           count(*) from public.trips
union all select 'trip_stop_times', count(*) from public.trip_stop_times
union all select 'bus_locations',   count(*) from public.bus_locations
union all select 'service_alerts',  count(*) from public.service_alerts
order by table_name;
