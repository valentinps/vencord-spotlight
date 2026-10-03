/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { classNameFactory } from "@utils/css";
import { IconUtils, SelectedChannelStore, showToast, useEffect, useMemo, useReducer, useRef, useState } from "@webpack/common";

import * as Frecency from "./frecency";
import { channelIconName, Icon } from "./icons";
import {
    browseGuild, buildIndex, channelBadge, guildBadge, isMuted, Item, ItemKind, markRead, Mode, MODE_PREFIXES,
    openItem, Ranked, search
} from "./sources";

const cl = classNameFactory("vc-spotlight-");

interface Section {
    title: string;
    rows: Ranked[];
    /** show "2h ago" instead of badges-only on the right */
    showLastSeen?: boolean;
}

const KIND_TITLES: Record<ItemKind, string> = {
    channel: "Channels",
    dm: "Direct Messages",
    guild: "Servers",
    command: "Commands",
};

const MODE_LABELS: Record<Exclude<Mode, "all">, { prefix: string, label: string; }> = {
    channels: { prefix: "#", label: "Channels" },
    dms: { prefix: "@", label: "People" },
    guilds: { prefix: "*", label: "Servers" },
    commands: { prefix: ">", label: "Commands" },
};

export interface SpotlightProps {
    onClose(): void;
    showMentions: boolean;
}

