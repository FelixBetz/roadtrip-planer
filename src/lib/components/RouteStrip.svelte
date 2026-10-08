<script lang="ts">
  import type { RouteData, Stop } from "$lib/types.js";
  import type { TripPlan } from "$lib/plan.js";
  import { fmtKm, fmtDuration, fmtDate } from "$lib/plan.js";
  import { SESSION_COLORS } from "$lib/colors.js";

  interface Props {
    stops: Stop[];
    route: RouteData | null;
    plan: TripPlan;
    selectedId?: number | null;
    onSelect?: (id: number) => void;
  }

  let { stops, route, plan, selectedId = null, onSelect }: Props = $props();

  const legsOk = $derived(!!route && route.legs.length === stops.length - 1);

  interface Node {
    stop: Stop;
    index: number;
    x: number; // 0..1
    isEnd: boolean;
  }

  /** Sichtbare Punkte (ohne reine Wegpunkte) mit Position proportional zur Strecke. */
  const nodes = $derived.by((): Node[] => {
    if (stops.length === 0) return [];
    const cum: number[] = [0];
    for (let i = 1; i < stops.length; i++) {
      cum[i] = cum[i - 1] + (legsOk ? route!.legs[i - 1].distance : 1);
    }
    const total = cum[cum.length - 1] || 1;
    return stops
      .map((s, i) => ({ stop: s, index: i, x: cum[i] / total, isEnd: i === 0 || i === stops.length - 1 }))
      .filter((n) => n.isEnd || n.stop.kind !== "via");
  });

  /** Abschnitte zwischen zwei sichtbaren Punkten: Linie in Tagesfarbe + km/Zeit */
  const gaps = $derived.by(() => {
    const out: { x1: number; x2: number; color: string; distance: number; duration: number }[] = [];
    for (let n = 0; n < nodes.length - 1; n++) {
      const a = nodes[n], b = nodes[n + 1];
      let distance = 0, duration = 0;
      for (let i = a.index; i < b.index; i++) {
        distance += route?.legs[i]?.distance ?? 0;
        duration += route?.legs[i]?.duration ?? 0;
      }
      const color = SESSION_COLORS[(plan.legColor[a.index] ?? 0) % SESSION_COLORS.length];
      out.push({ x1: a.x, x2: b.x, color, distance, duration });
    }
    return out;
  });

  /** Klammern „Tag X“ über den Fahrtagen */
  const dayBands = $derived.by(() => {
    const byIndex = new Map(nodes.map((n) => [n.index, n.x]));
    return plan.days
      .filter((d) => d.type === "drive")
      .map((d) => {
        const fromIdx = stops.indexOf(d.from);
        const toIdx = stops.indexOf(d.to);
        return {
          day: d,
          x1: byIndex.get(fromIdx) ?? 0,
          x2: byIndex.get(toIdx) ?? 1,
          color: SESSION_COLORS[d.colorIndex % SESSION_COLORS.length],
        };
      });
  });

  /** Erkundungstage pro Etappenziel (für Badge) */
  function restDaysAt(s: Stop, index: number): number {
    return index > 0 && index < stops.length - 1 && s.kind === "stage" ? s.rest_days : 0;
  }

  /** Datum(e) der Erkundungstage an einem Etappenziel, z.B. „Mi., 02.06.“ oder „Mi., 02.06. – Do., 03.06.“ */
  function restDatesAt(s: Stop): string {
    const dates = plan.days.filter((d) => d.type === "rest" && d.at === s).map((d) => d.date);
    if (!dates.length || !dates[0]) return "";
    const first = fmtDate(dates[0]);
    return dates.length > 1 ? `${first} – ${fmtDate(dates[dates.length - 1])}` : first;
  }

  const startDate = $derived(plan.days[0]?.date ?? null);

  function dayNumbersArriving(s: Stop): string {
    const d = plan.days.find((d) => d.type === "drive" && d.to === s);
    if (!d) return "";
    return d.date ? `Tag ${d.dayNumber} · ${fmtDate(d.date)}` : `Tag ${d.dayNumber}`;
  }

  // Kein horizontales Scrollen: die Leiste passt sich der Breite an. Liegen Beschriftungen
  // zu dicht beieinander, werden sie auf mehrere Zeilen verteilt.
  const PAD = 56; // Platz links/rechts für die Beschriftungen an den Enden
  let width = $state(0);
  const trackPx = $derived(Math.max(1, width - 2 * PAD));

  /** Weist jedem Punkt die erste Zeile zu, in der seine Beschriftung nicht mit der vorherigen kollidiert. */
  function assignRows(xs: number[], labelPx: number): number[] {
    const lastEnd: number[] = [];
    return xs.map((x) => {
      const px = x * trackPx;
      let row = lastEnd.findIndex((end) => px - labelPx / 2 >= end);
      if (row === -1) row = lastEnd.length;
      lastEnd[row] = px + labelPx / 2;
      return row;
    });
  }

  const bottomNodes = $derived(nodes.filter((n) => n.stop.kind !== "poi" || n.isEnd));
  const topNodes = $derived(nodes.filter((n) => n.stop.kind === "poi" && !n.isEnd));
  const bottomRows = $derived(assignRows(bottomNodes.map((n) => n.x), 118));
  const topRows = $derived(assignRows(topNodes.map((n) => n.x), 112));
  const BOTTOM_ROW_H = 62;
  const TOP_ROW_H = 30;
  // Höhe der untersten Beschriftungszeile: mit Erkundungstag-Badge + Datum ist sie höher
  const bottomHeight = $derived.by(() => {
    if (!bottomNodes.length) return 40;
    const maxRow = Math.max(...bottomRows);
    const lastRowHasRest = bottomNodes.some((n, k) => bottomRows[k] === maxRow && restDaysAt(n.stop, n.index) > 0);
    return maxRow * BOTTOM_ROW_H + (lastRowHasRest ? 66 : 40);
  });
  const topHeight = $derived(topNodes.length ? (Math.max(...topRows) + 1) * TOP_ROW_H + 8 : 8);
