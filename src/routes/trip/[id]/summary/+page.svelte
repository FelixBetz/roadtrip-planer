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
        <span class="clabel">Erkundungstage</span>
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
        {@const isFinal = day.to === stops[stops.length - 1]}
        {@const startNotes = day.from === stops[0] ? day.from.notes : ""}
        <article class="day" style="--c:{color(day.colorIndex)}">
          <div class="day-head">
            <span class="day-no">Tag {day.dayNumber}</span>
            {#if day.date}<span class="day-date">{fmtDate(day.date)}</span>{/if}
            <span class="day-route">{day.from.name} → {isFinal ? "🏁" : "🏨"} {day.to.name}</span>
            {#if data.route}
              <span class="day-stats">
                {fmtKm(day.distance)} · 🚗 {fmtDuration(day.duration)}
                {#if day.visitMinutes > 0}<span class="visit">+ {fmtDuration(day.visitMinutes * 60)} Besichtigung</span>{/if}
              </span>
            {/if}
          </div>

          {#if startNotes || day.pois.length || day.to.notes}
            <ul class="day-items">
              {#if startNotes}
                <li>
                  <span class="item-name">🚩 {day.from.name}</span>
                  <span class="item-notes">{startNotes}</span>
                </li>
              {/if}
              {#each day.pois as p}
                <li>
                  <span class="item-name">📍 {p.stop.name}</span>
                  <span class="item-meta">
                    {fmtDuration(p.fromDayStartDuration)} ab {day.from.name}{#if p.stop.visit_minutes}{" · "}{fmtDuration(p.stop.visit_minutes * 60)} Aufenthalt{/if}
                  </span>
                  {#if p.stop.notes}<span class="item-notes">{p.stop.notes}</span>{/if}
                </li>
              {/each}
              {#if day.to.notes}
                <li>
                  <span class="item-name">{isFinal ? "🏁" : "🏨"} {day.to.name}</span>
                  <span class="item-notes">{day.to.notes}</span>
                </li>
              {/if}
            </ul>
          {/if}
        </article>
      {:else}
        <article class="day rest">
          <div class="day-head">
            <span class="day-no">Tag {day.dayNumber}</span>
            {#if day.date}<span class="day-date">{fmtDate(day.date)}</span>{/if}
            <span class="day-route">🏛️ Erkundungstag in {day.at.name}{#if day.restCount > 1} ({day.restIndex}/{day.restCount}){/if}</span>
          </div>
          {#if day.at.rest_notes && day.restIndex === 1}
            <ul class="day-items">
              <li><span class="item-notes">{day.at.rest_notes}</span></li>
            </ul>
          {/if}
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
    gap: 0.4rem;
  }
  .day {
    background: white;
    border-left: 5px solid var(--c);
    border-radius: 8px;
    padding: 0.5rem 0.85rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    break-inside: avoid;
  }
  .day.rest {
    border-left: 5px solid #f59e0b;
    background: #fffdf5;
  }
  .day-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.2rem 0.75rem;
  }
  .day-no {
    font-weight: 800;
    min-width: 3.6rem;
  }
  .day-date {
    font-size: 0.85rem;
    color: #64748b;
    min-width: 5.5rem;
  }
  .day-route {
    font-weight: 600;
    color: #1e3a8a;
  }
  .day-stats {
    margin-left: auto;
    font-size: 0.85rem;
    color: #475569;
    white-space: nowrap;
  }
  .visit {
    margin-left: 0.4rem;
    color: #9d174d;
  }
  .day-items {
    list-style: none;
    margin: 0.3rem 0 0;
    padding: 0 0 0 calc(3.6rem + 0.75rem);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    font-size: 0.85rem;
  }
  .day-items li {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.5rem;
  }
  .item-name {
    font-weight: 600;
  }
  .item-meta {
    color: #64748b;
  }
  .item-notes {
    color: #334155;
    white-space: pre-wrap;
    flex-basis: 100%;
  }
  .item-name + .item-notes {
    flex-basis: auto;
    flex: 1;
  }
  @media (max-width: 600px) {
    .day-stats {
      margin-left: 0;
    }
    .day-items {
      padding-left: 0;
    }
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
    .day,
    .cover,
    .strip-card {
      box-shadow: none;
      border: 1px solid #e2e8f0;
    }
  }
</style>
