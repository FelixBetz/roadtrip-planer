<script lang="ts">
  import type { PageData } from "./$types.js";
  import { buildPlan, fmtKm, fmtDuration, fmtDate } from "$lib/plan.js";
  import { SESSION_COLORS } from "$lib/colors.js";
  import RouteStrip from "$lib/components/RouteStrip.svelte";

  let { data }: { data: PageData } = $props();

  const trip = $derived(data.trip);
  const stops = $derived(data.stops);
  const plan = $derived(buildPlan(data.stops, data.route, data.trip.start_date));
  const startDate = $derived(trip.start_date ? new Date(trip.start_date + "T00:00:00") : null);
  const endDate = $derived(plan.days.length ? plan.days[plan.days.length - 1].date : null);

  const color = (i: number) => SESSION_COLORS[i % SESSION_COLORS.length];
</script>

<svelte:head>
  <title>{trip.name} – Tagesübersicht</title>
</svelte:head>

<div class="summary-page">
  <div class="top-bar">
    <a href="/trip/{trip.id}" class="back-link">← Zurück zur Planung</a>
    <button class="print" onclick={() => window.print()}>🖨 Drucken</button>
  </div>

  <header class="cover">
    <h1 class="trip-title">🚗 {trip.name}</h1>
    {#if trip.description}
      <p class="trip-desc">{trip.description}</p>
    {/if}
    <div class="cover-stats">
      {#if data.route}
        <div class="cstat">
          <span class="cval">{fmtKm(plan.distance)}</span>
          <span class="clabel">Gesamt</span>
        </div>
        <div class="cstat">
          <span class="cval">{fmtDuration(plan.duration)}</span>
          <span class="clabel">Fahrzeit</span>
        </div>
      {/if}
      <div class="cstat">
        <span class="cval">{plan.driveDays}</span>
        <span class="clabel">Fahrtage</span>
      </div>
      <div class="cstat">
        <span class="cval">{plan.restDays}</span>
        <span class="clabel">Ruhetage</span>
      </div>
      <div class="cstat">
        <span class="cval">{plan.days.length}</span>
        <span class="clabel">Tage gesamt</span>
      </div>
      {#if startDate}
        <div class="cstat">
          <span class="cval small">
            {fmtDate(startDate)}{#if endDate} – {fmtDate(endDate)}{/if}
          </span>
          <span class="clabel">Zeitraum</span>
        </div>
      {/if}
    </div>
    {#if trip.avoid_highways || trip.avoid_tolls}
      <p class="route-opts">
        Route {[trip.avoid_highways ? "ohne Autobahn" : "", trip.avoid_tolls ? "ohne Maut" : ""].filter(Boolean).join(", ")}
      </p>
    {/if}
  </header>

  {#if data.routeError}
    <p class="alert">⚠️ {data.routeError}</p>
  {/if}

  <section class="strip-card">
    <RouteStrip {stops} route={data.route} {plan} />
  </section>

  <div class="days">
    {#each plan.days as day}
      {#if day.type === "drive"}
        <article class="day-card">
          <div class="day-bar" style="background:{color(day.colorIndex)}"></div>
          <div class="day-body">
            <div class="day-top">
              <div>
                <h2 class="day-name">Tag {day.dayNumber} <span class="stage-no">· Etappe {day.stageNumber}</span></h2>
                {#if day.date}<span class="day-date">{fmtDate(day.date, true)}</span>{/if}
                <p class="day-route">{day.from.name} → {day.to.name}</p>
              </div>
              <div class="badges">
                {#if data.route}
                  <span class="badge km">{fmtKm(day.distance)}</span>
                  <span class="badge time">🚗 {fmtDuration(day.duration)}</span>
                  {#if day.visitMinutes > 0}
                    <span class="badge visit">+ {fmtDuration(day.visitMinutes * 60)} Besichtigung</span>
                  {/if}
                {/if}
              </div>
            </div>

            <!-- Tagesverlauf -->
            <ol class="timeline">
              <li class="tl-stop">
                <span class="tl-dot start" style="border-color:{color(day.colorIndex)}"></span>
                <strong>{day.from.name}</strong>
                <span class="tl-meta">Abfahrt</span>
              </li>
              {#each day.pois as p}
                <li class="tl-leg">
                  {fmtKm(p.fromPrevDistance)} · {fmtDuration(p.fromPrevDuration)}
                </li>
                <li class="tl-stop poi">
                  <span class="tl-dot poi"></span>
                  <strong>📍 {p.stop.name}</strong>
                  <span class="tl-meta">
                    nach {fmtDuration(p.fromDayStartDuration)} ab {day.from.name}
                    {#if p.stop.visit_minutes}· {fmtDuration(p.stop.visit_minutes * 60)} Aufenthalt{/if}
                  </span>
                  {#if p.stop.notes}<p class="notes">{p.stop.notes}</p>{/if}
                </li>
              {/each}
              <li class="tl-leg">
                {fmtKm(day.lastLegDistance)} · {fmtDuration(day.lastLegDuration)}
              </li>
              <li class="tl-stop">
                <span class="tl-dot end" style="background:{color(day.colorIndex)}"></span>
                <strong>{day.to === stops[stops.length - 1] ? "🏁" : "🏨"} {day.to.name}</strong>
                <span class="tl-meta">Ankunft{day.to === stops[stops.length - 1] ? " · Ziel" : " · Übernachtung"}</span>
                {#if day.to.notes}<p class="notes">{day.to.notes}</p>{/if}
              </li>
            </ol>
          </div>
        </article>
      {:else}
        <article class="day-card rest">
          <div class="day-bar rest-bar"></div>
          <div class="day-body">
            <div class="day-top">
              <div>
                <h2 class="day-name">Tag {day.dayNumber}</h2>
                {#if day.date}<span class="day-date">{fmtDate(day.date, true)}</span>{/if}
                <p class="day-route">Ruhetag in {day.at.name}</p>
              </div>
              <div class="badges">
                <span class="badge rest-badge">
                  🏛️ Ruhetag{day.restCount > 1 ? ` ${day.restIndex}/${day.restCount}` : ""}
                </span>
              </div>
            </div>
            {#if day.at.rest_notes && day.restIndex === 1}
              <p class="notes">{day.at.rest_notes}</p>
            {/if}
          </div>
        </article>
      {/if}
    {/each}
  </div>

  <footer class="summary-footer">Tagesübersicht · {trip.name}</footer>
</div>

<style>
  :global(*, *::before, *::after) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    font-family: "Segoe UI", system-ui, sans-serif;
    background: #f3f4f6;
    color: #1e293b;
  }

  .summary-page {
    max-width: 960px;
    margin: 0 auto;
    padding: 1.25rem 1.25rem 3rem;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1.25rem;
  }
  .back-link {
    color: #2563eb;
    text-decoration: none;
    font-size: 0.9rem;
  }
  .print {
    border: 1px solid #cbd5e1;
    background: white;
    border-radius: 8px;
    padding: 0.35rem 0.75rem;
    cursor: pointer;
  }

  .cover {
    text-align: center;
    background: #fff;
    border-radius: 12px;
    padding: 1.5rem;
    margin-bottom: 1rem;
  }
  .trip-title {
    font-size: 1.7rem;
    font-weight: 800;
    margin: 0 0 0.3rem;
    color: #0f172a;
  }
  .trip-desc {
    color: #64748b;
    margin: 0 0 1.25rem;
  }
  .cover-stats {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 1.5rem;
  }
  .cstat {
    display: flex;
    flex-direction: column;
  }
  .cval {
    font-size: 1.5rem;
    font-weight: 800;
    color: #1e3a8a;
  }
  .cval.small {
    font-size: 1.05rem;
    line-height: 2.2rem;
  }
  .clabel {
    font-size: 0.75rem;
    color: #64748b;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .route-opts {
    margin: 1rem 0 0;
    font-size: 0.85rem;
    color: #92400e;
  }
  .alert {
    background: #fef2f2;
    color: #b91c1c;
    border-radius: 8px;
    padding: 0.5rem 0.8rem;
  }

  .strip-card {
    background: white;
    border-radius: 12px;
    padding: 0.75rem 1rem;
    margin-bottom: 1rem;
  }

  .days {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }
  .day-card {
    display: flex;
    background: white;
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    break-inside: avoid;
  }
  .day-bar {
    width: 6px;
    flex-shrink: 0;
  }
  .rest-bar {
    background: repeating-linear-gradient(45deg, #f59e0b, #f59e0b 6px, #fde68a 6px, #fde68a 12px);
  }
  .day-body {
    flex: 1;
    padding: 1rem 1.25rem;
  }
  .day-top {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .day-name {
    margin: 0;
    font-size: 1.15rem;
  }
  .stage-no {
    font-weight: 500;
    color: #64748b;
    font-size: 0.95rem;
  }
  .day-date {
    font-size: 0.85rem;
    color: #64748b;
  }
  .day-route {
    margin: 0.25rem 0 0;
    font-weight: 600;
    color: #1e3a8a;
  }
  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: flex-start;
  }
  .badge {
    font-size: 0.8rem;
    font-weight: 600;
    padding: 0.2rem 0.6rem;
    border-radius: 999px;
    white-space: nowrap;
  }
  .badge.km {
    background: #dbeafe;
    color: #1e40af;
  }
  .badge.time {
    background: #e0e7ff;
    color: #3730a3;
  }
  .badge.visit {
    background: #fce7f3;
    color: #9d174d;
  }
  .rest-badge {
    background: #fef3c7;
    color: #92400e;
  }

  .timeline {
    list-style: none;
    margin: 0.9rem 0 0;
    padding: 0 0 0 1.4rem;
    border-left: 2px solid #e2e8f0;
    margin-left: 0.4rem;
  }
  .tl-stop {
    position: relative;
    padding: 0.2rem 0;
  }
  .tl-stop strong {
    margin-right: 0.5rem;
  }
  .tl-meta {
    font-size: 0.8rem;
    color: #64748b;
  }
  .tl-dot {
    position: absolute;
    left: calc(-1.4rem - 8px);
    top: 0.45rem;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: white;
    border: 3px solid #1e3a8a;
  }
  .tl-dot.end {
    border-color: white;
    box-shadow: 0 0 0 2px #1e3a8a;
  }
  .tl-dot.poi {
    width: 12px;
    height: 12px;
    left: calc(-1.4rem - 7px);
    border-radius: 2px;
    border-color: #db2777;
    transform: rotate(45deg);
  }
  .tl-leg {
    font-size: 0.75rem;
    color: #94a3b8;
    padding: 0.15rem 0;
  }
  .notes {
    white-space: pre-wrap;
    background: #f8fafc;
    border-left: 3px solid #cbd5e1;
    padding: 0.4rem 0.6rem;
    margin: 0.35rem 0 0.25rem;
    font-size: 0.88rem;
    color: #334155;
    border-radius: 0 6px 6px 0;
  }

  .summary-footer {
    text-align: center;
    color: #94a3b8;
    font-size: 0.8rem;
    margin-top: 2rem;
  }

  @media print {
    :global(body) {
      background: white;
    }
    .top-bar {
      display: none;
    }
    .day-card,
    .cover,
    .strip-card {
      box-shadow: none;
      border: 1px solid #e2e8f0;
    }
  }
</style>
