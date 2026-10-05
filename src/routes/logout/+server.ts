import { redirect } from '@sveltejs/kit';
import { deleteAuthSession } from '$lib/db.js';
import type { RequestHandler } from './$types.js';

export const POST: RequestHandler = async ({ cookies }) => {
    const token = cookies.get('auth_token');
    if (token) {
        await deleteAuthSession(token);
        cookies.delete('auth_token', { path: '/' });
    }
    redirect(303, '/login');
};
