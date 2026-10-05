export interface User {
    id: number;
    username: string;
    created_at: string;
}

export interface Trip {
    id: number;
    user_id: number;
    name: string;
    description: string;
    start_date: string;     // ISO-Datum "2026-05-05" oder ''
    avoid_highways: number; // 0/1
    avoid_tolls: number;    // 0/1
    created_at: string;
}

export type NewTrip = Pick<Trip, 'user_id' | 'name' | 'description'>;

/**
 * stage = Etappenziel / Übernachtung (beendet einen Fahrtag)
 * poi   = Zwischenziel / Sehenswürdigkeit unterwegs
 * via   = unsichtbarer Wegpunkt, nur um die Route über eine Straße zu ziehen
 */
export type StopKind = 'stage' | 'poi' | 'via';

export interface Stop {
    id: number;
    trip_id: number;
    position: number; // 1-basierte Reihenfolge
    kind: StopKind;
    name: string;
    lat: number;
    lon: number;
    notes: string;
    rest_days: number;     // Ruhetage nach Ankunft (nur bei stage)
    rest_notes: string;    // Programm für die Ruhetage
    visit_minutes: number; // geplante Aufenthaltsdauer (nur bei poi)
}

export type NewStop = Omit<Stop, 'id' | 'trip_id' | 'position'>;

export interface RouteLeg {
    /** [lat, lon]-Paare, vereinfacht */
    coords: [number, number][];
    distance: number; // Meter
    duration: number; // Sekunden
}

export interface RouteData {
    /** Fingerabdruck der Stopps + Optionen, für die die Route berechnet wurde */
    key: string;
    provider: 'ors' | 'osrm';
    legs: RouteLeg[]; // legs[i] verbindet stops[i] mit stops[i+1]
    distance: number;
    duration: number;
    warning?: string;
}

export interface GeocodeResult {
    name: string;
    label: string;
    lat: number;
    lon: number;
}