</script>

{#if nodes.length >= 2}
  <div class="strip-wrap">
    <div class="strip" style="padding: 0 {PAD}px" bind:clientWidth={width}>
      <!-- Tagesklammern -->
      <div class="bands">
        {#each dayBands as b}
          {@const bandPx = (b.x2 - b.x1) * trackPx}
          <div
            class="band"
            style="left:{b.x1 * 100}%; width:{(b.x2 - b.x1) * 100}%; --c:{b.color}"
            title="{fmtKm(b.day.distance)} · {fmtDuration(b.day.duration)}"
          >
            {#if bandPx >= 44}
              <span>
                Tag {b.day.dayNumber}{#if legsOk && bandPx >= 100}{" · "}{fmtKm(b.day.distance)}{/if}{#if legsOk && bandPx >= 170}{" · "}{fmtDuration(b.day.duration)}{/if}
              </span>
            {/if}
          </div>
        {/each}
      </div>

      <!-- Zwischenziel-Beschriftungen (oben) -->
      <div class="labels top" style="height:{topHeight}px">
        {#each topNodes as n, k}
          <button
            class="label poi"
            class:selected={n.stop.id === selectedId}
            style="left:{n.x * 100}%; bottom:{2 + topRows[k] * TOP_ROW_H}px"
            onclick={() => onSelect?.(n.stop.id)}
          >
            📍 {n.stop.name}
            {#if n.stop.visit_minutes}
              <small>{fmtDuration(n.stop.visit_minutes * 60)} Aufenthalt</small>
            {/if}
          </button>
        {/each}
      </div>

      <!-- Linie -->
      <div class="track">
        {#each gaps as g}
          <div class="seg" style="left:{g.x1 * 100}%; width:{(g.x2 - g.x1) * 100}%; background:{g.color}">
            {#if legsOk && (g.x2 - g.x1) * trackPx >= 46}
              <span class="seg-info">{fmtKm(g.distance)}<br />{fmtDuration(g.duration)}</span>
            {/if}
          </div>
        {/each}
        {#each nodes as n}
          <button
            class="dot"
            class:poi={n.stop.kind === "poi" && !n.isEnd}
            class:end={n.isEnd}
            class:selected={n.stop.id === selectedId}
            style="left:{n.x * 100}%"
            title={n.stop.name}
            aria-label={n.stop.name}
            onclick={() => onSelect?.(n.stop.id)}
          ></button>
        {/each}
      </div>

      <!-- Etappenziel-Beschriftungen (unten) -->
      <div class="labels bottom" style="height:{bottomHeight}px">
        {#each bottomNodes as n, k}
            {@const rest = restDaysAt(n.stop, n.index)}
            <button
              class="label stage"
              class:selected={n.stop.id === selectedId}
              style="left:{n.x * 100}%; top:{4 + bottomRows[k] * BOTTOM_ROW_H}px"
              onclick={() => onSelect?.(n.stop.id)}
            >
              <strong>{n.index === 0 ? "🚩" : n.index === stops.length - 1 ? "🏁" : "🏨"} {n.stop.name}</strong>
              {#if n.index > 0}
                <small>{dayNumbersArriving(n.stop)}</small>
              {:else if startDate}
                <small>Abfahrt {fmtDate(startDate)}</small>
              {/if}
              {#if rest > 0}
                {@const restDates = restDatesAt(n.stop)}
                <span class="rest">+{rest} Erkundungstag{rest > 1 ? "e" : ""}</span>
                {#if restDates}<small class="rest-date">{restDates}</small>{/if}
              {/if}
            </button>
        {/each}
      </div>
    </div>
  </div>
{:else}
  <p class="strip-empty">Füge mindestens zwei Orte hinzu, um die Strecke zu sehen.</p>
{/if}

<style>
  .strip-wrap {
    overflow: hidden;
    padding: 0.25rem 0 0.5rem;
  }
  .strip {
    position: relative;
    box-sizing: border-box;
  }
  .bands,
  .labels,
  .track {
    position: relative;
  }

  .bands {
    height: 26px;
  }
  .band {
    position: absolute;
    top: 4px;
    height: 18px;
    border: 2px solid var(--c);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    box-sizing: border-box;
    display: flex;
    justify-content: center;
  }
  .band span {
    position: relative;
    top: -10px;
    background: white;
    padding: 0 6px;
    font-size: 0.75rem;
    font-weight: 700;
    color: var(--c);
    white-space: nowrap;
  }

  .label {
    position: absolute;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    background: none;
    border: none;
    padding: 2px 4px;
    font: inherit;
    font-size: 0.8rem;
    color: #0f172a;
    white-space: nowrap;
    cursor: pointer;
    border-radius: 6px;
    max-width: 160px;
  }
  .label strong {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 150px;
  }
  .label small {
    color: #64748b;
    font-size: 0.7rem;
  }
  .labels.top .label {
    color: #9d174d;
  }
  .label.selected {
    background: #fef3c7;
  }
  .label small.rest-date {
    color: #92400e;
  }
  .rest {
    margin-top: 2px;
    background: #fef3c7;
    color: #92400e;
    border-radius: 999px;
    padding: 0 6px;
    font-size: 0.68rem;
    font-weight: 600;
  }

  .track {
    height: 56px;
  }
  .seg {
    position: absolute;
    top: 15px;
    height: 6px;
  }
  .seg-info {
    position: absolute;
    left: 50%;
    top: 9px;
    transform: translateX(-50%);
    font-size: 0.66rem;
    color: #475569;
    text-align: center;
    line-height: 1.15;
    white-space: nowrap;
    pointer-events: none;
  }
  .dot {
    position: absolute;
    top: 8px;
    width: 20px;
    height: 20px;
    margin-left: -10px;
    border-radius: 50%;
    background: white;
    border: 4px solid #1e3a8a;
    box-sizing: border-box;
    cursor: pointer;
    padding: 0;
    z-index: 1;
  }
  .dot.end {
    background: #1e3a8a;
  }
  .dot.poi {
    top: 11px;
    width: 14px;
    height: 14px;
    margin-left: -7px;
    border: 3px solid #db2777;
    border-radius: 3px;
    transform: rotate(45deg);
  }
  .dot.selected {
    box-shadow: 0 0 0 4px #fde68a;
  }
  .strip-empty {
    color: #64748b;
    font-size: 0.9rem;
    margin: 0.5rem 0;
  }
</style>
