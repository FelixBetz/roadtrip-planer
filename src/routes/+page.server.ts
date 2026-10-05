import { redirect, fail } from '@sveltejs/kit';
import { getUserTrips, createTrip, deleteTrip, getTrip } from '$lib/db.js';
import type { PageServerLoad, Actions } from './$types.js';

export const load: PageServerLoad = async ({ locals }) => {
	const user = locals.user!;
	const trips = await getUserTrips(user.id);
	return { user, trips };
};

export const actions: Actions = {
	create: async ({ locals, request }) => {
		const user = locals.user!;
		const data = await request.formData();
		const name = String(data.get('name') ?? '').trim();
		const description = String(data.get('description') ?? '').trim();
		if (!name) return fail(400, { createError: 'Name erforderlich.' });
		const trip = await createTrip({ user_id: user.id, name, description });
		redirect(303, `/trip/${trip.id}`);
	},
	delete: async ({ locals, request }) => {
		const user = locals.user!;
		const data = await request.formData();
		const id = parseInt(String(data.get('id') ?? ''), 10);
		if (isNaN(id)) return fail(400, { deleteError: 'Invalid trip id.' });
		const trip = await getTrip(id);
		if (!trip || trip.user_id !== user.id) return fail(403, { deleteError: 'Nicht berechtigt.' });
		await deleteTrip(id);
		return { deleted: true };
	},
};