export function Spotlight({ onClose, showMentions }: SpotlightProps) {
    const index = useMemo(buildIndex, []);
    const byKey = useMemo(() => new Map(index.map(i => [i.key, i])), [index]);

    const [query, setQuery] = useState("");
    const [mode, setMode] = useState<Mode>("all");
    const [scope, setScope] = useState<Item | null>(null);
    const [selected, setSelected] = useState(0);
    // bumped after actions that change read state so badges re-render
    const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const sections = useMemo<Section[]>(() => {
        const q = query.trim();

        if (scope && !q && mode === "all")
            return [{ title: `Channels in ${scope.title}`, rows: browseGuild(index, scope.guildId!) }];

        if (!q && mode === "all" && !scope) {
            const current = SelectedChannelStore.getChannelId();
            const recent = Frecency.top(9, id => id !== current && byKey.has("c" + id))
                .map(id => ({ item: byKey.get("c" + id)!, score: 0, titleIndices: [] }));

            const out: Section[] = [];
            if (recent.length) out.push({ title: "Jump Back In", rows: recent, showLastSeen: true });

            if (showMentions) {
                const shown = new Set(recent.map(r => r.item.key));
                const mentions = index
                    .filter(i => i.channel && !shown.has(i.key))
                    .map(i => ({ i, n: channelBadge(i.channel!.id).mentions }))
                    .filter(x => x.n > 0)
                    .sort((a, b) => b.n - a.n)
                    .slice(0, 6)
                    .map(({ i }) => ({ item: i, score: 0, titleIndices: [] }));
                if (mentions.length) out.push({ title: "Mentions", rows: mentions });
            }
            return out;
        }

        const ranked = search(index, q, mode, scope?.guildId ?? null);
        if (!q || mode !== "all") return ranked.length ? [{ title: scope ? `In ${scope.title}` : MODE_LABELS[mode as Exclude<Mode, "all">]?.label ?? "Results", rows: ranked }] : [];

        // Query in "all" mode: best hit on top, the rest grouped by kind in order of each group's best score
        const [top, ...rest] = ranked;
        if (!top) return [];
        const groups = new Map<ItemKind, Ranked[]>();
        for (const r of rest) {
            if (!groups.has(r.item.kind)) groups.set(r.item.kind, []);
            groups.get(r.item.kind)!.push(r);
        }
        return [
            { title: "Top Hit", rows: [top] },
            ...[...groups].map(([kind, rows]) => ({ title: KIND_TITLES[kind], rows: rows.slice(0, kind === "command" ? 4 : 12) })),
        ];
    }, [index, query, mode, scope]);

    const flat = useMemo(() => sections.flatMap(s => s.rows), [sections]);

    useEffect(() => setSelected(0), [sections]);

    useEffect(() => {
        listRef.current?.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: "nearest" });
    }, [selected]);

    useEffect(() => { inputRef.current?.focus(); }, []);

    function activate(row: Ranked | undefined) {
        if (!row) return;
        onClose();
        openItem(row.item);
    }

    function scopeTo(row: Ranked | undefined) {
        const guildId = row?.item.guildId;
        if (!row || !guildId || row.item.kind === "command") return;
        const guildItem = row.item.kind === "guild" ? row.item : index.find(i => i.kind === "guild" && i.guildId === guildId);
        if (!guildItem) return;
        setScope(guildItem);
        setMode("all");
        setQuery("");
    }

    function onInput(value: string) {
        const prefixMode = MODE_PREFIXES[value[0]];
        if (prefixMode && mode === "all") {
            setMode(prefixMode);
            value = value.slice(1);
        }
        setQuery(value);
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        const move = (delta: number) => {
            e.preventDefault();
            if (!flat.length) return;
            setSelected(s => (s + delta + flat.length) % flat.length);
        };
        const ctrl = e.ctrlKey || e.metaKey;

        switch (e.key) {
            case "ArrowDown": return move(1);
            case "ArrowUp": return move(-1);
            case "PageDown": return move(Math.min(5, flat.length - 1 - selected) || 1);
            case "PageUp": return move(-Math.min(5, selected) || -1);
            case "n": if (ctrl) move(1); return;
            case "p": if (ctrl) move(-1); return;

            case "Enter": {
                e.preventDefault();
                const row = flat[selected];
                if (!row) return;
                if (e.shiftKey) {
                    if (row.item.kind === "command") return;
                    const done = markRead(row.item);
                    showToast(done ? `Marked ${row.item.title} as read` : "Already read", done ? "success" : "message");
                    forceUpdate();
                } else activate(row);
                return;
            }

            case "Tab":
                e.preventDefault();
                if (e.shiftKey) return unwind();
                return scopeTo(flat[selected]);

            case "Backspace":
                if (!query && e.currentTarget.selectionStart === 0) { e.preventDefault(); unwind(); }
                return;

            case "Escape":
                e.preventDefault();
                if (query) setQuery("");
                else if (!unwind()) onClose();
                return;
        }
    }

    /** Undo the innermost filter (mode chip, then server scope). Returns false if there was nothing to undo. */
    function unwind() {
        if (mode !== "all") { setMode("all"); return true; }
        if (scope) { setScope(null); return true; }
        return false;
    }

    let rowIdx = 0;
    const placeholder = scope
        ? `Search ${scope.title}…`
        : mode === "all" ? "Search channels, people, servers…  (# @ * > to filter)" : `Search ${MODE_LABELS[mode].label.toLowerCase()}…`;

    return (
        <div className={cl("backdrop")} onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className={cl("panel")} role="dialog" aria-label="Spotlight">
                <div className={cl("search")}>
                    <span className={cl("search-icon")}><Icon name="search" size={20} /></span>
                    {scope && (
                        <button className={cl("chip")} onClick={() => setScope(null)} title="Remove server filter (Shift+Tab)">
                            <GuildAvatar item={scope} size={16} />
                            {scope.title}
                            <span className={cl("chip-x")}>×</span>
                        </button>
                    )}
                    {mode !== "all" && (
                        <button className={cl("chip")} onClick={() => setMode("all")} title="Remove filter (Backspace)">
                            <b>{MODE_LABELS[mode].prefix}</b>{MODE_LABELS[mode].label}
                            <span className={cl("chip-x")}>×</span>
                        </button>
                    )}
                    <input
                        ref={inputRef}
                        className={cl("input")}
                        value={query}
                        placeholder={placeholder}
                        spellCheck={false}
                        onChange={e => onInput(e.currentTarget.value)}
                        onKeyDown={onKeyDown}
                    />
                    <kbd className={cl("kbd")}>esc</kbd>
                </div>

                <div className={cl("results")} ref={listRef}>
                    {sections.map(section => (
                        <div key={section.title} className={cl("section")}>
                            <div className={cl("section-title")}>{section.title}</div>
                            {section.rows.map(row => {
                                const idx = rowIdx++;
                                return (
                                    <Row
                                        key={row.item.key}
                                        row={row}
                                        idx={idx}
                                        selected={idx === selected}
                                        large={section.title === "Top Hit"}
                                        showLastSeen={section.showLastSeen}
                                        onHover={() => setSelected(idx)}
                                        onClick={() => activate(row)}
                                    />
                                );
                            })}
                        </div>
                    ))}
                    {!flat.length && <EmptyState query={query} hasScope={!!scope || mode !== "all"} />}
                </div>

                <div className={cl("footer")}>
                    <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
                    <span><kbd>↵</kbd> open</span>
                    <span><kbd>⇧</kbd><kbd>↵</kbd> mark read</span>
                    <span><kbd>tab</kbd> search in server</span>
                    <span className={cl("footer-filters")}><kbd>#</kbd><kbd>@</kbd><kbd>*</kbd><kbd>&gt;</kbd> filters</span>
                </div>
            </div>
        </div>
    );
}

function EmptyState({ query, hasScope }: { query: string; hasScope: boolean; }) {
    if (query) return (
        <div className={cl("empty")}>
            <div className={cl("empty-title")}>No results for “{query}”</div>
            {hasScope && <div>Press <kbd>⇧</kbd><kbd>tab</kbd> to search everywhere</div>}
        </div>
    );
    return (
        <div className={cl("empty")}>
            <div className={cl("empty-title")}>Start typing to search</div>
            <div>Channels you visit will show up here so you can jump back in.</div>
        </div>
    );
}

