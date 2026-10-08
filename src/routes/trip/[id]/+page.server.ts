import { requireTrip, loadTripState } from '$lib/server/trip.js';
import type { PageServerLoad } from './$types.js';

export const load: PageServerLoad = async ({ locals, params }) => {
    const trip = await requireTrip(locals.user, params.id);
    return { me: locals.user!.id, ...(await loadTripState(trip)) };
};
