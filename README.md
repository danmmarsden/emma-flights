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
