# LBA Arrivals & Departures

Static web app for Leeds Bradford Airport arrivals and departures, with day-by-day browsing and a Jet2-only filter.

## Local preview

```bash
npm start
```

Then open `http://127.0.0.1:3000`.

## Update the dataset

```bash
npm run generate:data
```

This writes `public/data/flights.json` by scraping the public `flight.info` schedule pages starting from today and moving forward until several empty days are found.

## GitHub Pages

The repo includes:

- a GitHub Actions workflow that regenerates `public/data/flights.json` every day
- a GitHub Pages workflow that deploys the static files from `public/`

Once GitHub Pages is enabled for the repository, the app can run directly from the Pages URL with no Node server.

## Live data feed

The app can optionally use a live feed for `today` while keeping the generated JSON for later dates.

This is implemented as:

- `public/` on GitHub Pages for the static frontend
- `api/live-flights.js` on Vercel as a small proxy to AeroDataBox

### Provider

The live endpoint uses the official AeroDataBox airport FIDS endpoint:

- `GET /flights/airports/{codeType}/{code}/{fromLocal}/{toLocal}`
- auth header: `x-magicapi-key`

### Vercel setup

1. Import this repository into Vercel
2. Add an environment variable named `AERODATABOX_API_KEY`
3. Deploy
4. Copy the deployed Vercel base URL

### Frontend config

Edit `public/config.js` and set:

```js
window.APP_CONFIG = {
  liveApiBaseUrl: "https://your-vercel-project.vercel.app"
};
```

Then push that change so GitHub Pages picks it up.

When configured:

- the selected `today` view will try the live endpoint first
- if live data fails, the app falls back to the scheduled static dataset
- future dates continue to use `public/data/flights.json`
