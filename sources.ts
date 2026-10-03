/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { copyWithToast } from "@utils/discord";
import { Channel, Guild, User } from "@vencord/discord-types";
import { ChannelType } from "@vencord/discord-types/enums";
import {
    ActiveJoinedThreadsStore, ChannelRouter, ChannelStore, FluxDispatcher, GuildChannelStore, GuildStore,
    NavigationRouter, ReadStateStore, RelationshipStore, SelectedChannelStore, SelectedGuildStore,
    SettingsRouter, showToast, SortedGuildStore, UserGuildSettingsStore, UserStore
} from "@webpack/common";

import * as Frecency from "./frecency";
import { matchFields, tokenize } from "./fuzzy";

export type ItemKind = "channel" | "dm" | "guild" | "command";

export interface Command {
    id: string;
    title: string;
    subtitle: string;
    keywords: string[];
    icon: CommandIcon;
    available?(): boolean;
    run(): void;
}

export type CommandIcon = "home" | "settings" | "check" | "check-all" | "link" | "trash";

export interface Item {
    key: string;
    kind: ItemKind;
    title: string;
    /** extra fields searched with lower weight */
    secondary: string[];
    /** context line shown under the title */
    subtitle: string;
    guildId: string | null;
    channel?: Channel;
    guild?: Guild;
    user?: User;
    command?: Command;
    frecency: number;
    /** sidebar order, used as a tie-breaker inside a scoped server */
    order: number;
}

export interface Ranked {
    item: Item;
    score: number;
    titleIndices: number[];
}

export type Mode = "all" | "channels" | "dms" | "guilds" | "commands";

export const MODE_PREFIXES: Record<string, Mode> = {
    "#": "channels",
    "@": "dms",
    "*": "guilds",
    ">": "commands",
};

const MODE_KINDS: Record<Mode, ItemKind[]> = {
    all: ["channel", "dm", "guild", "command"],
    channels: ["channel"],
    dms: ["dm"],
    guilds: ["guild"],
    commands: ["command"],
};

/* ---------- read state helpers ---------- */

export function channelBadge(channelId: string) {
    return {
        mentions: ReadStateStore.getMentionCount(channelId) ?? 0,
        unread: ReadStateStore.hasUnread(channelId),
    };
}

function guildChannelIds(guildId: string): string[] {
    const { SELECTABLE = [], VOCAL = [] } = GuildChannelStore.getChannels(guildId) ?? {};
    const ids = [...SELECTABLE, ...VOCAL].map((c: any) => c.channel.id as string);
    for (const byParent of Object.values(ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guildId) ?? {}))
        for (const t of Object.values(byParent as Record<string, any>)) ids.push(t.channel.id);
    return ids;
}

export function guildBadge(guildId: string) {
    let mentions = 0, unread = false;
    for (const id of guildChannelIds(guildId)) {
        mentions += ReadStateStore.getMentionCount(id) ?? 0;
        if (!unread && ReadStateStore.hasUnread(id) && !UserGuildSettingsStore.isChannelMuted(guildId, id)) unread = true;
    }
    return { mentions, unread };
}

export function isMuted(item: Item) {
    if (item.kind === "guild") return UserGuildSettingsStore.isMuted(item.guildId!);
    if (item.kind === "channel") {
        // threads inherit the mute state of their parent channel
        const ch = item.channel!;
        return UserGuildSettingsStore.isGuildOrCategoryOrChannelMuted(item.guildId!, ch.isThread() ? ch.parent_id : ch.id);
    }
    if (item.kind === "dm") return UserGuildSettingsStore.isChannelMuted(null, item.channel!.id);
    return false;
}

export function markRead(item: Item) {
    const ids = item.kind === "guild" ? guildChannelIds(item.guildId!) : item.channel ? [item.channel.id] : [];
    const channels = ids
        .filter(id => ReadStateStore.hasUnread(id))
        .map(channelId => ({ channelId, messageId: ReadStateStore.lastMessageId(channelId), readStateType: 0 }));

    if (!channels.length) return false;
    FluxDispatcher.dispatch({ type: "BULK_ACK", context: "APP", channels });
    return true;
}

/* ---------- building the index ---------- */

const SKIPPED_TYPES = new Set<number>([ChannelType.GUILD_CATEGORY, ChannelType.GUILD_DIRECTORY, ChannelType.GUILD_STORE]);

