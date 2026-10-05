<script lang="ts">
  import { untrack } from "svelte";
  import type { PageData } from "./$types.js";
  import type { GeocodeResult, RouteData, Stop, StopKind, Trip } from "$lib/types.js";
  import { buildPlan, fmtKm, fmtDuration, KIND_LABEL } from "$lib/plan.js";
  import { SESSION_COLORS } from "$lib/colors.js";
  import TripMap from "$lib/components/TripMap.svelte";
  import RouteStrip from "$lib/components/RouteStrip.svelte";

  let { data }: { data: PageData } = $props();

  // Lokaler, editierbarer Zustand (Startwerte aus dem Server-Load)
  // (bewusst nur der Startwert – danach kommen Änderungen aus den API-Antworten)
  const initial = untrack(() => structuredClone(data));
  let trip = $state<Trip>(initial.trip);
  let stops = $state<Stop[]>(initial.stops);
  let route = $state<RouteData | null>(initial.route);
  let routeError = $state<string | null>(initial.routeError);
  let busy = $state(false);
  let saveError = $state<string | null>(null);
  let selectedId = $state<number | null>(null);

  let mapRef: TripMap | undefined = $state();

  const plan = $derived(buildPlan(stops, route, trip.start_date));

  // ── Speichern ──────────────────────────────────────────────

  type StopDraft = Omit<Stop, "id" | "trip_id" | "position">;

  function draft(s: Partial<Stop> & Pick<Stop, "lat" | "lon">): StopDraft {
    return {
      kind: s.kind ?? "stage",
      name: s.name ?? "",
      lat: s.lat,
      lon: s.lon,
      notes: s.notes ?? "",
      rest_days: s.rest_days ?? 0,
      rest_notes: s.rest_notes ?? "",
      visit_minutes: s.visit_minutes ?? 0,
    };
  }

  /** Komplette Liste speichern + Route neu berechnen. selectIndex = welcher Stopp danach ausgewählt ist. */
  async function saveStops(list: StopDraft[], selectIndex: number | null = null) {
    busy = true;
    saveError = null;
    try {
      const res = await fetch(`/api/trips/${trip.id}/stops`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(list),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.message ?? res.statusText);
      const json = await res.json();
      stops = json.stops;
      route = json.route;
      routeError = json.routeError;
      selectedId = selectIndex !== null ? (stops[selectIndex]?.id ?? null) : null;
    } catch (e) {
      saveError = `Speichern fehlgeschlagen: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  const currentDrafts = () => stops.map((s) => draft(s));

  async function patchStop(s: Stop, fields: Partial<Stop>) {
    Object.assign(s, fields);
    const res = await fetch(`/api/trips/${trip.id}/stops/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (!res.ok) saveError = "Änderung konnte nicht gespeichert werden.";
  }

  async function patchTrip(fields: Partial<Trip> | Record<string, unknown>) {
    busy = true;
    saveError = null;
    try {
      const res = await fetch(`/api/trips/${trip.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields),
      });
      if (!res.ok) throw new Error(res.statusText);
      const json = await res.json();
      trip = json.trip;
      route = json.route;
      routeError = json.routeError;
    } catch (e) {
      saveError = `Speichern fehlgeschlagen: ${(e as Error).message}`;
    } finally {
      busy = false;
    }
  }

  // ── Aktionen ───────────────────────────────────────────────

  async function reverseName(lat: number, lon: number, fallback: string): Promise<string> {
    try {
      const res = await fetch(`/api/geocode/reverse?lat=${lat}&lon=${lon}`);
      const r = (await res.json()) as GeocodeResult | null;
      return r?.name || fallback;
    } catch {
      return fallback;
    }
  }

  function appendPlace(p: { name: string; lat: number; lon: number }) {
    const list = currentDrafts();
    list.push(draft({ ...p, kind: "stage" }));
    saveStops(list, list.length - 1);
  }

  async function appendAt(lat: number, lon: number) {
    const name = await reverseName(lat, lon, "Neuer Ort");
    appendPlace({ name, lat, lon });
  }

  function backToStart() {
    const first = stops[0];
    if (!first) return;
    appendPlace({ name: first.name, lat: first.lat, lon: first.lon });
  }

  async function insertStop(legIndex: number, lat: number, lon: number, kind: "stage" | "poi") {
    const name = await reverseName(lat, lon, kind === "poi" ? "Zwischenziel" : "Etappenziel");
    const list = currentDrafts();
    list.splice(legIndex + 1, 0, draft({ name, lat, lon, kind }));
    saveStops(list, legIndex + 1);
  }

  function insertVia(legIndex: number, lat: number, lon: number) {
    const list = currentDrafts();
    list.splice(legIndex + 1, 0, draft({ name: "Wegpunkt", lat, lon, kind: "via" }));
    saveStops(list, null);
  }

  function moveStopTo(index: number, lat: number, lon: number) {
    const list = currentDrafts();
    list[index] = { ...list[index], lat, lon };
    saveStops(list, stops[index]?.id === selectedId ? index : null);
  }

  function removeStop(index: number) {
    const s = stops[index];
    if (s.kind !== "via" && (s.notes || s.rest_notes) && !confirm(`„${s.name}“ mit Notizen wirklich löschen?`)) return;
    const list = currentDrafts();
    list.splice(index, 1);
    saveStops(list, null);
  }

  function moveStop(index: number, dir: -1 | 1) {
    const j = index + dir;
    if (j < 0 || j >= stops.length) return;
    const list = currentDrafts();
    [list[index], list[j]] = [list[j], list[index]];
    saveStops(list, j);
  }

  function removeAllVias() {
    if (!confirm("Alle gezogenen Wegpunkte entfernen? Die Route wird wieder automatisch berechnet.")) return;
    saveStops(currentDrafts().filter((s) => s.kind !== "via"), null);
  }

  function select(id: number) {
    selectedId = selectedId === id ? null : id;
    if (selectedId) {
      mapRef?.focusStop(id);
      requestAnimationFrame(() =>
        document.getElementById(`stop-${id}`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
      );
    }
  }

  // ── Ortssuche ─────────────────────────────────────────────

  let query = $state("");
  let results = $state<GeocodeResult[]>([]);
  let searching = $state(false);
  let searchTimer: ReturnType<typeof setTimeout> | undefined;

  function onSearchInput() {
    clearTimeout(searchTimer);
    const q = query.trim();
    if (q.length < 2) {
      results = [];
      return;
    }
    searchTimer = setTimeout(async () => {
      searching = true;
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        results = res.ok ? await res.json() : [];
      } finally {
        searching = false;
      }
    }, 300);
  }

  function pickResult(r: GeocodeResult) {
    query = "";
    results = [];
    appendPlace(r);
  }

  // ── Anzeige-Helfer ────────────────────────────────────────

  function legBetween(i: number) {
    return route && route.legs.length === stops.length - 1 ? route.legs[i] : null;
  }

  /** Strecke vom Stopp i bis zum nächsten sichtbaren Stopp (Wegpunkte zusammengefasst) */
  function legToNextVisible(i: number): { distance: number; duration: number; color: string } | null {
    if (i >= stops.length - 1) return null;
    let distance = 0, duration = 0;
    let j = i;
    do {
      const l = legBetween(j);
      if (!l) return null;
      distance += l.distance;
      duration += l.duration;
      j++;
    } while (j < stops.length - 1 && stops[j].kind === "via");
    return { distance, duration, color: SESSION_COLORS[(plan.legColor[i] ?? 0) % SESSION_COLORS.length] };
  }

  function dayLabelFor(s: Stop): string {
    const d = plan.days.find((d) => d.type === "drive" && d.to === s);
    return d ? `Ende Tag ${d.dayNumber}` : "";
  }

  const viaCount = $derived(stops.filter((s) => s.kind === "via").length);
  const kindOptions: StopKind[] = ["stage", "poi", "via"];
</script>

<svelte:head>
  <title>{trip.name} – Roadtrip-Planer</title>
</svelte:head>

<div class="page">
  <header class="top">
    <a href="/" class="back">← Meine Reisen</a>
    <input
      class="trip-name"
      value={trip.name}
      onchange={(e) => patchTrip({ name: e.currentTarget.value })}
      aria-label="Name der Reise"
    />
    <a class="summary-link" href="/trip/{trip.id}/summary">📅 Tagesübersicht</a>
  </header>

  <section class="options">
    <label class="opt">
      Start
      <input
        type="date"
        value={trip.start_date}
        onchange={(e) => patchTrip({ start_date: e.currentTarget.value })}
      />
    </label>
    <label class="opt check">
      <input
        type="checkbox"
        checked={Boolean(trip.avoid_highways)}
        disabled={busy}
        onchange={(e) => patchTrip({ avoid_highways: e.currentTarget.checked })}
      />
      Autobahn meiden
    </label>
    <label class="opt check">
      <input
        type="checkbox"
        checked={Boolean(trip.avoid_tolls)}
        disabled={busy}
        onchange={(e) => patchTrip({ avoid_tolls: e.currentTarget.checked })}
      />
      Maut meiden
    </label>

    <div class="stats">
      {#if route}
        <span><strong>{fmtKm(plan.distance)}</strong></span>
        <span><strong>{fmtDuration(plan.duration)}</strong> Fahrzeit</span>
      {/if}
      <span><strong>{plan.driveDays}</strong> Fahrtage</span>
      {#if plan.restDays}<span><strong>{plan.restDays}</strong> Ruhetage</span>{/if}
    </div>
  </section>

  {#if routeError}
    <p class="alert error">⚠️ {routeError}</p>
  {/if}
  {#if route?.warning}
    <p class="alert warn">ℹ️ {route.warning}</p>
  {/if}
  {#if saveError}
    <p class="alert error">{saveError}</p>
  {/if}

  <div class="main">
    <!-- ── Stopp-Liste ───────────────────────────── -->
    <aside class="sidebar">
      <div class="search">
        <input
          type="search"
          placeholder={stops.length === 0 ? "Startort suchen, z.B. Ulm" : "Nächsten Ort hinzufügen…"}
          bind:value={query}
          oninput={onSearchInput}
          disabled={busy}
        />
        {#if results.length || searching}
          <ul class="results">
            {#if searching && !results.length}<li class="muted">Suche…</li>{/if}
            {#each results as r}
              <li><button onclick={() => pickResult(r)}>{r.label}</button></li>
            {/each}
          </ul>
        {/if}
      </div>
      <p class="hint">
        Tipp: Auf die Strecke klicken, um ein Etappen- oder Zwischenziel einzufügen. Strecke
        ziehen, um die Route über eine andere Straße zu führen.
      </p>

      <ol class="stops">
        {#each stops as s, i (s.id)}
          {@const isFirst = i === 0}
          {@const isLast = i === stops.length - 1 && stops.length > 1}
          {#if s.kind === "via" && !isFirst && !isLast}
            <li class="via-row">
              <span>• Wegpunkt (gezogen)</span>
              <button class="icon" title="Entfernen" onclick={() => removeStop(i)} disabled={busy}>✕</button>
            </li>
          {:else}
            <li
              id="stop-{s.id}"
              class="stop"
              class:poi={s.kind === "poi" && !isFirst && !isLast}
              class:selected={s.id === selectedId}
            >
              <div class="stop-head">
                <button class="stop-title" onclick={() => select(s.id)}>
                  <span class="stop-icon">{isFirst ? "🚩" : isLast ? "🏁" : s.kind === "poi" ? "📍" : "🏨"}</span>
                  <span class="stop-name">{s.name || "Ort"}</span>
                  <span class="stop-sub">
                    {isFirst ? "Start" : isLast ? "Ziel" : KIND_LABEL[s.kind]}
                    {#if s.kind === "stage" && !isFirst}· {dayLabelFor(s)}{/if}
                    {#if s.kind === "stage" && s.rest_days > 0 && !isLast}· +{s.rest_days} Ruhetag{s.rest_days > 1 ? "e" : ""}{/if}
                    {#if s.notes}· 📝{/if}
                  </span>
                </button>
                <div class="stop-actions">
                  <button class="icon" title="Nach oben" disabled={busy || i === 0} onclick={() => moveStop(i, -1)}>↑</button>
                  <button class="icon" title="Nach unten" disabled={busy || i === stops.length - 1} onclick={() => moveStop(i, 1)}>↓</button>
                  <button class="icon" title="Löschen" disabled={busy} onclick={() => removeStop(i)}>✕</button>
                </div>
              </div>

              {#if s.id === selectedId}
                <div class="stop-edit">
                  <label>
                    Name
                    <input value={s.name} onchange={(e) => patchStop(s, { name: e.currentTarget.value })} />
                  </label>
                  {#if !isFirst && !isLast}
                    <label>
                      Art
                      <select value={s.kind} onchange={(e) => patchStop(s, { kind: e.currentTarget.value as StopKind })}>
                        {#each kindOptions as k}
                          <option value={k}>{KIND_LABEL[k]}{k === "stage" ? " (Übernachtung)" : k === "poi" ? " (Sehenswürdigkeit)" : " (nur Routing)"}</option>
                        {/each}
                      </select>
                    </label>
                  {/if}
                  {#if s.kind === "poi" && !isFirst && !isLast}
                    <label>
                      Aufenthalt (Minuten)
                      <input
                        type="number" min="0" step="15"
                        value={s.visit_minutes}
                        onchange={(e) => patchStop(s, { visit_minutes: Number(e.currentTarget.value) })}
                      />
                    </label>
                  {/if}
                  <label>
                    Notizen
                    <textarea
                      rows="4"
                      placeholder={s.kind === "poi" ? "Was willst du dir anschauen? Parken, Eintritt…" : "Unterkunft, Adresse, Tipps…"}
                      value={s.notes}
                      onchange={(e) => patchStop(s, { notes: e.currentTarget.value })}
                    ></textarea>
                  </label>
                  {#if s.kind === "stage" && !isLast}
                    <label>
                      Ruhetage hier
                      <input
                        type="number" min="0" max="30"
                        value={s.rest_days}
                        onchange={(e) => patchStop(s, { rest_days: Number(e.currentTarget.value) })}
                      />
                    </label>
                    {#if s.rest_days > 0}
                      <label>
                        Programm an den Ruhetagen
                        <textarea
                          rows="3"
                          placeholder="z.B. Altstadt anschauen, Ötzi-Museum…"
                          value={s.rest_notes}
                          onchange={(e) => patchStop(s, { rest_notes: e.currentTarget.value })}
                        ></textarea>
                      </label>
                    {/if}
                  {/if}
                </div>
              {/if}
            </li>
          {/if}

          {#if !(s.kind === "via" && !isFirst && !isLast)}
            {@const leg = legToNextVisible(i)}
            {#if leg}
              <li class="leg" style="--c:{leg.color}">
                <span class="leg-line"></span>
                {fmtKm(leg.distance)} · {fmtDuration(leg.duration)}
              </li>
            {/if}
          {/if}
        {/each}
      </ol>

      <div class="list-actions">
        {#if stops.length >= 2 && (stops[0].lat !== stops[stops.length - 1].lat || stops[0].lon !== stops[stops.length - 1].lon)}
          <button onclick={backToStart} disabled={busy}>↩ Zurück zum Start ({stops[0].name})</button>
        {/if}
        {#if viaCount > 0}
          <button onclick={removeAllVias} disabled={busy}>Gezogene Wegpunkte entfernen ({viaCount})</button>
        {/if}
        {#if stops.length}
          <button onclick={() => mapRef?.fitAll()}>Ganze Strecke zeigen</button>
        {/if}
      </div>
    </aside>

    <!-- ── Karte ────────────────────────────────── -->
    <div class="map-col">
      <TripMap
        bind:this={mapRef}
        {stops}
        {route}
        legColor={plan.legColor}
        {selectedId}
        {busy}
        onSelect={select}
        onMoveStop={moveStopTo}
        onInsertVia={insertVia}
        onInsertStop={insertStop}
        onAppendStop={appendAt}
        onRemoveVia={removeStop}
      />
    </div>
  </div>

  <!-- ── Schematische Gesamtstrecke ───────────────── -->
  <section class="card strip-card">
    <h2>Gesamtstrecke</h2>
    <RouteStrip {stops} {route} {plan} {selectedId} onSelect={select} />
  </section>
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    font-family: system-ui, -apple-system, sans-serif;
    background: #f3f4f6;
    color: #111827;
  }

  .page {
    max-width: 1500px;
    margin: 0 auto;
    padding: 1rem 1.25rem 2rem;
  }

  .top {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .back,
  .summary-link {
    color: #2563eb;
    text-decoration: none;
    font-size: 0.9rem;
    white-space: nowrap;
  }
  .summary-link {
    margin-left: auto;
    background: #2563eb;
    color: white;
    padding: 0.45rem 0.9rem;
    border-radius: 8px;
    font-weight: 600;
  }
  .summary-link:hover {
    background: #1d4ed8;
  }
  .trip-name {
    flex: 1;
    min-width: 0;
    font-size: 1.4rem;
    font-weight: 800;
    color: #1e3a8a;
    border: 1px solid transparent;
    background: transparent;
    border-radius: 8px;
    padding: 0.2rem 0.4rem;
  }
  .trip-name:hover,
  .trip-name:focus {
    border-color: #cbd5e1;
    background: white;
    outline: none;
  }

  .options {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1.25rem;
    background: white;
    border-radius: 12px;
    padding: 0.6rem 1rem;
    margin-bottom: 0.75rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    font-size: 0.9rem;
  }
  .opt {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .opt input[type="date"] {
    padding: 0.25rem 0.4rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
  }
  .stats {
    margin-left: auto;
    display: flex;
    gap: 1rem;
    color: #475569;
  }
  .stats strong {
    color: #0f172a;
  }

  .alert {
    border-radius: 8px;
    padding: 0.5rem 0.8rem;
    font-size: 0.9rem;
    margin: 0 0 0.75rem;
  }
  .alert.error {
    background: #fef2f2;
    color: #b91c1c;
  }
  .alert.warn {
    background: #fffbeb;
    color: #92400e;
  }

  .main {
    display: grid;
    grid-template-columns: 380px 1fr;
    gap: 0.75rem;
    height: calc(100vh - 300px);
    min-height: 480px;
  }
  @media (max-width: 900px) {
    .main {
      grid-template-columns: 1fr;
      height: auto;
    }
    .map-col {
      height: 60vh;
    }
  }

  .sidebar {
    background: white;
    border-radius: 12px;
    padding: 0.75rem;
    overflow-y: auto;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }
  .map-col {
    min-height: 0;
  }

  .search {
    position: relative;
  }
  .search input {
    width: 100%;
    padding: 0.6rem 0.8rem;
    border: 1px solid #d1d5db;
    border-radius: 8px;
    font-size: 0.95rem;
  }
  .search input:focus {
    outline: none;
    border-color: #3b82f6;
  }
  .results {
    position: absolute;
    z-index: 2000;
    left: 0;
    right: 0;
    top: calc(100% + 4px);
    list-style: none;
    margin: 0;
    padding: 0.25rem;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  }
  .results button {
    width: 100%;
    text-align: left;
    border: none;
    background: none;
    padding: 0.45rem 0.6rem;
    border-radius: 6px;
    font-size: 0.88rem;
    cursor: pointer;
  }
  .results button:hover {
    background: #eff6ff;
  }
  .muted {
    color: #94a3b8;
    padding: 0.4rem 0.6rem;
    font-size: 0.85rem;
  }
  .hint {
    font-size: 0.78rem;
    color: #64748b;
    margin: 0.5rem 0 0.75rem;
  }

  .stops {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .stop {
    border: 1px solid #e2e8f0;
    border-radius: 10px;
    background: #f8fafc;
  }
  .stop.poi {
    margin-left: 1.25rem;
    border-color: #fbcfe8;
    background: #fdf2f8;
  }
  .stop.selected {
    border-color: #f59e0b;
    background: #fffbeb;
  }
  .stop-head {
    display: flex;
    align-items: center;
  }
  .stop-title {
    flex: 1;
    min-width: 0;
    display: grid;
    grid-template-columns: auto 1fr;
    column-gap: 0.5rem;
    text-align: left;
    background: none;
    border: none;
    padding: 0.5rem 0.6rem;
    cursor: pointer;
    font: inherit;
  }
  .stop-icon {
    grid-row: span 2;
    font-size: 1.2rem;
    align-self: center;
  }
  .stop-name {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .stop-sub {
    font-size: 0.75rem;
    color: #64748b;
  }
  .stop-actions {
    display: flex;
    padding-right: 0.3rem;
  }
  .icon {
    border: none;
    background: none;
    color: #64748b;
    cursor: pointer;
    padding: 0.25rem 0.35rem;
    border-radius: 4px;
    font-size: 0.85rem;
  }
  .icon:hover:not(:disabled) {
    background: #e2e8f0;
    color: #0f172a;
  }
  .icon:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .stop-edit {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0 0.7rem 0.7rem;
  }
  .stop-edit label {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.78rem;
    font-weight: 600;
    color: #475569;
  }
  .stop-edit input,
  .stop-edit select,
  .stop-edit textarea {
    font: inherit;
    font-weight: 400;
    font-size: 0.88rem;
    color: #0f172a;
    padding: 0.4rem 0.55rem;
    border: 1px solid #d1d5db;
    border-radius: 6px;
    background: white;
  }
  .stop-edit textarea {
    resize: vertical;
  }

  .via-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-left: 1.25rem;
    font-size: 0.75rem;
    color: #94a3b8;
    padding: 0 0.3rem;
  }

  .leg {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    font-size: 0.75rem;
    color: #475569;
    padding: 0.15rem 0 0.15rem 1.1rem;
    min-height: 28px;
  }
  .leg-line {
    width: 4px;
    align-self: stretch;
    border-radius: 2px;
    background: var(--c);
  }

  .list-actions {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }
  .list-actions button {
    border: 1px solid #cbd5e1;
    background: white;
    border-radius: 8px;
    padding: 0.45rem 0.7rem;
    font-size: 0.85rem;
    cursor: pointer;
    text-align: left;
  }
  .list-actions button:hover:not(:disabled) {
    background: #eff6ff;
    border-color: #3b82f6;
  }

  .card {
    background: white;
    border-radius: 12px;
    padding: 0.75rem 1rem;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  }
  .strip-card {
    margin-top: 0.75rem;
  }
  .strip-card h2 {
    margin: 0 0 0.25rem;
    font-size: 1rem;
    color: #1e3a8a;
  }
</style>
