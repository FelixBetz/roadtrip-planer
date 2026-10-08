import { json, error } from '@sveltejs/kit';
import { updateTrip, type TripUpdate } from '$lib/db.js';
import { requireTrip, loadTripState } from '$lib/server/trip.js';
import type { RequestHandler } from './$types.js';

/**
 * Aktueller Stand für den automatischen Abgleich. Mit ?v=<version> kommt 204 zurück,
 * solange sich seit dieser Version nichts geändert hat.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
    const trip = await requireTrip(locals.user, params.id);
    if (url.searchParams.get('v') === String(trip.version)) return new Response(null, { status: 204 });
    return json(await loadTripState(trip));
};

/** Name, Beschreibung, Startdatum und Routing-Optionen ändern. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
    const trip = await requireTrip(locals.user, params.id);
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { error(400, 'Invalid JSON'); }

    const data: TripUpdate = {};
    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim().slice(0, 100);
    if (typeof body.description === 'string') data.description = body.description.trim().slice(0, 300);
    if (typeof body.start_date === 'string') {
        if (body.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) error(400, 'Ungültiges Datum');
        data.start_date = body.start_date;
    }
    if (typeof body.avoid_highways === 'boolean') data.avoid_highways = body.avoid_highways ? 1 : 0;
    if (typeof body.avoid_tolls === 'boolean') data.avoid_tolls = body.avoid_tolls ? 1 : 0;

    const updated = (await updateTrip(trip.id, data, locals.user!.id))!;
    return json(await loadTripState(updated));
};
