import { json, error } from '@sveltejs/kit';
import { getTripMembers, addTripMember, removeTripMember, getUserByUsername } from '$lib/db.js';
import { requireTrip } from '$lib/server/trip.js';
import type { RequestHandler } from './$types.js';

/** Wer an der Reise mitplant (Besitzer zuerst). */
export const GET: RequestHandler = async ({ locals, params }) => {
    const trip = await requireTrip(locals.user, params.id);
    return json(await getTripMembers(trip.id));
};

/** Reise mit einem anderen Nutzer teilen (nur der Besitzer). Body: { username } */
export const POST: RequestHandler = async ({ locals, params, request }) => {
    const trip = await requireTrip(locals.user, params.id);
    if (trip.user_id !== locals.user!.id) error(403, 'Nur der Besitzer kann die Reise teilen.');
    let body: Record<string, unknown>;
    try { body = await request.json(); } catch { error(400, 'Invalid JSON'); }

    const username = typeof body.username === 'string' ? body.username.trim() : '';
    if (!username) error(400, 'Benutzername fehlt.');
    const other = await getUserByUsername(username);
    if (!other) error(404, `Es gibt keinen Nutzer „${username}“. Die Person muss sich zuerst registrieren.`);
    if (other.id === trip.user_id) error(400, 'Das bist du selbst.');

    await addTripMember(trip.id, other.id);
    return json(await getTripMembers(trip.id));
};

/**
 * Mitglied entfernen: der Besitzer kann jeden entfernen, ein Mitglied nur sich selbst
 * („Reise verlassen“). Query: ?user=<id>
 */
export const DELETE: RequestHandler = async ({ locals, params, url }) => {
    const trip = await requireTrip(locals.user, params.id);
    const userId = parseInt(url.searchParams.get('user') ?? '', 10);
    if (isNaN(userId)) error(400, 'user fehlt.');
    const me = locals.user!.id;
    if (trip.user_id !== me && userId !== me) error(403, 'Nicht berechtigt.');
    if (userId === trip.user_id) error(400, 'Der Besitzer kann nicht entfernt werden.');

    await removeTripMember(trip.id, userId);
    return json(await getTripMembers(trip.id));
};
