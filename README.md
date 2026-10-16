# ASTRAL website

Public website for ASTRAL, a project developing biological-misuse detection for AI transcripts.

The website is in `docs/`. It uses HTML, CSS, and JavaScript and has no build step or package dependencies. Serve `docs/` with any static web server to preview it locally.

## Publishing

GitHub Pages publishes from the `main` branch and `/docs` folder. Updates added to that branch are published automatically. The custom domain is `astral.detection.bio`; keep `docs/CNAME` and `docs/.nojekyll`.

The site is edited in the private `astral-website` repository, whose `out/` folder holds the release. Copy `out/` here to publish it; do not edit `docs/` by hand. Keep the download, citations, and webpage consistent. Check desktop and phone layouts after visual changes.

## Public content only

This repository contains the public website, not the scanner implementation. Do not add datasets, benchmark questions, transcripts, scoring rubrics, model prompts, private notes, credentials, or unpublished research. Public research citations do not include the underlying benchmark content.

The one exception is `docs/demo/`, the scanner demo, which the owner approved for public release on October 16, 2026. It replays saved results for 30 preloaded conversations: 20 are shown in full, and 10 are fully redacted, with their text removed before the data was saved. `astral-website`'s `scripts/add-demo.py` builds it from the private `astral-scanner-demo` repository after that repository's checks pass. Do not edit or add to it by hand.

Do not copy another repository's Git history into this repository. Review images and PDFs for embedded metadata and attachments before adding them.
