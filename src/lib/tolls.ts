/**
 * Grobe Schätzung der Mautkosten für einen Pkw aus den Mautabschnitten der Route.
 *
 * Keine offiziellen Tarife: Die Werte unten sind Durchschnittswerte (Stand 2026) und
 * können hier angepasst werden. Für den genauen Preis die Rechner der Betreiber nutzen,
 * z.B. autostrade.it (Italien) oder asfinag.at (Österreich).
 */
import type { TollSection } from './types.js';

/** Streckenmaut pro km (Euro) */
const PER_KM: Record<string, number> = {
    IT: 0.08, // Mailand–Rom 44,40 € auf ca. 563 km
    FR: 0.10,
    DE: 0,    // keine Pkw-Maut
};

/**
 * Bekannte Sondermautstrecken mit Pauschalpreis je Fahrt. Erkannt werden sie an der Lage
 * (Rechteck [Süd, West, Nord, Ost]). Liegt eine Strecke in mehreren Ländern (Timmelsjoch),
 * zählt sie trotzdem nur einmal.
 */
const SPECIAL_ROADS: { name: string; box: [number, number, number, number]; euro: number; motorway: boolean }[] = [
    { name: 'Brennerautobahn A13', box: [46.99, 11.25, 47.28, 11.56], euro: 12.5, motorway: true },
    { name: 'Timmelsjoch-Hochalpenstraße', box: [46.8, 10.98, 46.96, 11.22], euro: 20, motorway: false },
];

/** Österreich: Wer dort Autobahn fährt, braucht die Vignette (10 Tage) */
const AT_VIGNETTE = 12.8;

export const COUNTRY_NAME: Record<string, string> = {
    DE: 'Deutschland', AT: 'Österreich', IT: 'Italien', CH: 'Schweiz', FR: 'Frankreich',
    ES: 'Spanien', PT: 'Portugal', SI: 'Slowenien', HR: 'Kroatien', '?': 'unbekannt',
};

/** Wie die Preise zustande kommen (für die Anzeige) */
export const TOLL_RULES: { country: string; rule: string }[] = [
    { country: 'Italien', rule: `ca. ${fmtRate(PER_KM.IT)} auf Mautstrecken (Durchschnitt; z.B. Mailand–Rom 44,40 € auf ca. 563 km)` },
    { country: 'Österreich', rule: `Brennerautobahn A13 ${fmtEuro(12.5, true)} je Fahrt, dazu einmal die 10-Tages-Vignette für ${fmtEuro(AT_VIGNETTE, true)}. Andere Sondermautstrecken in Österreich: kein Preis hinterlegt` },
    { country: 'Timmelsjoch', rule: `${fmtEuro(20, true)} je Fahrt für die ganze Passstraße (Österreich und Italien), keine Vignette nötig` },
    { country: 'Frankreich', rule: `ca. ${fmtRate(PER_KM.FR)} auf Mautstrecken (Durchschnitt, je nach Betreiber deutlich anders)` },
    { country: 'Deutschland', rule: 'keine Maut für Pkw' },
    { country: 'Andere Länder', rule: 'kein Preis hinterlegt („Preis unbekannt“)' },
];

export const TOLL_SOURCES = [
    { label: 'BIKE: Autobahn-Maut 2026', url: 'https://www.bike-magazin.de/touren/touren-tipps/autobahn-maut-vignette-brenner-das-kostet-der-biketrip-jetzt-in-den-suden/' },
    { label: 'autopay: Maut Italien', url: 'https://mobility.autopay.eu/de/wissen/fahrerhandbuch/maut-italien/' },
    { label: 'Mautrechner Italien (autostrade.it)', url: 'https://www.autostrade.it/' },
    { label: 'Mautrechner Österreich (asfinag.at)', url: 'https://www.asfinag.at/' },
];

/** Ein Posten der Mautrechnung */
export interface TollItem {
    /** route.legs-Index, dem der Posten zugeordnet ist (für die Etappen-Summen) */
    leg: number | null;
    country: string;
    label: string;
    /** Rechenweg, z.B. „263 km × 0,08 €/km“ */
    calc: string;
    euro: number | null; // null = Preis unbekannt
}

export interface TollEstimate {
    items: TollItem[];
    total: number;       // Summe der bekannten Posten
    incomplete: boolean; // es gibt Posten ohne bekannten Preis
}

