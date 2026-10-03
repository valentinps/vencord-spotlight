/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ChannelType } from "@vencord/discord-types/enums";

const PATHS = {
    search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4",
    text: "M10 3 8 21M16 3l-2 18M4 8.5h17M3 15.5h17",
    voice: "M11 5 6.5 9H3v6h3.5l4.5 4V5zM15.5 9a4.5 4.5 0 0 1 0 6M18.5 6a8.5 8.5 0 0 1 0 12",
    stage: "M12 3a3.5 3.5 0 0 0-3.5 3.5v4a3.5 3.5 0 0 0 7 0v-4A3.5 3.5 0 0 0 12 3zM5.5 10.5a6.5 6.5 0 0 0 13 0M12 17v4",
    announcement: "M4 10v4h3l7 4V6L7 10H4zM17.5 9.5a3.5 3.5 0 0 1 0 5",
    forum: "M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.6A7.5 7.5 0 1 1 20 11.5z",
    thread: "M7 3v11a4 4 0 0 0 4 4h9M16 14l4 4-4 4",
    group: "M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18.5 14a6.5 6.5 0 0 1 3 6",
    home: "M3 11 12 4l9 7M5.5 9.5V20h13V9.5",
    settings: "M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4",
    check: "M5 12.5 10 17l9-10",
    "check-all": "M2.5 12.5 7 17l9-10M12 15.5 13.5 17l9-10",
    link: "M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1",
    trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13",
    muted: "M6 16V11a6 6 0 0 1 9.5-4.9M18 11v5l1.5 1.5h-13M10 20.5a2 2 0 0 0 4 0M3 3l18 18",
    server: "M4 5h16v5H4zM4 14h16v5H4zM7.5 7.5h.01M7.5 16.5h.01",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number; }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d={PATHS[name]} />
        </svg>
    );
}

export function channelIconName(type: number, isThread: boolean): IconName {
    if (isThread) return "thread";
    switch (type) {
        case ChannelType.GUILD_VOICE: return "voice";
        case ChannelType.GUILD_STAGE_VOICE: return "stage";
        case ChannelType.GUILD_ANNOUNCEMENT: return "announcement";
        case ChannelType.GUILD_FORUM:
        case ChannelType.GUILD_MEDIA: return "forum";
        default: return "text";
    }
}
