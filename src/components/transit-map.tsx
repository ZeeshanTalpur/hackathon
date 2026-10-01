'use client';

import { useEffect, useRef } from 'react';
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps';

import type { RoutePathStop } from '@/lib/types/database';

export interface MapBus {
  latitude: number;
  longitude: number;
  headingDeg: number | null;
  label: string;
  /** Stale or missing fixes are drawn faded, never as a live position. */
  isLive: boolean;
}

interface TransitMapProps {
  path: RoutePathStop[];
  bus: MapBus | null;
  routeColor: string;
  originStopId?: string | null;
  destinationStopId?: string | null;
  nextStopId?: string | null;
  fill?: boolean;
}

const KARACHI_CENTER = { lat: 24.8607, lng: 67.0011 };

/**
 * Route polyline, stops and bus marker on Google Maps.
 *
 * Overlays are drawn imperatively through useMap and mutated in place on each
 * update, so a moving bus does not rebuild the map on every realtime event.
 */
export function TransitMap(props: TransitMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  // No key configured, or the Maps script failed - fall back to the stop list
  // rather than leaving a blank panel where the map should be.
  if (!apiKey) {
    return <MapFallback {...props} reason="Google Maps API key is not configured." />;
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div className={props.fill ? 'h-full w-full overflow-hidden' : 'h-72 w-full overflow-hidden rounded-2xl ring-1 ring-slate-200 sm:h-96 md:h-[32rem]'}>
        <Map
          defaultCenter={KARACHI_CENTER}
          defaultZoom={12}
          disableDefaultUI
          zoomControl
          gestureHandling="greedy"
          style={{ width: '100%', height: '100%' }}
        >
          <Overlays {...props} />
        </Map>
      </div>
    </APIProvider>
  );
}

function Overlays({
  path,
  bus,
  routeColor,
  originStopId,
  destinationStopId,
  nextStopId,
}: TransitMapProps) {
  const map = useMap();
  const polylineRef = useRef<google.maps.Polyline | null>(null);
  const stopMarkersRef = useRef<google.maps.Marker[]>([]);
  const busMarkerRef = useRef<google.maps.Marker | null>(null);
  const didFitRef = useRef(false);

  // Route line + stop markers. Rebuilt only when the route itself changes.
  useEffect(() => {
    if (!map || path.length === 0) return;

    const coords = path.map((s) => ({ lat: Number(s.latitude), lng: Number(s.longitude) }));

    polylineRef.current?.setMap(null);
    polylineRef.current = new google.maps.Polyline({
      path: coords,
      strokeColor: routeColor || '#2563eb',
      strokeOpacity: 0.85,
      strokeWeight: 4,
      map,
    });

    stopMarkersRef.current.forEach((m) => m.setMap(null));
    stopMarkersRef.current = path.map((stop) => {
      const isEndpoint = stop.stop_id === originStopId || stop.stop_id === destinationStopId;
      const isNext = stop.stop_id === nextStopId;

      return new google.maps.Marker({
        position: { lat: Number(stop.latitude), lng: Number(stop.longitude) },
        map,
        title: `${stop.stop_order}. ${stop.stop_name}`,
        zIndex: isEndpoint || isNext ? 3 : 1,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: isEndpoint ? 7 : isNext ? 6 : 4,
          fillColor: isEndpoint ? '#111827' : isNext ? '#f59e0b' : '#ffffff',
          fillOpacity: 1,
          strokeColor: routeColor || '#2563eb',
          strokeWeight: 2,
        },
      });
    });

    if (!didFitRef.current) {
      const bounds = new google.maps.LatLngBounds();
      coords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds, 48);
      didFitRef.current = true;
    }

    return () => {
      polylineRef.current?.setMap(null);
      stopMarkersRef.current.forEach((m) => m.setMap(null));
      stopMarkersRef.current = [];
    };
  }, [map, path, routeColor, originStopId, destinationStopId, nextStopId]);

  // Bus marker, moved in place so updates stay cheap.
  useEffect(() => {
    if (!map) return;

    if (!bus) {
      busMarkerRef.current?.setMap(null);
      busMarkerRef.current = null;
      return;
    }

    const position = { lat: bus.latitude, lng: bus.longitude };
    const icon: google.maps.Symbol = {
      path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
      scale: 6,
      fillColor: bus.isLive ? '#16a34a' : '#9ca3af',
      fillOpacity: 1,
      strokeColor: '#ffffff',
      strokeWeight: 2,
      rotation: bus.headingDeg ?? 0,
    };

    if (busMarkerRef.current) {
      busMarkerRef.current.setPosition(position);
      busMarkerRef.current.setIcon(icon);
      busMarkerRef.current.setTitle(bus.label);
    } else {
      busMarkerRef.current = new google.maps.Marker({
        position,
        map,
        icon,
        title: bus.label,
        zIndex: 10,
      });
    }
  }, [map, bus]);

  return null;
}

/** Text equivalent of the map, so the page still works without Maps. */
function MapFallback({
  path,
  bus,
  nextStopId,
  reason,
}: TransitMapProps & { reason: string }) {
  return (
    <div className="rounded border border-amber-500/50 bg-amber-500/5 p-4 text-sm">
      <p className="font-medium">Map unavailable</p>
      <p className="opacity-70">{reason} Showing the route as a list instead.</p>

      {bus ? (
        <p className="mt-3">
          Bus position: {bus.latitude.toFixed(5)}, {bus.longitude.toFixed(5)}
          {bus.isLive ? '' : ' (not live)'}
        </p>
      ) : null}

      <ol className="mt-3 flex flex-col gap-1">
        {path.map((stop) => (
          <li
            key={stop.stop_id}
            className={stop.stop_id === nextStopId ? 'font-medium' : 'opacity-70'}
          >
            {stop.stop_order}. {stop.stop_name} - {Number(stop.distance_from_start_km).toFixed(1)} km
            {stop.stop_id === nextStopId ? ' (next stop)' : ''}
          </li>
        ))}
      </ol>
    </div>
  );
}
