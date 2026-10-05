import { json, error } from '@sveltejs/kit';
import { reverseGeocode } from '$lib/server/routing.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ url }) => {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) error(400, 'lat/lon erforderlich');
    try {
        return json(await reverseGeocode(lat, lon));
    } catch {
        return json(null);
    }
};
