# Look Up: read this first

This repo is the single source of truth for Look Up, Mitch's hobby sky-alert project for State College, PA. Any Claude session (Claude Code, Cowork or a normal chat) working on Look Up should start here and build on what is here. Do not start a parallel copy of the page, the data or the routine somewhere else.

## What lives where
- `index.html`: the whole site (GitHub Pages, https://mitchgold-maker.github.io/look-up/). It draws each night's sky animation, the rating, the conditions and the deep-dive sections from the data files.
- `data/reports.json`: daily reports, newest first. Written only by the scheduled task "Look Up morning".
- `data/sky.json`: star catalog (Yale Bright Star Catalog via d3-celestial, BSD-3-Clause), constellation lines, constellation label points and bright-star names.
- `data/places.json`: viewing spots near State College, keyed by place id.
- `email/`: header and compass images made for alert emails. Not used right now: Mitch's Gmail blocks web images, so the routine draws the email header with text and colour only. Kept in case that changes.

## The routine
- One scheduled task, "Look Up morning", runs daily at 5:54 AM ET. It gathers forecasts, writes today's entry in `data/reports.json`, pushes to main, and emails people on the mailing list whose criteria match.
- Any Look Up routine or one-off cloud job must have this repo attached as a source. Jobs that instead ask for repo access at run time sit waiting for Mitch to approve it, and one-off jobs without it cannot push at all.
- It may only change `data/reports.json`. Page changes are made deliberately in a session with Mitch, never by the daily run.
- Ideas and bugs it finds are asked about in its own run session ("Questions for Mitch"), never by email.
- Older Look Up routines may still be listed at claude.ai/code/routines but are disabled and retired (the 4:53 PM nightly task, "Look Up morning (OLD, replaced - needs approvals)", the Claude artifact page). Do not revive them.

## Mailing list and privacy
- Subscribers live in a private Google Sheet in Mitch's Drive. It is never copied into this repo.
- This repo is public. Never commit email addresses, names of people, tokens, Sheet ids, or anything from the mailing list.

## Conventions
- Readers see rating words, never percentage odds. Reports keep an internal `chance` number (1-97); the page and emails turn it into a word. Levels: 65+ best, 40-64, 20-39, below 20.
  - stars and meteor: Great, Good, Fair, Poor
  - aurora, snow, fog and frost: Likely, Possible, Unlikely, Very unlikely
  - sunset: Vivid, Colorful, Plain, Gray
  - moon and eclipse: Clear view, Good view, Partial view, Clouded out
  - iss: Great pass, Good pass, Low pass, Poor pass
  - comet: Great view, Good view, Faint, Too faint
- Event types: stars, aurora, meteor, moon, sunset, iss, snow, fog, frost, comet, eclipse (rainbow, halo and storm exist only in the sample gallery).
- The page opens on `featured` (the report's most notable event, chance x rarity). Built-in facts and links rotate by date; the routine adds fresh ones daily and never repeats the last 14 reports.
- Every number in a report must come from a source fetched that day. Only https links.

## How the sky is drawn
- Real positions, artistic look. Night scenes place stars, planets, the Moon and the Milky Way where they really are for State College at that scene's hour (stars 9 PM, aurora 11 PM, meteors 1 AM, frost 6 AM and so on), facing the report's `look.bearing`. Sunset and sunrise use the real time and compass point.
- The painting (twinkle, glow, ground silhouettes, the four natural styles) stays artistic. Keep colours natural; the false-colour styles were removed on purpose.
- Visitors can drag the picture to look around; constellation lines and names toggle with the Constellations button.
- Motion respects `prefers-reduced-motion`. Animation loops must survive a hidden or zero-size page (they catch errors and never size a canvas to 0).

## Before you change anything
1. Read this file, then `index.html` and the newest entry in `data/reports.json`.
2. Check git log for recent work so you build on it, and pull first: more than one session pushes here.
3. Keep the page's existing style. Test on a phone-width screen too.
