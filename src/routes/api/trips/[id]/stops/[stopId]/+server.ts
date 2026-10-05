import { json, error } from '@sveltejs/kit';
import { updateStop, type StopUpdate } from '$lib/db.js';
import { requireTrip } from '$lib/server/trip.js';
import type { StopKind } from '$lib/types.js';
import type { RequestHandler } from './$types.js';

/** Texte/Ruhetage eines Stopps ändern (ohne Neuberechnung der Route). */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
    const trip = await requireTrip(locals.user, params.id);
    const stopId = parseInt(params.stopId, 10);
    if (isNaN(stopId)) error(404, 'Stopp nicht gefunden');
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { error(400, 'Invalid JSON'); }

    const data: StopUpdate = {};
    if (typeof body.name === 'string') data.name = body.name.slice(0, 120);
    if (body.kind === 'stage' || body.kind === 'poi' || body.kind === 'via') data.kind = body.kind as StopKind;
    if (typeof body.notes === 'string') data.notes = body.notes.slice(0, 5000);
    if (typeof body.rest_notes === 'string') data.rest_notes = body.rest_notes.slice(0, 5000);
    if (body.rest_days !== undefined) data.rest_days = Math.min(30, Math.max(0, Math.round(Number(body.rest_days)) || 0));
    if (body.visit_minutes !== undefined) data.visit_minutes = Math.min(1440, Math.max(0, Math.round(Number(body.visit_minutes)) || 0));

    const stop = await updateStop(trip.id, stopId, data);
    if (!stop) error(404, 'Stopp nicht gefunden');
    return json(stop);
};
