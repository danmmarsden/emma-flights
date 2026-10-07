const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const AIRPORT_CODE = "LBA";
const AIRPORT_NAME = "Leeds Bradford Airport";
const AIRPORT_ICAO_CODE = "EGNM";
const AIRPORT_LATITUDE = 53.865898;
const AIRPORT_LONGITUDE = -1.66057;
const SOURCE_BASE = "https://www.flight.info";
const OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "flights.json");
const FLIGHTS_BY_DATE_OUTPUT_DIR = path.join(__dirname, "..", "public", "data", "flights");
const AIRPORTS_OUTPUT_PATH = path.join(__dirname, "..", "public", "data", "airports.json");
const OURAIRPORTS_BASE = "https://davidmegginson.github.io/ourairports-data";
const MAX_DAYS_AHEAD = 46;
const EMPTY_DAY_STOP_THRESHOLD = 3;
const SOURCE_HEADERS = {
  "user-agent": "Mozilla/5.0 (compatible; LBA-arrivals-departures/1.0)",
  accept: "text/html,application/xhtml+xml"
};
const flightScheduleLoadsByNumber = new Map();

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

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      row.push(value);
      if (row.some((cell) => cell !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  if (value || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}

function rowsToObjects(rows) {
  const [headers, ...records] = rows;
  return records.map((record) => {
    return Object.fromEntries(headers.map((header, index) => [header, record[index] || ""]));
  });
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

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toRadians(degrees) {
  return degrees * Math.PI / 180;
}

function calculateDistanceMiles(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  if (
    !Number.isFinite(fromLatitude) ||
    !Number.isFinite(fromLongitude) ||
    !Number.isFinite(toLatitude) ||
    !Number.isFinite(toLongitude)
  ) {
    return null;
  }

  const earthRadiusMiles = 3958.8;
  const lat1 = toRadians(fromLatitude);
  const lat2 = toRadians(toLatitude);
  const deltaLatitude = toRadians(toLatitude - fromLatitude);
  const deltaLongitude = toRadians(toLongitude - fromLongitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLongitude / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(earthRadiusMiles * c);
}

function createAirportLookup(airports, countries) {
  const countryByCode = new Map(countries.map((country) => [country.code, country.name]));
  const byIataCode = new Map();

  airports.forEach((airport) => {
    if (!airport.iata_code) {
      return;
    }

    byIataCode.set(airport.iata_code, {
      ident: airport.ident,
      type: airport.type,
      name: airport.name,
      latitude: toNumber(airport.latitude_deg),
      longitude: toNumber(airport.longitude_deg),
      elevationFt: toNumber(airport.elevation_ft),
      continent: airport.continent,
      countryCode: airport.iso_country,
      countryName: countryByCode.get(airport.iso_country) || airport.iso_country,
      regionCode: airport.iso_region,
      municipality: airport.municipality,
      scheduledService: airport.scheduled_service === "yes",
      icaoCode: airport.icao_code,
      iataCode: airport.iata_code,
      homeLink: airport.home_link,
      wikipediaLink: airport.wikipedia_link,
      distanceMiles: calculateDistanceMiles(
        AIRPORT_LATITUDE,
        AIRPORT_LONGITUDE,
        toNumber(airport.latitude_deg),
        toNumber(airport.longitude_deg)
      )
    });
  });

  return byIataCode;
}

function enrichFlight(flight, airportsByIataCode) {
  const airport = airportsByIataCode.get(flight.airportCode);
  if (!airport) {
    return flight;
  }

  return {
    ...flight,
    airportFullName: airport.name,
    airportCountryCode: airport.countryCode,
    airportCountryName: airport.countryName,
    airportMunicipality: airport.municipality,
    airportIcaoCode: airport.icaoCode,
    airportLatitude: airport.latitude,
    airportLongitude: airport.longitude,
    routeDistanceMiles: airport.distanceMiles
  };
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

function getFlightDetailUrl(flightNumber) {
  return `${SOURCE_BASE}/${encodeURIComponent(flightNumber)}`;
}

function getScheduleItemBlocks(html) {
  const blocks = [];
  let searchIndex = 0;

  while (searchIndex < html.length) {
    const startIndex = html.indexOf('<div class="schedule-item"', searchIndex);
    if (startIndex === -1) {
      break;
    }

    const endIndex = html.indexOf('<div id="a', startIndex + 1);
    if (endIndex === -1) {
      break;
    }

    blocks.push(html.slice(startIndex, endIndex));
    searchIndex = endIndex;
  }

  return blocks;
}

function extractScheduleSection(block, className, nextClassName) {
  const startMarker = `<div class="${className}">`;
  const startIndex = block.indexOf(startMarker);
  if (startIndex === -1) {
    return "";
  }

  const contentStart = startIndex + startMarker.length;
  const endIndex = nextClassName ? block.indexOf(`<div class="${nextClassName}">`, contentStart) : -1;
  return block.slice(contentStart, endIndex === -1 ? undefined : endIndex);
}

function extractFirstTextSoft(section) {
  const match = section.match(/<div class="text-soft">\s*([^<]+?)\s*<\/div>/);
  return match ? cleanText(match[1]) : "";
}

function getActiveWeekdays(block) {
  return [...block.matchAll(/<div class=['"]weekday active\s*['"]>([^<]+)<\/div>/g)]
    .map((match) => cleanText(match[1]).slice(0, 3).toLowerCase());
}

function getWeekdayKey(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    timeZone: "Europe/London"
  }).format(new Date(`${dateString}T12:00:00Z`)).slice(0, 3).toLowerCase();
}

function scheduleMatchesDate(block, dateString) {
  const activeWeekdays = getActiveWeekdays(block);
  if (activeWeekdays.length && !activeWeekdays.includes(getWeekdayKey(dateString))) {
    return false;
  }

  const dateMatches = [...block.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map((match) => match[0]);
  const [firstDate, secondDate] = dateMatches;
  const begins = dateMatches.length > 1 ? firstDate : "";
  const validTo = dateMatches.length > 1 ? secondDate : firstDate;

  return (!begins || dateString >= begins) && (!validTo || dateString <= validTo);
}

function parseArrivalTimeFromFlightDetail(html, dateString) {
  for (const block of getScheduleItemBlocks(html)) {
    const firstSection = extractScheduleSection(block, "first", "second");
    const secondSection = extractScheduleSection(block, "second", "third");

    if (!/\bLeeds\s*\(LBA\)/i.test(cleanText(secondSection)) || !scheduleMatchesDate(block, dateString)) {
      continue;
    }

    const arrivalTime = extractFirstTextSoft(secondSection);
    if (/^\d{2}:\d{2}$/.test(arrivalTime)) {
      return arrivalTime;
    }

    const departureTime = extractFirstTextSoft(firstSection);
    if (/^\d{2}:\d{2}$/.test(departureTime)) {
      return departureTime;
    }
  }

  return "";
}

async function fetchFlightScheduleHtml(flightNumber) {
  if (!flightScheduleLoadsByNumber.has(flightNumber)) {
    flightScheduleLoadsByNumber.set(flightNumber, fetchHtml(getFlightDetailUrl(flightNumber)).catch(() => ""));
  }

  return flightScheduleLoadsByNumber.get(flightNumber);
}

async function correctArrivalTimes(flights, date) {
  return Promise.all(flights.map(async (flight) => {
    const html = await fetchFlightScheduleHtml(flight.flightNumber);
    const arrivalTime = parseArrivalTimeFromFlightDetail(html, date);

    return arrivalTime
      ? {
          ...flight,
          time: arrivalTime,
          scheduledTime: `${date}T${arrivalTime}:00`
        }
      : flight;
  }));
}

async function fetchHtml(url) {
  const headerArgs = Object.entries(SOURCE_HEADERS).flatMap(([key, value]) => ["-H", `${key}: ${value}`]);
  const { stdout } = await execFileAsync("curl", ["-L", "--silent", "--show-error", ...headerArgs, url], {
    maxBuffer: 1024 * 1024 * 32,
    timeout: 120000
  });

  return stdout;
}

async function fetchFlightsForDate(type, date) {
  const sourceUrl = getSourceUrl(type, date);
  const html = await fetchHtml(sourceUrl);
  const flights = parseFlights(html, type, date, sourceUrl);
  return type === "arrivals" ? correctArrivalTimes(flights, date) : flights;
}

async function fetchOurAirportsDataset(fileName) {
  const csv = await fetchHtml(`${OURAIRPORTS_BASE}/${fileName}`);
  return rowsToObjects(parseCsv(csv));
}

async function generateDataset() {
  const dates = [];
  const flights = [];
  let emptyStreak = 0;
  const today = getDatePartsInZone(new Date(), "Europe/London");
  const [airports, countries] = await Promise.all([
    fetchOurAirportsDataset("airports.csv"),
    fetchOurAirportsDataset("countries.csv")
  ]);
  const airportsByIataCode = createAirportLookup(airports, countries);

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
    flights.push(
      ...departures.map((flight) => enrichFlight(flight, airportsByIataCode)),
      ...arrivals.map((flight) => enrichFlight(flight, airportsByIataCode))
    );
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
      icaoCode: AIRPORT_ICAO_CODE,
      latitude: AIRPORT_LATITUDE,
      longitude: AIRPORT_LONGITUDE,
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
    flights,
    airports: Object.fromEntries(
      [...new Set([AIRPORT_CODE, ...flights.map((flight) => flight.airportCode).filter(Boolean)])]
        .sort()
        .map((code) => {
          if (code === AIRPORT_CODE) {
            return [code, {
              ident: AIRPORT_ICAO_CODE,
              type: "large_airport",
              name: AIRPORT_NAME,
              latitude: AIRPORT_LATITUDE,
              longitude: AIRPORT_LONGITUDE,
              elevationFt: 681,
              continent: "EU",
              countryCode: "GB",
              countryName: "United Kingdom",
              regionCode: "GB-ENG",
              municipality: "Leeds, West Yorkshire",
              scheduledService: true,
              icaoCode: AIRPORT_ICAO_CODE,
              iataCode: AIRPORT_CODE,
              homeLink: "http://www.lbia.co.uk/",
              wikipediaLink: "https://en.wikipedia.org/wiki/Leeds_Bradford_International_Airport",
              distanceMiles: 0
            }];
          }

          return [code, airportsByIataCode.get(code)];
        })
        .filter(([, airport]) => airport)
    )
  };
}

async function main() {
  const payload = await generateDataset();
  if (!payload.dates.length || !payload.flights.length) {
    throw new Error("Generated dataset is empty; keeping existing schedule files instead of overwriting them.");
  }

  const flightsByDate = new Map(payload.dates.map((date) => [date, []]));
  payload.flights.forEach((flight) => {
    if (!flightsByDate.has(flight.date)) {
      flightsByDate.set(flight.date, []);
    }
    flightsByDate.get(flight.date).push(flight);
  });
  const manifest = {
    ...payload,
    flights: undefined,
    flightsByDatePath: "./flights/{date}.json"
  };
  delete manifest.flights;

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.mkdir(FLIGHTS_BY_DATE_OUTPUT_DIR, { recursive: true });
  const expectedSplitFiles = new Set([...flightsByDate.keys()].map((date) => `${date}.json`));
  const existingSplitFiles = await fs.readdir(FLIGHTS_BY_DATE_OUTPUT_DIR).catch((error) => {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  });
  await Promise.all(existingSplitFiles
    .filter((fileName) => fileName.endsWith(".json") && !expectedSplitFiles.has(fileName))
    .map((fileName) => fs.unlink(path.join(FLIGHTS_BY_DATE_OUTPUT_DIR, fileName))));
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await Promise.all([...flightsByDate.entries()].map(([date, flights]) => {
    return fs.writeFile(path.join(FLIGHTS_BY_DATE_OUTPUT_DIR, `${date}.json`), `${JSON.stringify({
      date,
      generatedAt: payload.generatedAt,
      source: payload.source,
      flights
    }, null, 2)}\n`, "utf8");
  }));
  await fs.writeFile(AIRPORTS_OUTPUT_PATH, `${JSON.stringify({
    generatedAt: payload.generatedAt,
    source: {
      name: "OurAirports",
      baseUrl: "https://ourairports.com/data/"
    },
    airports: payload.airports
  }, null, 2)}\n`, "utf8");
  console.log(`Wrote ${payload.flights.length} flights across ${payload.dates.length} split day files to ${FLIGHTS_BY_DATE_OUTPUT_DIR}`);
  console.log(`Wrote flight manifest to ${OUTPUT_PATH}`);
  console.log(`Wrote ${Object.keys(payload.airports).length} airports to ${AIRPORTS_OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
