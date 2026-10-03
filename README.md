# Spotlight for Vencord

A Spotlight-style launcher for Discord: fuzzy-search every channel, DM, server and a few commands from one box, ranked by what you actually use.

## Features

- **Ctrl+K** opens Spotlight (configurable: Ctrl+Shift+K, Ctrl+Space)
- Empty box shows **Jump Back In** (your most-used recent channels) and **Mentions**
- Fuzzy matching: accent/case-insensitive, acronyms (`ot` → `#off-topic`), multi-word (`gen tavern` → `#general` in *Tavern*)
- Ranking by frecency (visits + messages you send, stored locally), mentions, mute state
- Filters: `#` channels · `@` people · `*` servers · `>` commands
- **Tab** scopes search to a server, **Shift+Enter** marks as read

## Install (userplugin)

Requires a [Vencord dev setup](https://docs.vencord.dev/installing/).

```sh
git clone <this repo> vencord-spotlight
# link it into Vencord (Windows, no admin needed):
mklink /J Vencord\src\userplugins\spotlight vencord-spotlight
mklink /J vencord-spotlight\node_modules Vencord\node_modules
cd Vencord && pnpm build
```

`tsconfig.json` assumes this repo sits at `Documents/Dev/vencord-spotlight` next to `~/Vencord`; adjust the `extends` path otherwise.
Then restart Discord and enable **Spotlight** in Vencord's plugin settings.