export function userDisplayName(user: User | undefined, fallback = "Unknown user") {
    if (!user) return fallback;
    return RelationshipStore.getNickname(user.id) || user.globalName || user.username;
}

function buildGuildItems(out: Item[]) {
    const guildFrecency = Frecency.guildScores();
    const guildOrder = SortedGuildStore.getFlattenedGuildIds?.() ?? Object.keys(GuildStore.getGuilds());

    guildOrder.forEach((guildId, guildIdx) => {
        const guild = GuildStore.getGuild(guildId);
        if (!guild) return;

        out.push({
            key: "g" + guildId,
            kind: "guild",
            title: guild.name,
            secondary: [],
            subtitle: "Server",
            guildId,
            guild,
            frecency: guildFrecency.get(guildId) ?? 0,
            order: guildIdx,
        });

        const { SELECTABLE = [], VOCAL = [] } = GuildChannelStore.getChannels(guildId) ?? {};
        const all = [...SELECTABLE, ...VOCAL] as { channel: Channel, comparator: number; }[];

        for (const { channel, comparator } of all) {
            if (SKIPPED_TYPES.has(channel.type)) continue;
            const category = channel.parent_id ? ChannelStore.getChannel(channel.parent_id)?.name : undefined;

            out.push({
                key: "c" + channel.id,
                kind: "channel",
                title: channel.name,
                secondary: [guild.name, category ?? ""],
                subtitle: category ? `${guild.name} › ${category}` : guild.name,
                guildId,
                channel,
                guild,
                frecency: Frecency.score(channel.id),
                order: (channel.type === ChannelType.GUILD_VOICE || channel.type === ChannelType.GUILD_STAGE_VOICE ? 1e6 : 0) + comparator,
            });
        }

        for (const byParent of Object.values(ActiveJoinedThreadsStore.getActiveJoinedThreadsForGuild(guildId) ?? {})) {
            for (const { channel } of Object.values(byParent as Record<string, { channel: Channel; }>)) {
                const parent = ChannelStore.getChannel(channel.parent_id);
                out.push({
                    key: "c" + channel.id,
                    kind: "channel",
                    title: channel.name,
                    secondary: [guild.name, parent?.name ?? ""],
                    subtitle: parent ? `${guild.name} › #${parent.name}` : guild.name,
                    guildId,
                    channel,
                    guild,
                    frecency: Frecency.score(channel.id),
                    order: 2e6,
                });
            }
        }
    });
}

function buildPrivateItems(out: Item[]) {
    ChannelStore.getSortedPrivateChannels().forEach((channel, idx) => {
        if (channel.type === ChannelType.DM) {
            const user = UserStore.getUser(channel.recipients[0]);
            if (!user) return;
            const name = userDisplayName(user);

            out.push({
                key: "c" + channel.id,
                kind: "dm",
                title: name,
                secondary: [user.username, user.globalName ?? ""],
                subtitle: user.bot ? `@${user.username} · Bot` : `@${user.username}`,
                guildId: null,
                channel,
                user,
                frecency: Frecency.score(channel.id),
                order: idx,
            });
        } else if (channel.type === ChannelType.GROUP_DM) {
            const names = channel.recipients.map(id => userDisplayName(UserStore.getUser(id), ""));
            out.push({
                key: "c" + channel.id,
                kind: "dm",
                title: channel.name || names.join(", "),
                secondary: names,
                subtitle: `Group · ${channel.recipients.length + 1} members`,
                guildId: null,
                channel,
                frecency: Frecency.score(channel.id),
                order: idx,
            });
        }
    });
}

