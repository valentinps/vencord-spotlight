/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface TokenMatch {
    score: number;
    indices: number[];
}

const MARKS = /\p{M}/gu;
const WORD_CHAR = /[\p{L}\p{N}]/u;

const foldCache = new Map<string, string>();

/** Lowercases and strips diacritics while preserving string length. */
export function fold(str: string): string {
    let out = foldCache.get(str);
    if (out !== undefined) return out;

    out = "";
    for (let i = 0; i < str.length; i++) {
        const c = str[i];
        const f = c.normalize("NFD").replace(MARKS, "").toLowerCase();
        out += f.length === 1 ? f : c.toLowerCase().length === 1 ? c.toLowerCase() : c;
    }

    if (foldCache.size > 20000) foldCache.clear();
    foldCache.set(str, out);
    return out;
}

function isBoundary(original: string, i: number) {
    if (i === 0) return true;
    const prev = original[i - 1];
    if (!WORD_CHAR.test(prev)) return true;
    // camelCase / PascalCase transitions
    const cur = original[i];
    return cur !== cur.toLowerCase() && prev === prev.toLowerCase();
}

/**
 * Match a single (already folded) token against `original`.
 * Returns null when the token isn't a subsequence of the string.
 * Scores are roughly in [0, 1]; higher is better.
 */
export function matchToken(token: string, original: string): TokenMatch | null {
    if (!token) return { score: 1, indices: [] };
    const s = fold(original);

    // 1. Contiguous substring — prefer occurrences at a word boundary
    let idx = s.indexOf(token);
    if (idx !== -1) {
        let best = idx;
        while (idx !== -1 && !isBoundary(original, idx)) idx = s.indexOf(token, idx + 1);
        if (idx !== -1) best = idx;

        let score: number;
        if (best === 0) score = 1;
        else if (isBoundary(original, best)) score = 0.9;
        else score = 0.72;

        // Small bonus the closer the token covers the whole string
        score += 0.08 * (token.length / Math.max(s.length, 1));

        return { score, indices: range(best, token.length) };
    }

    // 2. Subsequence, greedily preferring word boundaries (acronyms like "ot" -> "off-topic")
    const indices: number[] = [];
    let from = 0;
    let boundaryHits = 0;
    for (let t = 0; t < token.length; t++) {
        const ch = token[t];
        let found = -1;

        // look ahead for this char at a word boundary before settling for any occurrence
        for (let i = from; i < s.length; i++) {
            if (s[i] === ch && isBoundary(original, i)) { found = i; break; }
        }
        // only take the boundary hit if the rest of the token can still match after it
        if (found !== -1 && !isSubsequence(token, t + 1, s, found + 1)) found = -1;
        if (found === -1) found = s.indexOf(ch, from);
        if (found === -1) return null;

        if (isBoundary(original, found)) boundaryHits++;
        indices.push(found);
        from = found + 1;
    }

    let runs = 1;
    for (let i = 1; i < indices.length; i++) if (indices[i] !== indices[i - 1] + 1) runs++;

    const score = 0.25
        + 0.3 * (boundaryHits / token.length)
        + 0.15 * (1 - (runs - 1) / token.length);

    return { score, indices };
}

function isSubsequence(token: string, tStart: number, s: string, sStart: number) {
    let j = sStart;
    for (let t = tStart; t < token.length; t++) {
        j = s.indexOf(token[t], j);
        if (j === -1) return false;
        j++;
    }
    return true;
}

function range(start: number, len: number) {
    const out = new Array<number>(len);
    for (let i = 0; i < len; i++) out[i] = start + i;
    return out;
}

export function tokenize(query: string): string[] {
    return fold(query.trim()).split(/[\s\-_/·・|]+/).filter(Boolean);
}

export interface FieldMatch {
    score: number;
    /** Highlight indices into the title */
    titleIndices: number[];
}

/**
 * Multi-token match: every token must hit either the title or one of the
 * secondary fields (server name, category, username…). Title hits weigh more,
 * so "gen tavern" finds #general in the "Tavern" server.
 */
export function matchFields(tokens: string[], title: string, secondary: string[]): FieldMatch | null {
    if (!tokens.length) return { score: 0, titleIndices: [] };

    let total = 0;
    const titleIndices: number[] = [];

    for (const token of tokens) {
        const t = matchToken(token, title);
        let best = t ? t.score : -1;
        let fromTitle = !!t;

        for (const field of secondary) {
            if (!field) continue;
            const m = matchToken(token, field);
            if (m && m.score * 0.55 > best) {
                best = m.score * 0.55;
                fromTitle = false;
            }
        }

        if (best < 0) return null;
        if (fromTitle && t) titleIndices.push(...t.indices);
        total += best;
    }

    return { score: total / tokens.length, titleIndices };
}
