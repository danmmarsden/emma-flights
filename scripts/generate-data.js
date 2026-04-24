const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const AIRPORT_CODE = "LBA";
const AIRPORT_NAME = "Leeds Bradford Airport";
const SOURCE_BASE = "https://www.flight.info";
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "flights.json");
const MAX_DAYS_AHEAD = 45;
const EMPTY_DAY_STOP_THRESHOLD = 3;
const SOURCE_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; LBA-arrivals-departures/1.0)",
  accept: "text/html,application/xhtml+xml"
};

function decodeHtml(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function cleanText(html) {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function getDatePartsInZone(date, timeZone) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day)
  };
}

function addDays(dateParts, days) {
  const utcDate = new Date(Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);

  return {
    year: utcDate.getUTCFullYear(),
    month: utcDate.getUTCMonth() + 1,
    day: utcDate.getUTCDate()
  };
}

function formatDateParts(dateParts) {
  return `${String(dateParts.year).padStart(4, "0")}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
}

function getSourceUrl(type, date) {
  return `${SOURCE_BASE}/${AIRPORT_CODE}/${type}/${date}/00:00`;
}

function parseFlights(html, type, date, sourceUrl) {
  const blockRegex = /<div class="departures">\s*<div class="deparr-row"[^>]*>(.*?)<\/div>\s*<div class="deparr-row"[^>]*>.*?<\/div>\s*<div class="deparr-row"[^>]*>(.*?)<\/div>\s*<div class="deparr-row"[^>]*>(.*?)<\/div>\s*<div class="deparr-row"[^>]*>.*?<a[^>]*>(.*?)<\/a>/gms;
  const flights = [];

  for (const match of html.matchAll(blockRegex)) {
    const time = cleanText(match[1]);
    const airline = cleanText(match[2]);
    const route = cleanText(match[3]);
    const flightNumber = cleanText(match[4]);

    if (!/^\d{2}:\d{2}$/.test(time) || airline === "Airline") {
      continue;
    }

    const airportMatch = route.match(/^(.*)\s+\(([A-Z0-9]{3})\)$/);
    flights.push({
      type,
      date,
      time,
      airline,
      flightNumber,
      airportName: airportMatch ? airportMatch[1] : route,
      airportCode: airportMatch ? airportMatch[2] : "",
      route,
      isJet2: /jet2/i.test(airline),
      sourceUrl
    });
  }

  return flights;
}

async function fetchHtml(url) {
  const headerArgs = Object.entries(SOURCE_HEADERS).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
  const { stdout } = await execFileAsync("curl", ["-L", "--silent", "--show-error", ...headerArgs, url], {
    maxBuffer: 1024 * 1024 * 8,
    timeout: 30000
  });

  return stdout;
}

async function fetchFlightsForDate(type, date) {
  const sourceUrl = getSourceUrl(type, date);
  const html = await fetchHtml(sourceUrl);
  return parseFlights(html, type, date, sourceUrl);
}

async function generateDataset() {
  const dates = [];
  const flights = [];
  let emptyStreak = 0;
  const today = getDatePartsInZone(new Date(), "Europe/London");

  for (let offset = 0; offset < MAX_DAYS_AHEAD; offset += 1) {
    const date = formatDateParts(addDays(today, offset));
    const [departures, arrivals] = await Promise.all([
      fetchFlightsForDate("departures", date),
      fetchFlightsForDate("arrivals", date)
    ]);
    const totalForDay = departures.length + arrivals.length;

    if (totalForDay === 0) {
      emptyStreak += 1;
      if (emptyStreak >= EMPTY_DAY_STOP_THRESHOLD) {
        break;
      }
      continue;
    }

    emptyStreak = 0;
    dates.push(date);
    flights.push(...departures, ...arrivals);
  }

  flights.sort((left, right) => {
    const leftKey = `${left.date} ${left.time} ${left.type}`;
    const rightKey = `${right.date} ${right.time} ${right.type}`;
    return leftKey.localeCompare(rightKey);
  });

  return {
    airport: {
      name: AIRPORT_NAME,
      code: AIRPORT_CODE,
      timeZone: "Europe/London"
    },
    generatedAt: new Date().toISOString(),
    source: {
      name: "flight.info",
      baseUrl: SOURCE_BASE
    },
    range: {
      firstDate: dates[0] || null,
      lastDate: dates[dates.length - 1] || null,
      totalDays: dates.length
    },
    dates,
    flights
  };
}

async function main() {
  const payload = await generateDataset();
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${payload.flights.length} flights across ${payload.dates.length} days to ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
