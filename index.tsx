/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin, { OptionType } from "@utils/types";
import { ChannelStore, createRoot, UserStore } from "@webpack/common";
import type { Root } from "react-dom/client";

import * as Frecency from "./frecency";
import { Spotlight } from "./Spotlight";
import managedStyle from "./style.css?managed";

const settings = definePluginSettings({
    hotkey: {
        type: OptionType.SELECT,
        description: "Shortcut that opens Spotlight",
        options: [
            { label: "Ctrl+K (replaces Discord's Quick Switcher)", value: "ctrl+k", default: true },
            { label: "Ctrl+Shift+K", value: "ctrl+shift+k" },
            { label: "Ctrl+Space", value: "ctrl+space" },
        ],
    },
    showMentions: {
        type: OptionType.BOOLEAN,
        description: "Show channels where you were mentioned when the search box is empty",
        default: true,
    },
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let previousFocus: HTMLElement | null = null;

function stopKeys(e: KeyboardEvent) {
    // Keep Discord's own document-level keybinds from reacting while we're typing
    e.stopPropagation();
}

function open() {
    if (root) return;
    previousFocus = document.activeElement as HTMLElement | null;

    container = document.createElement("div");
    container.className = "vc-spotlight-root";
    container.addEventListener("keydown", stopKeys);
    document.body.appendChild(container);

    root = createRoot(container);
    root.render(
        <ErrorBoundary onError={() => setTimeout(close)}>
            <Spotlight onClose={close} showMentions={settings.store.showMentions} />
        </ErrorBoundary>
    );
}

function close() {
    if (!root) return;
    root.unmount();
    container?.remove();
    root = null;
    container = null;
    previousFocus?.focus?.();
    previousFocus = null;
}

function matchesHotkey(e: KeyboardEvent) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.repeat) return false;
    switch (settings.store.hotkey) {
        case "ctrl+k": return !e.shiftKey && e.code === "KeyK";
        case "ctrl+shift+k": return e.shiftKey && e.code === "KeyK";
        case "ctrl+space": return !e.shiftKey && e.code === "Space";
    }
    return false;
}

function onGlobalKeyDown(e: KeyboardEvent) {
    if (!matchesHotkey(e)) return;
    // Capture phase on window: runs before Discord's handler so its Quick Switcher never opens
    e.preventDefault();
    e.stopImmediatePropagation();
    root ? close() : open();
}

export default definePlugin({
    name: "Spotlight",
    description: "A Spotlight-style launcher: fuzzy-search channels, DMs, servers and commands, ranked by what you actually use.",
    authors: [{ name: "plane", id: 0n }],
    settings,
    managedStyle,

    async start() {
        await Frecency.load();
        window.addEventListener("keydown", onGlobalKeyDown, true);
    },

    stop() {
        window.removeEventListener("keydown", onGlobalKeyDown, true);
        close();
        Frecency.flush();
    },

    flux: {
        CHANNEL_SELECT({ channelId, guildId }: { channelId: string | null; guildId: string | null; }) {
            if (channelId) Frecency.record(channelId, guildId ?? null, Frecency.Signal.Visit);
        },

        MESSAGE_CREATE({ message, optimistic }: { message: any; optimistic: boolean; }) {
            // Posting somewhere is a much stronger signal than just looking at it
            if (!optimistic || message?.author?.id !== UserStore.getCurrentUser()?.id) return;
            const guildId = ChannelStore.getChannel(message.channel_id)?.guild_id ?? null;
            Frecency.record(message.channel_id, guildId, Frecency.Signal.Message);
        },
    },

    // exposed for console debugging: Vencord.Plugins.plugins.Spotlight.open()
    open,
    close,
});
