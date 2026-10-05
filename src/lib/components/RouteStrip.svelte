<script lang="ts">
  import type { RouteData, Stop } from "$lib/types.js";
  import type { TripPlan } from "$lib/plan.js";
  import { fmtKm, fmtDuration } from "$lib/plan.js";
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

  /** Ruhetage pro Etappenziel (für Badge) */
  function restDaysAt(s: Stop, index: number): number {
    return index > 0 && index < stops.length - 1 && s.kind === "stage" ? s.rest_days : 0;
  }

  function dayNumbersArriving(s: Stop): string {
    const d = plan.days.find((d) => d.type === "drive" && d.to === s);
    return d ? `Tag ${d.dayNumber}` : "";
  }

  // Breite: mindestens ~120px pro sichtbarem Punkt, damit Beschriftungen Platz haben
  const minWidth = $derived(Math.max(600, nodes.length * 120));
</script>

{#if nodes.length >= 2}
  <div class="strip-scroll">
    <div class="strip" style="min-width:{minWidth}px">
      <!-- Tagesklammern -->
      <div class="bands">
        {#each dayBands as b}
          <div
            class="band"
            style="left:{b.x1 * 100}%; width:{(b.x2 - b.x1) * 100}%; --c:{b.color}"
            title="{fmtKm(b.day.distance)} · {fmtDuration(b.day.duration)}"
          >
            <span>Tag {b.day.dayNumber}</span>
          </div>
        {/each}
      </div>

      <!-- Zwischenziel-Beschriftungen (oben) -->
      <div class="labels top">
        {#each nodes as n}
          {#if n.stop.kind === "poi" && !n.isEnd}
            <button
              class="label poi"
              class:selected={n.stop.id === selectedId}
              style="left:{n.x * 100}%"
              onclick={() => onSelect?.(n.stop.id)}
            >
              📍 {n.stop.name}
              {#if n.stop.visit_minutes}
                <small>{fmtDuration(n.stop.visit_minutes * 60)} Aufenthalt</small>
              {/if}
            </button>
          {/if}
        {/each}
      </div>

      <!-- Linie -->
      <div class="track">
        {#each gaps as g}
          <div class="seg" style="left:{g.x1 * 100}%; width:{(g.x2 - g.x1) * 100}%; background:{g.color}">
            {#if legsOk}
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
      <div class="labels bottom">
        {#each nodes as n}
          {#if n.stop.kind !== "poi" || n.isEnd}
            {@const rest = restDaysAt(n.stop, n.index)}
            <button
              class="label stage"
              class:selected={n.stop.id === selectedId}
              style="left:{n.x * 100}%"
              onclick={() => onSelect?.(n.stop.id)}
            >
              <strong>{n.index === 0 ? "🚩" : n.index === stops.length - 1 ? "🏁" : "🏨"} {n.stop.name}</strong>
              {#if n.index > 0}<small>{dayNumbersArriving(n.stop)}</small>{/if}
              {#if rest > 0}
                <span class="rest">+{rest} Ruhetag{rest > 1 ? "e" : ""}</span>
              {/if}
            </button>
          {/if}
        {/each}
      </div>
    </div>
  </div>
{:else}
  <p class="strip-empty">Füge mindestens zwei Orte hinzu, um die Strecke zu sehen.</p>
{/if}

<style>
  .strip-scroll {
    overflow-x: auto;
    padding: 0.25rem 0 0.5rem;
  }
  .strip {
    position: relative;
    padding: 0 70px; /* Platz für die Beschriftung an den Enden */
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

  .labels.top {
    height: 42px;
  }
  .labels.bottom {
    height: 64px;
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
    bottom: 2px;
    color: #9d174d;
  }
  .labels.bottom .label {
    top: 4px;
  }
  .label.selected {
    background: #fef3c7;
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
