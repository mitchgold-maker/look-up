# Look Up

Nightly sky odds for State College, PA. A static page: `index.html` reads `data/reports.json`
(an array of nightly reports, newest first) and `data/places.json` (watching spots, keyed by place id).

To publish: push these files to a public repository, then Settings > Pages > Deploy from a branch > `main` / root.
To update: replace `data/reports.json`. A link like `#2026-10-06.stars` opens that night and event.
