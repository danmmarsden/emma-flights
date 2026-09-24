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

This writes `public/data/flights.json` by scraping the public `flight.info` schedule pages starting from today and moving forward until several empty days are found. It also writes a trimmed `public/data/airports.json` lookup from OurAirports so the app can show destination/origin country, airport metadata, and distance from LBA without a runtime dependency on an external airport API.

`public/data/flights.json` is a lightweight manifest. Individual day schedules are written to `public/data/flights/YYYY-MM-DD.json` so the browser only downloads the dates it needs.

## Static hosting

The app is served from the `public/` directory and can run on GitHub Pages or another static host with no Node server. Regenerate `public/data/flights.json` before deploying whenever the schedule needs refreshing.

## Live data feed

The app can optionally use a live feed for `today` while keeping the generated JSON for later dates.

This is implemented as:

- `public/` on GitHub Pages for the static frontend
- `api/live-flights.js` on Vercel as a small proxy to the Leeds Bradford Airport live board

### Provider

The live endpoint uses the Leeds Bradford Airport arrivals and departures board as the primary source. AeroDataBox through RapidAPI can still be configured as a fallback:

- `GET /flights/airports/{codeType}/{code}/{fromLocal}/{toLocal}`
- auth headers: `X-RapidAPI-Key` and `X-RapidAPI-Host`

### Vercel setup

1. Import this repository into Vercel
2. Optionally add an environment variable named `AERODATABOX_RAPIDAPI_KEY` for fallback live data
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
- completed flights are hidden by default after a 30-minute grace period, with a UI toggle to show them again

Roster selections and calendar statuses are stored in the browser on the current device.
