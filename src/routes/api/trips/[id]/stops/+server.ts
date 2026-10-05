import { json, error } from '@sveltejs/kit';
import { replaceStops } from '$lib/db.js';
import { requireTrip, ensureRoute } from '$lib/server/trip.js';
import type { NewStop, StopKind } from '$lib/types.js';
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
 * Ersetzt die komplette Stopp-Liste (Reihenfolge = Array-Reihenfolge) und
 * berechnet die Route neu. Wird bei Hinzufügen, Löschen, Verschieben und
 * Drag & Drop auf der Karte verwendet.
 */
export const PUT: RequestHandler = async ({ locals, params, request }) => {
    const trip = await requireTrip(locals.user, params.id);
    let body: unknown;
    try { body = await request.json(); } catch { error(400, 'Invalid JSON'); }
    if (!Array.isArray(body)) error(400, 'Array erwartet');
    if (body.length > MAX_STOPS) error(400, `Maximal ${MAX_STOPS} Orte pro Reise.`);

    const stops: NewStop[] = body.map((raw) => {
        const s = (raw ?? {}) as Record<string, unknown>;
        const lat = Number(s.lat), lon = Number(s.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
            error(400, 'Ungültige Koordinaten');
        }
        const kind = KINDS.includes(s.kind as StopKind) ? (s.kind as StopKind) : 'stage';
        return {
            kind,
            name: str(s.name, 120),
            lat, lon,
            notes: str(s.notes, 5000),
            rest_days: int(s.rest_days, 0, 30),
            rest_notes: str(s.rest_notes, 5000),
            visit_minutes: int(s.visit_minutes, 0, 24 * 60),
        };
    });

    const saved = await replaceStops(trip.id, stops);
    return json({ stops: saved, ...(await ensureRoute(trip, saved)) });
};
