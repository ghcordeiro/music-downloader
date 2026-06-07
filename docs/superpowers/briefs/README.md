# Briefs

This folder contains **pre-spec exploration documents** — short strategic overviews of potential features that have not yet been through full brainstorming. Briefs help decide which problems are worth investing design time in.

A brief is not ready for implementation. The flow is:

```
brief  →  brainstorming (full spec)  →  writing-plans (implementation plan)  →  execute
  ↑
  (you are here)
```

If you are an engineer or agent reading a brief and tempted to start coding: stop. The brief is missing too much — error handling, exact interfaces, test design, file paths, edge cases — because those details emerge from the brainstorming conversation. Promote the brief to a full spec first.

## Current briefs

| File | Problem | Effort | Risk |
|------|---------|--------|------|
| `2026-06-06-strict-320-mode-brief.md` | Stop falling back to YouTube when Spotify-direct fails; preserve "always 320" DJ rule | 1-2h | Low |
| `2026-06-06-byo-spotify-app-brief.md` | Scale past Spotify's 25-user-per-app limit by having each friend bring their own Client ID | 1-2 weekends | Medium |
| `2026-06-06-dj-feeds-brief.md` | Add a "Lançamentos" tab fed by DJ-focused download sites; **needs private fork** | 2-3 weekends | High (legal + technical) |

## When to write a brief vs. a spec

- **Brief**: when you want strategic clarity before investing in a full design conversation, or when you want to compare multiple possible features side by side before picking.
- **Spec** (via `brainstorming` skill): when you've decided to build the thing.

Briefs become specs by being passed as input to a brainstorming session — most of the structure is reusable.
