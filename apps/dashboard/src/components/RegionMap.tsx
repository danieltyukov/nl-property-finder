/*
 * The Leaflet map, loaded only when a page shows it (Leaflet and geoman are
 * about 60 KB gzip together). Tiles are OpenStreetMap, tinted by CSS to sit
 * in the palette. Search areas are drawn with geoman; polygons and markers
 * take their colours from tokens through class names.
 *
 * Tiles are the one request the dashboard makes to the internet. The server
 * can turn them off (tests do) by injecting `window.__NLPF__.tiles = false`,
 * or point them elsewhere with a URL template.
 */
import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import type { Tone } from '../lib/labels';
import '../env';

export interface MapMarker {
  id: string;
  lat: number;
  lon: number;
  label: string;
  tone: Tone;
  onClick?: () => void;
}

export interface MapRegion {
  name: string;
  polygon?: [number, number][];
}

export interface RegionMapProps {
  label: string;
  regions?: MapRegion[];
  markers?: MapMarker[];
  draw?: boolean;
  onPolygon?: (points: [number, number][]) => void;
  height?: number;
}

const round = (n: number) => Math.round(n * 1e5) / 1e5;

export default function RegionMap({ label, regions, markers, draw, onPolygon, height = 380 }: RegionMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const groupRef = useRef<L.FeatureGroup | null>(null);
  const onPolygonRef = useRef(onPolygon);
  onPolygonRef.current = onPolygon;

  const [ready, setReady] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let cancelled = false;
    let map: L.Map | null = null;
    // geoman extends the global L that Leaflet sets and only equips maps
    // created after it loads, so it is imported before the map exists.
    void (draw ? import('@geoman-io/leaflet-geoman-free') : Promise.resolve()).then(() => {
      if (cancelled) return;
      map = L.map(node, { scrollWheelZoom: false, zoomSnap: 0.5 }).setView([51.98, 4.36], 10);
      map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
      const tiles = window.__NLPF__?.tiles;
      if (tiles !== false) {
        L.tileLayer(typeof tiles === 'string' ? tiles : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        }).addTo(map);
      }
      groupRef.current = L.featureGroup().addTo(map);
      mapRef.current = map;
      setReady((n) => n + 1);
      if (draw && map.pm) {
        map.pm.addControls({
          position: 'topleft',
          drawMarker: false,
          drawCircleMarker: false,
          drawPolyline: false,
          drawCircle: false,
          drawText: false,
          drawRectangle: true,
          drawPolygon: true,
          editMode: false,
          dragMode: false,
          cutPolygon: false,
          removalMode: false,
          rotateMode: false,
        });
        const owner = map;
        owner.on('pm:create', (event) => {
          const layer = event.layer as L.Polygon;
          const ring = (layer.getLatLngs()[0] ?? []) as L.LatLng[];
          owner.removeLayer(layer);
          if (ring.length >= 3) onPolygonRef.current?.(ring.map((p) => [round(p.lat), round(p.lng)]));
        });
      }
    });
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
      groupRef.current = null;
    };
  }, [draw]);

  useEffect(() => {
    const map = mapRef.current;
    const group = groupRef.current;
    if (!map || !group) return;
    group.clearLayers();
    for (const region of regions ?? []) {
      if (!region.polygon || region.polygon.length < 3) continue;
      L.polygon(region.polygon, { className: 'map-region', weight: 2 }).bindTooltip(region.name, { sticky: true }).addTo(group);
    }
    for (const marker of markers ?? []) {
      const dot = L.circleMarker([marker.lat, marker.lon], { radius: 7, weight: 2, className: `map-marker ${marker.tone}` }).bindTooltip(marker.label);
      if (marker.onClick) dot.on('click', marker.onClick);
      dot.addTo(group);
    }
    const bounds = group.getBounds();
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });
  }, [regions, markers, ready]);

  return <div ref={ref} className="map" style={{ height }} role="region" aria-label={label} />;
}
