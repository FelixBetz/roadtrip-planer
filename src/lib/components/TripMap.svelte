<script lang="ts">
  import BetaBadge from "./BetaBadge.svelte";
  import { onMount, onDestroy } from "svelte";
  import type { RouteData, Stop } from "$lib/types.js";
  import { SESSION_COLORS } from "$lib/colors.js";
  import { fmtKm, fmtDuration } from "$lib/plan.js";

  interface Props {
    stops: Stop[];
    route: RouteData | null;
    /** legColor[i] = Farbindex des Fahrtags für route.legs[i] */
    legColor: number[];
    selectedId: number | null;
    busy: boolean;
    onSelect: (id: number) => void;
    /** Stopp (oder Wegpunkt) auf der Karte verschoben */
    onMoveStop: (index: number, lat: number, lon: number) => void;
    /** Strecke per Drag & Drop über einen neuen Punkt gezogen */
    onInsertVia: (legIndex: number, lat: number, lon: number) => void;
    /** Klick auf die Strecke → neuen Stopp an dieser Stelle einfügen */
    onInsertStop: (legIndex: number, lat: number, lon: number, kind: "stage" | "poi") => void;
    /** Klick in die Karte (nicht auf die Strecke) → Ort am Ende anhängen */
    onAppendStop: (lat: number, lon: number) => void;
    onRemoveVia: (index: number) => void;
  }

  let {
    stops, route, legColor, selectedId, busy,
    onSelect, onMoveStop, onInsertVia, onInsertStop, onAppendStop, onRemoveVia,
  }: Props = $props();

  let mapEl: HTMLDivElement;
  let map: any = null;
  let L: any = null;
  let layer: any = null;
  let fitted = false;

  // Mautstrecken ein-/ausblenden (Einstellung bleibt im Browser gespeichert)
  const TOLL_PREF = "roadtrip.showTolls";
  let showTolls = $state(true);
  function setShowTolls(v: boolean) {
    showTolls = v;
    try { localStorage.setItem(TOLL_PREF, v ? "1" : "0"); } catch { /* egal */ }
  }

  // Drag-auf-der-Strecke-Zustand
  let pending: { legIndex: number; start: any } | null = null;
  let ghost: any = null;
  let dragging = false;
  let suppressClick = false;

  onMount(async () => {
    try { showTolls = localStorage.getItem(TOLL_PREF) !== "0"; } catch { /* z.B. privater Modus */ }
    L = (await import("leaflet")).default;
    map = L.map(mapEl, { doubleClickZoom: false }).setView([46.5, 11], 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '© <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);
    layer = L.layerGroup().addTo(map);

    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    map.on("click", (e: any) => {
      if (busy) return;
      if (suppressClick) { suppressClick = false; return; }
      L.popup()
        .setLatLng(e.latlng)
        .setContent(popupButtons([["append", "＋ Als nächsten Ort anhängen"]]))
        .openOn(map);
      bindPopupButtons((action) => {
        if (action === "append") onAppendStop(e.latlng.lat, e.latlng.lng);
      });
    });

    requestAnimationFrame(() => map?.invalidateSize());
    render();
  });

  onDestroy(() => map?.remove());

  // Neu zeichnen, sobald sich Daten ändern
  $effect(() => {
    void stops; void route; void legColor; void selectedId; void busy; void showTolls;
    render();
  });

  export function fitAll() {
    if (!map || !L || !stops.length) return;
    const pts: [number, number][] = route
      ? route.legs.flatMap((l) => l.coords)
      : stops.map((s) => [s.lat, s.lon]);
    if (pts.length === 1) map.setView(pts[0], 10);
    else map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
  }

  export function focusStop(id: number) {
    const s = stops.find((x) => x.id === id);
    if (s && map) map.setView([s.lat, s.lon], Math.max(map.getZoom(), 9));
  }

  function colorForLeg(i: number) {
    return SESSION_COLORS[(legColor[i] ?? 0) % SESSION_COLORS.length];
  }

  function render() {
    if (!map || !L || !layer) return;
    layer.clearLayers();

    const legsOk = route && route.legs.length === stops.length - 1;

    // -- Mautabschnitte: breiter gelber Rand unter der Strecke ---------
    if (legsOk && route!.tolls && showTolls) {
      for (const line of route!.tolls.lines) {
        L.polyline(line, { color: "#facc15", weight: 16, opacity: 0.75, interactive: false }).addTo(layer);
      }
    }

    // -- Strecke -----------------------------------------------------
    for (let i = 0; i < stops.length - 1; i++) {
      const color = colorForLeg(i);
      const coords: [number, number][] = legsOk
        ? route!.legs[i].coords
        : [[stops[i].lat, stops[i].lon], [stops[i + 1].lat, stops[i + 1].lon]];

      L.polyline(coords, { color: "#1e293b", weight: 8, opacity: 0.35, interactive: false }).addTo(layer);
      L.polyline(coords, {
        color, weight: 5, opacity: 0.95,
        dashArray: legsOk ? undefined : "8 8",
        interactive: false,
      }).addTo(layer);

      if (!legsOk || busy) continue;
      const leg = route!.legs[i];
      // Unsichtbare, breite Linie als Griff für Klick + Drag & Drop
      const hit = L.polyline(coords, { color: "#000", weight: 18, opacity: 0, className: "route-hit" }).addTo(layer);
      hit.bindTooltip(`${fmtKm(leg.distance)} · ${fmtDuration(leg.duration)}<br><small>Ziehen, um die Route zu ändern</small>`, { sticky: true });
      hit.on("mousedown", (e: any) => {
        L.DomEvent.stop(e);
        pending = { legIndex: i, start: e.containerPoint };
        map.dragging.disable();
      });
      // Einfacher Klick auf die Strecke → Stopp an dieser Stelle einfügen.
      // (Popup erst im click-Event öffnen, sonst schließt Leaflets „preclick“ es sofort wieder.)
      hit.on("click", (e: any) => {
        L.DomEvent.stop(e);
        if (suppressClick) { suppressClick = false; return; }
        const latlng = e.latlng;
        L.popup()
          .setLatLng(latlng)
          .setContent(popupButtons([
            ["stage", "🏨 Etappenziel hier einfügen"],
            ["poi", "📍 Zwischenziel hier einfügen"],
          ]))
          .openOn(map);
        bindPopupButtons((action) => onInsertStop(i, latlng.lat, latlng.lng, action as "stage" | "poi"));
      });
    }

    // -- Stopps --------------------------------------------------------
    stops.forEach((s, i) => {
      const isFirst = i === 0;
      const isLast = i === stops.length - 1 && stops.length > 1;

      if (s.kind === "via" && !isFirst && !isLast) {
        const m = L.marker([s.lat, s.lon], {
          draggable: !busy,
          icon: L.divIcon({ className: "", html: `<div class="via-dot"></div>`, iconSize: [14, 14], iconAnchor: [7, 7] }),
          title: "Wegpunkt – ziehen zum Verschieben, Doppelklick zum Entfernen",
        }).addTo(layer);
        m.on("dragend", () => { const p = m.getLatLng(); onMoveStop(i, p.lat, p.lng); });
        m.on("dblclick contextmenu", (e: any) => { L.DomEvent.stop(e); if (!busy) onRemoveVia(i); });
        return;
      }

      const icon = isFirst ? "🚩" : isLast ? "🏁" : s.kind === "poi" ? "📍" : "🏨";
      const cls = [
        "stop-pin",
        s.kind === "poi" ? "poi" : "stage",
        s.id === selectedId ? "selected" : "",
      ].join(" ");
      const m = L.marker([s.lat, s.lon], {
        draggable: !busy,
        zIndexOffset: s.kind === "poi" ? 500 : 1000,
        icon: L.divIcon({
          className: "",
          html: `<div class="${cls}"><span class="pin-icon">${icon}</span><span class="pin-label">${escapeHtml(s.name || "Ort")}</span></div>`,
          iconSize: null,
          iconAnchor: [14, 14],
        }),
      }).addTo(layer);
      m.on("click", (e: any) => { L.DomEvent.stop(e); onSelect(s.id); });
      m.on("dragend", () => { const p = m.getLatLng(); onMoveStop(i, p.lat, p.lng); });
    });

    if (!fitted && stops.length) {
      fitted = true;
      fitAll();
    }
  }

  function onMouseMove(e: any) {
    if (!pending) return;
    if (!dragging) {
      if (e.containerPoint.distanceTo(pending.start) < 6) return;
      dragging = true;
      map.closePopup();
      ghost = L.marker(e.latlng, {
        interactive: false,
        icon: L.divIcon({ className: "", html: `<div class="via-dot ghost"></div>`, iconSize: [16, 16], iconAnchor: [8, 8] }),
      }).addTo(map);
    }
    ghost?.setLatLng(e.latlng);
  }

  function onMouseUp(e: any) {
    if (!pending) return;
    const { legIndex } = pending;
    const wasDragging = dragging;
    pending = null;
    dragging = false;
    map.dragging.enable();
    if (ghost) { map.removeLayer(ghost); ghost = null; }

    if (wasDragging) {
      // Der Browser schickt nach dem Loslassen noch ein click – das soll kein Popup öffnen
      suppressClick = true;
      setTimeout(() => (suppressClick = false), 300);
      onInsertVia(legIndex, e.latlng.lat, e.latlng.lng);
    }
  }

  function popupButtons(items: [string, string][]): string {
    return `<div class="map-popup">${items
      .map(([a, label]) => `<button type="button" data-action="${a}">${label}</button>`)
      .join("")}</div>`;
  }

  function bindPopupButtons(handler: (action: string) => void) {
    requestAnimationFrame(() => {
      const el = map.getContainer().querySelector(".leaflet-popup .map-popup");
      el?.querySelectorAll("button").forEach((b: HTMLButtonElement) => {
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          map.closePopup();
          handler(b.dataset.action!);
        });
      });
    });
  }

  function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  }