export function estimateTolls(sections: TollSection[] | undefined): TollEstimate | null {
    if (!sections?.length) return null;
    const items: TollItem[] = [];

    let vignetteLeg: number | null | undefined; // undefined = keine Vignette nötig
    const needVignette = (leg: number | null) => { if (vignetteLeg === undefined) vignetteLeg = leg; };

    // 1. Bekannte Sondermautstrecken: einmal je Etappe, egal in wie vielen Stücken/Ländern
    const rest: TollSection[] = [];
    const charged = new Set<string>();
    for (const s of sections) {
        const road = s.at && SPECIAL_ROADS.find((r) => inBox(s.at!, r.box));
        if (!road) { rest.push(s); continue; }
        const id = `${road.name}|${s.leg}`;
        if (charged.has(id)) continue;
        charged.add(id);
        items.push({ leg: s.leg ?? null, country: s.country, label: road.name, calc: 'pauschal je Fahrt', euro: road.euro });
        if (road.motorway && s.country === 'AT') needVignette(s.leg ?? null);
    }

    // 2. Übrige Mautstrecken in Österreich: Sondermautstrecke ohne hinterlegten Preis.
    //    (Ältere gespeicherte Routen ohne Position: wie bisher als Brenner zählen.)
    const seen = new Set<number | string>();
    rest.filter((s) => s.country === 'AT').forEach((s, i) => {
        const id = s.part ?? `i${i}`;
        if (seen.has(id)) return;
        seen.add(id);
        if (!s.at) {
            items.push({ leg: s.leg ?? null, country: 'AT', label: 'Sondermaut (vermutlich Brenner)', calc: 'pauschal je Fahrt', euro: 12.5 });
        } else {
            items.push({ leg: s.leg ?? null, country: 'AT', label: `Sondermautstrecke (${Math.round(s.distance / 1000)} km)`, calc: 'kein Preis hinterlegt', euro: null });
        }
        needVignette(s.leg ?? null);
    });
    if (vignetteLeg !== undefined) {
        items.push({ leg: vignetteLeg, country: 'AT', label: 'Vignette (10 Tage)', calc: 'einmal pro Reise', euro: AT_VIGNETTE });
    }

    // 3. Streckenmaut: km je Etappe und Land
    const km = new Map<string, { leg: number | null; country: string; km: number }>();
    for (const s of rest) {
        if (s.country === 'AT') continue;
        const k = `${s.leg ?? ''}|${s.country}`;
        const e = km.get(k) ?? { leg: s.leg ?? null, country: s.country, km: 0 };
        e.km += s.distance / 1000;
        km.set(k, e);
    }
    for (const e of km.values()) {
        if (e.km < 1) continue;
        const rate = PER_KM[e.country];
        const r = Math.round(e.km);
        items.push({
            leg: e.leg,
            country: e.country,
            label: `${r} km Mautstrecke`,
            calc: rate === undefined ? 'kein Preis hinterlegt' : rate === 0 ? 'mautfrei' : `${r} km × ${fmtRate(rate)}`,
            euro: rate === undefined ? null : Math.round(e.km * rate * 100) / 100,
        });
    }
    items.sort((a, b) => (a.leg ?? -1) - (b.leg ?? -1));
    return sumUp(items);
}

/** Nur die Posten der angegebenen Etappen-Abschnitte (route.legs-Indizes) */
export function tollsForLegs(est: TollEstimate | null, legs: number[]): TollEstimate | null {
    if (!est) return null;
    const items = est.items.filter((i) => i.leg !== null && legs.includes(i.leg));
    return items.length ? sumUp(items) : null;
}

function inBox([lat, lon]: [number, number], [s, w, n, e]: [number, number, number, number]): boolean {
    return lat >= s && lat <= n && lon >= w && lon <= e;
}

function sumUp(items: TollItem[]): TollEstimate {
    return {
        items,
        total: items.reduce((a, i) => a + (i.euro ?? 0), 0),
        incomplete: items.some((i) => i.euro === null),
    };
}

/** Betrag in Euro; exact = mit Cent (für Einzelposten), sonst gerundet (für Summen) */
export function fmtEuro(v: number, exact = false): string {
    const digits = exact ? 2 : 0;
    return v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtRate(v: number): string {
    return `${v.toLocaleString('de-DE', { minimumFractionDigits: 2 })} €/km`;
}
