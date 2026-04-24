const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { URL } = require("node:url");
const { promisify } = require("node:util");

const HOST = "127.0.0.1";
const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, "public");
const AIRPORT_CODE = "LBA";
const SOURCE_BASE = "https://www.flight.info";
const SOURCE_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; LBA-arrivals-departures/1.0)",
  accept: "text/html,application/xhtml+xml"
};
const execFileAsync = promisify(execFile);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";

  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    res.writeHead(200, { "content-type": contentType });
    res.end(data);
  });
}

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

function formatDateParts(dateParts) {
  return `${String(dateParts.year).padStart(4, "0")}-${String(dateParts.month).padStart(2, "0")}-${String(dateParts.day).padStart(2, "0")}`;
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

function getNextThreeDates(timeZone = "Europe/London") {
  const today = getDatePartsInZone(new Date(), timeZone);
  return [today, addDays(today, 1), addDays(today, 2)].map(formatDateParts);
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

async function fetchFlightsForDate(type, date) {
  const sourceUrl = getSourceUrl(type, date);
  const headerArgs = Object.entries(SOURCE_HEADERS).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
  const { stdout } = await execFileAsync("curl", ["-L", "--silent", "--show-error", ...headerArgs, sourceUrl], {
    maxBuffer: 1024 * 1024 * 8,
    timeout: 30000
  });

  const html = stdout;
  return parseFlights(html, type, date, sourceUrl);
}

async function buildFlightsPayload() {
  const dates = getNextThreeDates();
  const jobs = [];

  for (const date of dates) {
    jobs.push(fetchFlightsForDate("departures", date));
    jobs.push(fetchFlightsForDate("arrivals", date));
  }

  const results = await Promise.all(jobs);
  const flights = results.flat().sort((a, b) => {
    const left = `${a.date} ${a.time} ${a.type}`;
    const right = `${b.date} ${b.time} ${b.type}`;
    return left.localeCompare(right);
  });

  return {
    airport: {
      name: "Leeds Bradford Airport",
      code: AIRPORT_CODE,
      timeZone: "Europe/London"
    },
    range: {
      dates,
      days: 3
    },
    generatedAt: new Date().toISOString(),
    source: {
      name: "flight.info",
      baseUrl: SOURCE_BASE
    },
    flights
  };
}

function createServer() {
  return http.createServer(async (req, res) => {
    const requestUrl = new URL(req.url, `http://${req.headers.host}`);

    if (requestUrl.pathname === "/api/flights") {
      try {
        const payload = await buildFlightsPayload();
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 502, {
          error: "Could not load flight data right now.",
          details: error.message
        });
      }
      return;
    }

    let filePath = path.join(PUBLIC_DIR, requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname);
    filePath = path.normalize(filePath);

    if (!filePath.startsWith(PUBLIC_DIR)) {
      sendJson(res, 403, { error: "Forbidden" });
      return;
    }

    sendFile(res, filePath);
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`Server running at http://${HOST}:${PORT}`);
  });
}

module.exports = {
  buildFlightsPayload,
  createServer
};
