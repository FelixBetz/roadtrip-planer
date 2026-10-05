import { fail, redirect } from '@sveltejs/kit';
import { getUserByUsername } from '$lib/db.js';
import { verifyPassword, startSession } from '$lib/auth.js';
import type { Actions, PageServerLoad } from './$types.js';

export const load: PageServerLoad = ({ locals }) => {
    if (locals.user) redirect(303, '/');
};

export const actions: Actions = {
    default: async ({ request, cookies }) => {
        const data = await request.formData();
        const username = String(data.get('username') ?? '').trim();
        const password = String(data.get('password') ?? '');

        if (!username || !password) {
            return fail(400, { error: 'Bitte alle Felder ausfüllen.' });
        }

        const user = await getUserByUsername(username);
        if (!user) {
            return fail(401, { error: 'Ungültige Zugangsdaten.' });
        }

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
            return fail(401, { error: 'Ungültige Zugangsdaten.' });
        }

        const token = await startSession(user.id);
        cookies.set('auth_token', token, {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 30,
        });

        redirect(303, '/');
    },
};
