# LBA Arrivals & Departures

Simple web app for Leeds Bradford Airport arrivals and departures over the next 3 days, with a Jet2-only filter.

## Run

```bash
npm start
```

Then open `http://127.0.0.1:3000`.

## Notes

- The app fetches public schedule pages from `flight.info` on the server side.
- Data is grouped into arrivals and departures for today plus the next two days.
- The frontend is plain HTML, CSS, and JavaScript, so there is no build step.
