# YouTube Dashboard

A live, client-side YouTube channel dashboard. Shows channel stats (subscribers, views, video count, total likes) and a searchable, sortable grid of all videos with view/like/comment counts.

## How it works

- Static site (GitHub Pages) — no backend, no snapshot.
- The browser calls the **YouTube Data API v3** directly using a read-only API key, so data is always live.

## Tech

- Pure HTML / CSS / vanilla JavaScript (no build step, no dependencies).
- YouTube Data API v3 (`channels.list`, `playlistItems.list`, `videos.list`).

## Configuration

Edit the constants at the top of `app.js`:

```js
var API_KEY = "...";            // YouTube Data API key
var CHANNEL_ID = "...";          // channel id (UC...)
var UPLOADS_PLAYLIST = "...";    // uploads playlist id (UU...)
```

> Tip: restrict the API key to the YouTube Data API and (optionally) your GitHub Pages domain.
