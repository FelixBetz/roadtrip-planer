/**
 * Leitet aus Stopps + berechneter Route die Tagesplanung ab:
 * Fahrtage (Start → nächstes Etappenziel, inkl. Zwischenziele) und Ruhetage.
 */
import type { RouteData, Stop } from './types.js';

export interface PoiInfo {
    stop: Stop;
    /** Strecke/Fahrzeit vom vorherigen sichtbaren Halt (Etappenstart oder vorheriges Zwischenziel) */
    fromPrevDistance: number;
    fromPrevDuration: number;
    /** kumuliert ab Tagesstart */
    fromDayStartDistance: number;
    fromDayStartDuration: number;
}

export interface DriveDay {
    type: 'drive';
    dayNumber: number;
    date: Date | null;
    stageNumber: number;
    from: Stop;
    to: Stop;
    pois: PoiInfo[];
    /** Rest vom letzten Zwischenziel bis zum Etappenziel */
    lastLegDistance: number;
    lastLegDuration: number;
    distance: number;
    duration: number;      // reine Fahrzeit
    visitMinutes: number;  // Summe geplanter Aufenthalte an Zwischenzielen
    /** Indizes in route.legs, die zu diesem Tag gehören */
    legIndices: number[];
    colorIndex: number;
}

export interface RestDay {
    type: 'rest';
    dayNumber: number;
    date: Date | null;
    at: Stop;
    restIndex: number; // 1 = erster Ruhetag an diesem Ort
    restCount: number;
    colorIndex: number; // Farbe des Fahrtags, der hier endete
}

export type PlanDay = DriveDay | RestDay;

export interface TripPlan {
    days: PlanDay[];
    driveDays: number;
    restDays: number;
    distance: number;
    duration: number;
    /** legColor[i] = colorIndex des Fahrtags, zu dem route.legs[i] gehört */
    legColor: number[];
}

export function buildPlan(stops: Stop[], route: RouteData | null, startDate: string): TripPlan {
    const days: PlanDay[] = [];
    const legColor: number[] = [];
    const legs = route && route.legs.length === stops.length - 1 ? route.legs : null;
    const legDist = (i: number) => legs?.[i]?.distance ?? 0;
    const legDur = (i: number) => legs?.[i]?.duration ?? 0;

    const start = startDate ? new Date(startDate + 'T00:00:00') : null;
    const dateFor = (n: number) => {
        if (!start || isNaN(start.getTime())) return null;
        const d = new Date(start);
        d.setDate(d.getDate() + n - 1);
        return d;
    };

    let dayNumber = 0;
    let stage = 0;
    let dayStart = 0;
    while (dayStart < stops.length - 1) {
        // Ende des Fahrtags: nächstes Etappenziel oder letzter Stopp
        let end = dayStart + 1;
        while (end < stops.length - 1 && stops[end].kind !== 'stage') end++;

        const pois: PoiInfo[] = [];
        let fromPrevD = 0, fromPrevT = 0, cumD = 0, cumT = 0, visit = 0;
        const legIndices: number[] = [];
        for (let i = dayStart; i < end; i++) {
            legIndices.push(i);
            legColor[i] = stage;
            fromPrevD += legDist(i); fromPrevT += legDur(i);
            cumD += legDist(i); cumT += legDur(i);
            const next = stops[i + 1];
            if (i + 1 < end && next.kind === 'poi') {
                pois.push({
                    stop: next,
                    fromPrevDistance: fromPrevD, fromPrevDuration: fromPrevT,
                    fromDayStartDistance: cumD, fromDayStartDuration: cumT,
                });
                visit += next.visit_minutes || 0;
                fromPrevD = 0; fromPrevT = 0;
            }
        }

        dayNumber++;
        stage++;
        days.push({
            type: 'drive', dayNumber, date: dateFor(dayNumber), stageNumber: stage,
            from: stops[dayStart], to: stops[end], pois,
            lastLegDistance: fromPrevD, lastLegDuration: fromPrevT,
            distance: cumD, duration: cumT, visitMinutes: visit,
            legIndices, colorIndex: stage - 1,
        });

        const rest = Math.max(0, stops[end].rest_days || 0);
        if (end < stops.length - 1) {
            for (let r = 1; r <= rest; r++) {
                dayNumber++;
                days.push({
                    type: 'rest', dayNumber, date: dateFor(dayNumber), at: stops[end],
                    restIndex: r, restCount: rest, colorIndex: stage - 1,
                });
            }
        }
        dayStart = end;
    }

    const drive = days.filter((d): d is DriveDay => d.type === 'drive');
    return {
        days,
        driveDays: drive.length,
        restDays: days.length - drive.length,
        distance: drive.reduce((a, d) => a + d.distance, 0),
        duration: drive.reduce((a, d) => a + d.duration, 0),
        legColor,
    };
}

// -- Formatierung --------------------------------------------------

export function fmtKm(meters: number): string {
    const km = meters / 1000;
    return `${km >= 100 ? Math.round(km).toLocaleString('de') : km.toFixed(km >= 10 ? 0 : 1)} km`;
}

export function fmtDuration(seconds: number): string {
    const totalMin = Math.round(seconds / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (h === 0) return `${m} min`;
    return `${h}:${String(m).padStart(2, '0')} h`;
}

export function fmtDate(d: Date | null, long = false): string {
    if (!d) return '';
    return d.toLocaleDateString('de-DE', long
        ? { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }
        : { weekday: 'short', day: '2-digit', month: '2-digit' });
}

export const KIND_LABEL: Record<Stop['kind'], string> = {
    stage: 'Etappenziel',
    poi: 'Zwischenziel',
    via: 'Wegpunkt',
};

export const KIND_ICON: Record<Stop['kind'], string> = {
    stage: '🏨',
    poi: '📍',
    via: '•',
};
