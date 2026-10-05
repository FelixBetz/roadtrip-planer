import { getAllStops } from '$lib/db.js';
import { requireTrip, ensureRoute } from '$lib/server/trip.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals, params }) => {
    const trip = await requireTrip(locals.user, params.id);
    const stops = await getAllStops(trip.id);
    return { trip, stops, ...(await ensureRoute(trip, stops)) };
};
