-- =============================================================================
-- Wall-clock simulation tick
--
-- fn_advance_trip takes a fixed tick length, which assumes the driver client
-- ticks on a reliable interval. It does not: browsers throttle timers in
-- background tabs, so when the driver window loses focus the bus almost stops
-- and the passenger sees a frozen position.
--
-- This variant derives the advance from the real time since the last recorded
-- fix, so progress is correct however irregularly the client calls it. Missed
-- ticks are caught up rather than lost.
--
-- Still deterministic: position is a pure function of elapsed wall-clock time,
-- speed and the route geometry. No ML, no estimation.
-- =============================================================================

create or replace function public.fn_advance_trip_elapsed(
  p_trip_id     uuid,
  p_speed_kmh   numeric default null,
  p_time_scale  numeric default 5,
  p_max_seconds numeric default 120
) returns uuid
language plpgsql
as $$
declare
  v_last    timestamptz;
  v_real    numeric;
  v_scaled  numeric;
begin
  select max(bl.recorded_at)
    into v_last
  from public.bus_locations bl
  where bl.trip_id = p_trip_id;

  if v_last is null then
    -- No fix yet for this trip: take one small step so the bus appears.
    v_real := 3;
  else
    v_real := extract(epoch from (now() - v_last));
  end if;

  -- Clamp before scaling so a long pause cannot teleport the bus.
  v_real   := least(greatest(coalesce(v_real, 0), 0), coalesce(p_max_seconds, 120));
  v_scaled := v_real * coalesce(p_time_scale, 5);

  return public.fn_advance_trip(p_trip_id, v_scaled, p_speed_kmh);
end;
$$;

comment on function public.fn_advance_trip_elapsed is
  'Advances a trip by real elapsed time since its last fix, scaled for demo pace. Immune to irregular client tick intervals.';

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.fn_advance_trip_elapsed(uuid, numeric, numeric, numeric)
      to service_role;
  end if;
end;
$$;