/* ---------- rows ---------- */

interface RowProps {
    row: Ranked;
    idx: number;
    selected: boolean;
    large: boolean;
    showLastSeen?: boolean;
    onHover(): void;
    onClick(): void;
}

function Row({ row, idx, selected, large, showLastSeen, onHover, onClick }: RowProps) {
    const { item } = row;
    const muted = isMuted(item);
    const badge = item.kind === "guild" ? guildBadge(item.guildId!) : item.channel ? channelBadge(item.channel.id) : null;
    const seen = showLastSeen && item.channel ? Frecency.lastSeen(item.channel.id) : undefined;
    const topic = item.kind === "channel" && (large || selected) ? item.channel!.topic : "";

    return (
        <div
            data-idx={idx}
            className={cl("row", { "row-selected": selected, "row-large": large, "row-muted": muted, "row-unread": !!badge?.unread })}
            onMouseMove={selected ? undefined : onHover}
            onClick={onClick}
        >
            <ItemIcon item={item} size={large ? 40 : 32} />
            <div className={cl("text")}>
                <div className={cl("title")}>
                    <Highlight text={item.title} indices={row.titleIndices} />
                </div>
                <div className={cl("subtitle")}>
                    {item.subtitle}
                    {topic && <span className={cl("topic")}> — {topic}</span>}
                </div>
            </div>
            <div className={cl("meta")}>
                {muted && <span className={cl("muted-icon")} title="Muted"><Icon name="muted" size={14} /></span>}
                {seen && <span className={cl("seen")}>{timeAgo(seen)}</span>}
                {badge && badge.mentions > 0 && <span className={cl("mentions")}>{badge.mentions > 99 ? "99+" : badge.mentions}</span>}
                {badge && !badge.mentions && badge.unread && !muted && <span className={cl("unread-dot")} />}
                {selected && <kbd className={cl("kbd")}>↵</kbd>}
            </div>
        </div>
    );
}

function Highlight({ text, indices }: { text: string; indices: number[]; }) {
    if (!indices.length) return <>{text}</>;
    const hit = new Set(indices);
    const parts: React.ReactNode[] = [];
    let buf = "", bufHit = false;
    const flush = (k: number) => {
        if (!buf) return;
        parts.push(bufHit ? <mark key={k} className={cl("hl")}>{buf}</mark> : buf);
        buf = "";
    };
    for (let i = 0; i < text.length; i++) {
        const h = hit.has(i);
        if (h !== bufHit) { flush(i); bufHit = h; }
        buf += text[i];
    }
    flush(text.length);
    return <>{parts}</>;
}

/* ---------- icons ---------- */

function initials(name: string) {
    return name.split(/\s+/).filter(Boolean).slice(0, 3).map(w => [...w][0]).join("");
}

function GuildAvatar({ item, size }: { item: Item; size: number; }) {
    const { guild } = item;
    const url = guild?.icon ? IconUtils.getGuildIconURL({ id: guild.id, icon: guild.icon, size: 64 }) : undefined;
    return url
        ? <img className={cl("guild-img")} src={url} width={size} height={size} alt="" />
        : <span className={cl("guild-initials")} style={{ width: size, height: size, fontSize: size * 0.38 }}>{initials(guild?.name ?? "?")}</span>;
}

function ItemIcon({ item, size }: { item: Item; size: number; }) {
    const style = { width: size, height: size };

    switch (item.kind) {
        case "guild":
            return <span className={cl("icon")} style={style}><GuildAvatar item={item} size={size} /></span>;

        case "dm": {
            const ch = item.channel!;
            const url = item.user
                ? item.user.getAvatarURL(undefined, 64)
                : ch.icon ? IconUtils.getChannelIconURL({ id: ch.id, icon: ch.icon, size: 64 }) : undefined;
            return (
                <span className={cl("icon", "icon-round")} style={style}>
                    {url ? <img src={url} width={size} height={size} alt="" /> : <span className={cl("glyph")}><Icon name="group" /></span>}
                </span>
            );
        }

        case "channel": {
            const ch = item.channel!;
            return (
                <span className={cl("icon")} style={style}>
                    <span className={cl("glyph")}><Icon name={channelIconName(ch.type, ch.isThread())} size={size * 0.55} /></span>
                    <span className={cl("icon-badge")}><GuildAvatar item={item} size={Math.round(size * 0.45)} /></span>
                </span>
            );
        }

        case "command":
            return (
                <span className={cl("icon")} style={style}>
                    <span className={cl("glyph", "glyph-accent")}><Icon name={item.command!.icon} size={size * 0.55} /></span>
                </span>
            );
    }
}

function timeAgo(t: number) {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return "now";
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
    return `${Math.floor(s / (86400 * 7))}w`;
}