</script>

<div class="map-wrap" class:busy>
  <div bind:this={mapEl} class="map"></div>
  {#if busy}
    <div class="busy-badge">Route wird berechnet…</div>
  {/if}
  {#if route?.tolls?.lines.length}
    <label class="legend" title="Mautstrecken auf der Karte ein-/ausblenden">
      <input type="checkbox" checked={showTolls} onchange={(e) => setShowTolls(e.currentTarget.checked)} />
      <span class="toll-swatch"></span> Mautstrecke · {fmtKm(route.tolls.distance)} <BetaBadge />
    </label>
  {/if}
</div>

<style>
  .map-wrap {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .map {
    width: 100%;
    height: 100%;
    min-height: 360px;
    border-radius: 12px;
  }
  .busy-badge {
    position: absolute;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1000;
    background: #1e293b;
    color: white;
    font-size: 0.85rem;
    padding: 0.35rem 0.8rem;
    border-radius: 999px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .legend {
    position: absolute;
    left: 10px;
    bottom: 22px;
    z-index: 1000;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    background: rgba(255, 255, 255, 0.92);
    border-radius: 6px;
    padding: 0.25rem 0.55rem;
    font-size: 0.8rem;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    cursor: pointer;
    user-select: none;
  }
  .legend input {
    margin: 0;
  }
  .toll-swatch {
    width: 22px;
    height: 10px;
    border-radius: 3px;
    background: linear-gradient(#facc15 0 30%, #1e3a8a 30% 70%, #facc15 70%);
  }

  :global(.route-hit) {
    cursor: grab;
  }
  :global(.via-dot) {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    border: 3px solid #1e293b;
    box-sizing: border-box;
    cursor: move;
  }
  :global(.via-dot.ghost) {
    width: 16px;
    height: 16px;
    border-color: #3b82f6;
    opacity: 0.85;
  }
  :global(.stop-pin) {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    white-space: nowrap;
    background: white;
    border: 2px solid #1e3a8a;
    border-radius: 999px;
    padding: 2px 9px 2px 4px;
    font: 600 12px/1.2 system-ui, sans-serif;
    color: #0f172a;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
    cursor: pointer;
  }
  :global(.stop-pin.poi) {
    border-color: #db2777;
    font-weight: 500;
  }
  :global(.stop-pin.selected) {
    background: #fef3c7;
    border-color: #f59e0b;
  }
  :global(.stop-pin .pin-icon) {
    font-size: 14px;
  }
  :global(.map-popup) {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  :global(.map-popup button) {
    border: 1px solid #cbd5e1;
    background: #f8fafc;
    border-radius: 6px;
    padding: 0.35rem 0.6rem;
    font-size: 0.85rem;
    cursor: pointer;
    text-align: left;
  }
  :global(.map-popup button:hover) {
    background: #dbeafe;
    border-color: #3b82f6;
  }
</style>