export const commands: Command[] = [
    {
        id: "home",
        title: "Go to Friends",
        subtitle: "Direct messages home",
        keywords: ["home", "friends", "dms"],
        icon: "home",
        run: () => NavigationRouter.transitionTo("/channels/@me"),
    },
    {
        id: "settings",
        title: "Open User Settings",
        subtitle: "Discord & Vencord settings",
        keywords: ["preferences", "options", "config"],
        icon: "settings",
        run: () => SettingsRouter.openUserSettings(),
    },
    {
        id: "read-server",
        title: "Mark Current Server as Read",
        subtitle: "Clears unread state for every channel in this server",
        keywords: ["ack", "read", "clear"],
        icon: "check",
        available: () => !!SelectedGuildStore.getGuildId(),
        run() {
            const guildId = SelectedGuildStore.getGuildId();
            if (!guildId) return;
            const done = markRead({ kind: "guild", guildId } as Item);
            showToast(done ? "Server marked as read" : "Nothing unread here", done ? "success" : "message");
        },
    },
    {
        id: "read-all",
        title: "Mark All Servers as Read",
        subtitle: "Clears unread state everywhere (DMs untouched)",
        keywords: ["ack", "read", "clear", "everything"],
        icon: "check-all",
        run() {
            let any = false;
            for (const guildId of Object.keys(GuildStore.getGuilds()))
                any = markRead({ kind: "guild", guildId } as Item) || any;
            showToast(any ? "All servers marked as read" : "Nothing unread", any ? "success" : "message");
        },
    },
    {
        id: "copy-link",
        title: "Copy Link to Current Channel",
        subtitle: "discord.com/channels/…",
        keywords: ["share", "url", "clipboard"],
        icon: "link",
        available: () => !!SelectedChannelStore.getChannelId(),
        run() {
            const channelId = SelectedChannelStore.getChannelId();
            const guildId = SelectedGuildStore.getGuildId() ?? "@me";
            copyWithToast(`https://discord.com/channels/${guildId}/${channelId}`, "Channel link copied");
        },
    },
    {
        id: "clear-history",
        title: "Clear Spotlight History",
        subtitle: "Forget recently visited channels",
        keywords: ["reset", "frecency", "recent", "forget"],
        icon: "trash",
        run() {
            Frecency.clear();
            showToast("Spotlight history cleared", "success");
        },
    },
];

function buildCommandItems(out: Item[]) {
    commands.forEach((command, idx) => {
        if (command.available && !command.available()) return;
        out.push({
            key: "x" + command.id,
            kind: "command",
            title: command.title,
            secondary: command.keywords,
            subtitle: command.subtitle,
            guildId: null,
            command,
            frecency: 0,
            order: idx,
        });
    });
}

export function buildIndex(): Item[] {
    const out: Item[] = [];
    buildPrivateItems(out);
    buildGuildItems(out);
    buildCommandItems(out);
    return out;
}

/* ---------- ranking ---------- */

const KIND_BIAS: Record<ItemKind, number> = { channel: 0, dm: 0, guild: -2, command: -14 };

function rankBonus(item: Item) {
    let bonus = Math.min(30, Math.log2(1 + item.frecency) * 3);
    if (item.channel) {
        const { mentions, unread } = channelBadge(item.channel.id);
        if (mentions) bonus += 8;
        else if (unread) bonus += 2;
    }
    if (isMuted(item)) bonus -= 10;
    return bonus;
}

export function search(index: Item[], query: string, mode: Mode, scopeGuildId: string | null, limit = 60): Ranked[] {
    const tokens = tokenize(query);
    const kinds = MODE_KINDS[mode];

    const out: Ranked[] = [];
    for (const item of index) {
        if (!kinds.includes(item.kind)) continue;
        if (scopeGuildId && (item.guildId !== scopeGuildId || item.kind === "guild")) continue;

        const m = matchFields(tokens, item.title, item.secondary);
        if (!m) continue;

        out.push({
            item,
            titleIndices: m.titleIndices,
            score: m.score * 100 + rankBonus(item) + (mode === "commands" ? 0 : KIND_BIAS[item.kind]),
        });
    }

    return out.sort((a, b) => b.score - a.score || a.item.order - b.item.order).slice(0, limit);
}

/** All channels of one server, frecent first then sidebar order — the empty-query view of a scoped search */
export function browseGuild(index: Item[], guildId: string): Ranked[] {
    return index
        .filter(i => i.kind === "channel" && i.guildId === guildId)
        .sort((a, b) => (b.frecency > 0 ? 1 : 0) - (a.frecency > 0 ? 1 : 0) || b.frecency - a.frecency || a.order - b.order)
        .map(item => ({ item, score: 0, titleIndices: [] }));
}

/* ---------- actions ---------- */

export function openItem(item: Item) {
    switch (item.kind) {
        case "guild":
            NavigationRouter.transitionToGuild(item.guildId!);
            break;
        case "command":
            item.command!.run();
            break;
        default: {
            const { channel } = item;
            if (!channel) return;
            if (channel.isThread?.()) ChannelRouter.transitionToThread(channel);
            else ChannelRouter.transitionToChannel(channel.id);
        }
    }
}
