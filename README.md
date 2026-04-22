# MADA Tracker

Internal tool for the MADA PM / ForLongLife team to analyze TikTok Shop exports.

**Live site:** enable GitHub Pages on this repo, branch `main`, folder `/ (root)`.

## Features

- **Daily Performance** — upload a `Video-Performance-List_*.xlsx` export. Gives a sortable, searchable table with views, likes, V-to-L clicks, CTR, product clicks, orders, and GMV, plus totals and CSV export.
- **Affiliate Status** — upload a `Video_List_*.xlsx` + a `Nicknames.txt` file. The app matches every nickname against the list and shows who posted, the posted date(s), and every video link per creator. Duplicates are kept and flagged.

## Privacy

Everything runs in the browser. Files never leave your machine.

## Stack

Pure static site: HTML + CSS + JS + [SheetJS](https://github.com/SheetJS/sheetjs) (CDN). No build, no backend.
