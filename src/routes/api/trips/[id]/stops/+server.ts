import { json, error } from '@sveltejs/kit';
import { replaceStops, getTrip, getAllStops, VersionConflictError } from '$lib/db.js';
import { requireTrip, ensureRoute, loadTripState } from '$lib/server/trip.js';
import type { StopInput, StopKind } from '$lib/types.js';
import type { RequestHandler } from './$types.js';

const KINDS: StopKind[] = ['stage', 'poi', 'via'];
const MAX_STOPS = 50;

function str(v: unknown, max: number): string {
    return typeof v === 'string' ? v.slice(0, max) : '';
}

function int(v: unknown, min: number, max: number): number {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

/**
 * Speichert die Ortsliste (Reihenfolge = Array-Reihenfolge) und berechnet die Route neu.
 * Wird bei Hinzufügen, Löschen, Verschieben und Drag & Drop auf der Karte verwendet.
 *
 * Body: { baseVersion: stops_version, auf der die Liste beruht, stops: [...] }.
 * Hat inzwischen jemand anderes die Liste geändert, kommt 409 mit dem aktuellen Stand zurück.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
    const trip = await requireTrip(locals.user, params.id);
    let body: unknown;
    try { body = await request.json(); } catch { error(400, 'Invalid JSON'); }
    const { baseVersion, stops: list } = (body ?? {}) as { baseVersion?: unknown; stops?: unknown };
    if (!Array.isArray(list) || typeof baseVersion !== 'number') error(400, '{ baseVersion, stops } erwartet');
    if (list.length > MAX_STOPS) error(400, `Maximal ${MAX_STOPS} Orte pro Reise.`);

    const stops: StopInput[] = list.map((raw) => {
        const s = (raw ?? {}) as Record<string, unknown>;
        const lat = Number(s.lat), lon = Number(s.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            error(400, 'Ungültige Koordinaten');
        }
        const kind = KINDS.includes(s.kind as StopKind) ? (s.kind as StopKind) : 'stage';
        return {
            id: typeof s.id === 'number' ? s.id : null,
            kind,
            name: str(s.name, 120),
            lat, lon,
            notes: str(s.notes, 5000),
            rest_days: int(s.rest_days, 0, 30),
            rest_notes: str(s.rest_notes, 5000),
            visit_minutes: int(s.visit_minutes, 0, 24 * 60),
        };
    });

    try {
        await replaceStops(trip.id, baseVersion, stops, locals.user!.id);
    } catch (e) {
        if (e instanceof VersionConflictError) {
            return json({ conflict: true, ...(await loadTripState((await getTrip(trip.id))!)) }, { status: 409 });
        }
        throw e;
    }
    // Erst die Reise (Version), dann die Orte lesen: ändert jemand dazwischen etwas, ist die
    // Version eher zu alt als zu neu, und der nächste Speicherversuch meldet sauber einen Konflikt.
    const updated = (await getTrip(trip.id))!;
    const saved = await getAllStops(trip.id);
    return json({ trip: updated, stops: saved, ...(await ensureRoute(updated, saved)) });
};
