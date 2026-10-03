/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as DataStore from "@api/DataStore";

const STORE_KEY = "Spotlight_frecency_v1";

/** How many individual events to keep per channel for recency weighting */
const MAX_EVENTS = 20;
/** Ignore repeat visits to the same channel within this window */
const VISIT_COOLDOWN = 60_000;
/** Drop channels untouched for this long */
const PRUNE_AFTER = 120 * 24 * 3600_000;

export const enum Signal {
    Visit = 1,
    Message = 3,
}

interface Entry {
    /** total weighted events ever recorded (not just the kept ones) */
    total: number;
    /** recent events as [timestamp, weight] */
    events: [number, number][];
    guildId: string | null;
}

let data: Record<string, Entry> = {};
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let lastVisit: { id: string, at: number; } | undefined;

export async function load() {
    data = (await DataStore.get<Record<string, Entry>>(STORE_KEY)) ?? {};

    const cutoff = Date.now() - PRUNE_AFTER;
    for (const [id, e] of Object.entries(data)) {
        if (!e.events.length || e.events[e.events.length - 1][0] < cutoff) delete data[id];
    }
}

function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => DataStore.set(STORE_KEY, data), 2000);
}

export function flush() {
    clearTimeout(saveTimer);
    return DataStore.set(STORE_KEY, data);
}

export function record(channelId: string, guildId: string | null, signal: Signal) {
    const now = Date.now();

    if (signal === Signal.Visit) {
        if (lastVisit?.id === channelId && now - lastVisit.at < VISIT_COOLDOWN) return;
        lastVisit = { id: channelId, at: now };
    }

    const entry = data[channelId] ??= { total: 0, events: [], guildId };
    entry.guildId = guildId;
    entry.total += signal;
    entry.events.push([now, signal]);
    if (entry.events.length > MAX_EVENTS) entry.events.splice(0, entry.events.length - MAX_EVENTS);

    scheduleSave();
}

function ageWeight(ageMs: number) {
    const h = ageMs / 3600_000;
    if (h < 4) return 100;
    if (h < 24) return 80;
    if (h < 72) return 60;
    if (h < 168) return 40;
    if (h < 720) return 20;
    return 10;
}

export function score(channelId: string, now = Date.now()): number {
    const entry = data[channelId];
    if (!entry) return 0;

    let sampled = 0;
    let weight = 0;
    for (const [t, w] of entry.events) {
        sampled += w;
        weight += w * ageWeight(now - t);
    }
    // Scale the sampled recency up to the full lifetime count (Firefox-style frecency)
    return sampled ? (weight / sampled) * entry.total : 0;
}

export function lastSeen(channelId: string): number | undefined {
    const e = data[channelId]?.events;
    return e?.length ? e[e.length - 1][0] : undefined;
}

/** Channel ids ordered by frecency, best first */
export function top(limit: number, filter?: (id: string) => boolean): string[] {
    const now = Date.now();
    return Object.keys(data)
        .filter(id => !filter || filter(id))
        .map(id => [id, score(id, now)] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([id]) => id);
}

/** Sum of channel frecency per guild — how "at home" you are in each server */
export function guildScores(): Map<string, number> {
    const now = Date.now();
    const out = new Map<string, number>();
    for (const [id, e] of Object.entries(data)) {
        if (!e.guildId) continue;
        out.set(e.guildId, (out.get(e.guildId) ?? 0) + score(id, now));
    }
    return out;
}

export function forget(channelId: string) {
    delete data[channelId];
    scheduleSave();
}

export function clear() {
    data = {};
    lastVisit = undefined;
    return flush();
}
