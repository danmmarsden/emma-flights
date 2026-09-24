const AIRPORT_CODE = "LBA";
const AERODATABOX_BASE_URL = "https://aerodatabox.p.rapidapi.com";
const LBA_BASE_URL = "https://www.leedsbradfordairport.co.uk";
const COMPLETED_FLIGHT_GRACE_MINUTES = 30;
const LIVE_WINDOW_LIMIT_MINUTES = 12 * 60;
const LIVE_CACHE_TTL_MS = 60 * 1000;
const LIVE_CACHE_STALE_MS = 5 * 60 * 1000;
const LBA_ACTION_FALLBACKS = {
  arrivals: "c8bc44f9ed7b6bc4e8dee86b37c5559c5f013247",
  departures: "be88851dd7690048df46996c09ae47bbb9586bdb"
};
const LBA_ACTION_BODY = {
  arrivals: "[3,3]",
  departures: "[5,3]"
};
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};
const liveCacheByDate = new Map();
const liveRequestsByDate = new Map();

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function setCacheHeaders(res, mode = "dynamic") {
  if (mode === "success") {
    res.setHeader("cache-control", "public, max-age=60, s-maxage=60, stale-while-revalidate=300");
    return;
  }

  if (mode === "rate-limit") {
    res.setHeader("cache-control", "public, max-age=120, s-maxage=120, stale-while-revalidate=240");
    return;
  }

  res.setHeader("cache-control", "no-store");
}

function getCachedLivePayload(dateString) {
  const cached = liveCacheByDate.get(dateString);
  if (!cached) {
    return null;
  }

  const ageMs = Date.now() - cached.cachedAt;
  return ageMs <= LIVE_CACHE_TTL_MS ? cached.payload : null;
}

function getStaleLivePayload(dateString) {
  const cached = liveCacheByDate.get(dateString);
  if (!cached) {
    return null;
  }

  const ageMs = Date.now() - cached.cachedAt;
  return ageMs <= LIVE_CACHE_STALE_MS ? cached.payload : null;
}

async function getCachedLiveFlightsForDate(selectedDate, apiKey) {
  const cached = getCachedLivePayload(selectedDate);
  if (cached) {
    return cached;
  }

  if (!liveRequestsByDate.has(selectedDate)) {
    liveRequestsByDate.set(selectedDate, getLiveFlightsForDate(selectedDate, apiKey)
      .then((flights) => {
        const payload = {
          airport: {
            code: AIRPORT_CODE,
            timeZone: "Europe/London"
          },
          date: selectedDate,
          generatedAt: new Date().toISOString(),
          source: {
            name: apiKey ? "Leeds Bradford Airport + AeroDataBox" : "Leeds Bradford Airport",
            baseUrl: "https://www.leedsbradfordairport.co.uk/flights/arrivals"
          },
          flights
        };
        liveCacheByDate.set(selectedDate, {
          cachedAt: Date.now(),
          payload
        });
        return payload;
      })
      .finally(() => {
        liveRequestsByDate.delete(selectedDate);
      }));
  }

  return liveRequestsByDate.get(selectedDate);
}

function getTodayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getLocalDateTimeString(date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function getLiveWindowForToday() {
  const fromDate = new Date(Date.now() - COMPLETED_FLIGHT_GRACE_MINUTES * 60 * 1000);
  const toDate = new Date(Date.now() + (LIVE_WINDOW_LIMIT_MINUTES - COMPLETED_FLIGHT_GRACE_MINUTES - 5) * 60 * 1000);

  return {
    fromLocal: getLocalDateTimeString(fromDate),
    toLocal: getLocalDateTimeString(toDate)
  };
}

function extractTime(dateTimeString) {
  const match = String(dateTimeString || "").match(/T(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function minutesBetween(startDateTime, endDateTime) {
  if (!startDateTime || !endDateTime) {
    return 0;
  }

  const diffMs = new Date(endDateTime).getTime() - new Date(startDateTime).getTime();
  if (!Number.isFinite(diffMs)) {
    return 0;
  }

  return Math.round(diffMs / 60000);
}

function isDifferentMinute(leftDateTime, rightDateTime) {
  if (!leftDateTime || !rightDateTime) {
    return false;
  }

  return extractTime(leftDateTime) !== extractTime(rightDateTime);
}

function getBestMovementTime(movement) {
  return movement?.scheduledTime?.local || movement?.revisedTime?.local || movement?.runwayTime?.local || "";
}

function normalizeAirportName(airport) {
  if (!airport) {
    return "";
  }

  return airport.shortName || airport.municipalityName || airport.name || "";
}

function normalizeFlight(flight, type, selectedDate) {
  const movement = flight.movement || (type === "departures" ? flight.arrival : flight.departure);
  const primaryMovement = type === "departures" ? flight.departure || movement : flight.arrival || movement;
  const timeSource = getBestMovementTime(primaryMovement);
  const date = String(timeSource || "").slice(0, 10) || selectedDate;
  const airport = movement?.airport;
  const airportCode = airport?.iata || airport?.icao || "";
  const airportName = normalizeAirportName(airport);
  const route = airportCode ? `${airportName} (${airportCode})` : airportName;
  const airline = flight.airline?.name || "Unknown airline";
  const flightNumber = flight.airline?.iata ? `${flight.airline.iata}${flight.number}` : flight.number;
  const scheduledTime = primaryMovement?.scheduledTime?.local || "";
  const revisedTime = primaryMovement?.revisedTime?.local || "";
  const actualTime = primaryMovement?.runwayTime?.local || "";
  const status = flight.status || "Unknown";
  const delayMinutes = minutesBetween(scheduledTime, revisedTime);
  const isCancelled = /cancel/i.test(status);
  const isDelayed = !isCancelled && delayMinutes >= 5;

  return {
    type,
    date,
    time: extractTime(timeSource) || "--:--",
    airline,
    flightNumber,
    airportName,
    airportCode,
    route,
    isJet2: /jet2/i.test(airline),
    sourceUrl: null,
    status,
    isLive: true,
    scheduledTime,
    revisedTime,
    runwayTime: actualTime,
    actualTime,
    liveStatusText: status,
    hasExpectedUpdate: isDifferentMinute(scheduledTime, revisedTime),
    isCancelled,
    isDelayed,
    delayMinutes: isDelayed ? delayMinutes : 0,
    terminal: primaryMovement?.terminal || "",
    gate: primaryMovement?.gate || "",
    baggageBelt: primaryMovement?.baggageBelt || "",
    checkInDesk: primaryMovement?.checkInDesk || "",
    runway: primaryMovement?.runway || "",
    callSign: flight.callSign || "",
    aircraftRegistration: flight.aircraft?.reg || "",
    aircraftModel: flight.aircraft?.model || ""
  };
}

function getLbaRoute(type) {
  return `${LBA_BASE_URL}/flights/${type}`;
}

function getLbaRouterStateTree(type) {
  return encodeURIComponent(JSON.stringify([
    "",
    {
      children: [
        ["path", `flights/${type}`, "oc"],
        {
          children: ["__PAGE__", {}, `/flights/${type}`, "refresh"]
        }
      ]
    },
    null,
    null,
    true
  ]));
}

function extractLbaMetadata(html) {
  const deploymentId = html.match(/dpl_[A-Za-z0-9]+/)?.[0] || "";
  const actionIds = [...new Set(html.match(/[a-f0-9]{40}/g) || [])];

  return { deploymentId, actionIds };
}

function parseLbaRscFlights(text) {
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith("1:["));
  if (!line) {
    return [];
  }

  const payload = JSON.parse(line.slice(2));
  return Array.isArray(payload) ? payload : [];
}

async function fetchLbaBoard(type) {
  const url = getLbaRoute(type);
  const pageResponse = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 (compatible; LBA-arrivals-departures/1.0)",
      accept: "text/html,application/xhtml+xml"
    }
  });

  if (!pageResponse.ok) {
    throw new Error(`LBA page request failed (${pageResponse.status})`);
  }

  const html = await pageResponse.text();
  const { deploymentId, actionIds } = extractLbaMetadata(html);
  const candidates = [...new Set([...actionIds, LBA_ACTION_FALLBACKS[type]].filter(Boolean))];

  for (const actionId of candidates) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LBA-arrivals-departures/1.0)",
        accept: "text/x-component",
        "content-type": "text/plain;charset=UTF-8",
        "next-action": actionId,
        "next-router-state-tree": getLbaRouterStateTree(type),
        ...(deploymentId ? { "x-deployment-id": deploymentId } : {})
      },
      body: LBA_ACTION_BODY[type]
    });

    if (!response.ok) {
      continue;
    }

    const flights = parseLbaRscFlights(await response.text());
    if (flights.length) {
      return flights;
    }
  }

  return [];
}

function normalizeLbaFlight(flight, type, selectedDate) {
  const scheduledTime = flight.ScheduledDateTime || flight.SIBT || flight.SOBT || "";
  const revisedTime = flight.EstimatedDateTime || flight.AODBProbableDateTime || "";
  const actualTime = flight.ActualDateTime || flight.ALDT || flight.ATOT || "";
  const timeSource = scheduledTime || revisedTime || actualTime;
  const date = String(timeSource || "").slice(0, 10) || selectedDate;
  const airline = flight.AirlineDescFormatted || flight.AirlineDesc || "Unknown airline";
  const airlineCode = flight.AirlineIATA || "";
  const flightNumber = airlineCode ? `${airlineCode}${flight.FlightNumber}` : String(flight.FlightNumber || "");
  const airportName = flight.OriginDestAirportDescFormatted || flight.OriginDestAirportDesc || "";
  const airportCode = flight.OriginDestAirportIATA || flight.OriginDestAirportICAO || "";
  const status = flight.FlightStatusText || flight.FlightStatusDesc || "Unknown";
  const isCancelled = Boolean(flight.FlightIsCancelled) || /cancel/i.test(status);
  const delayMinutes = minutesBetween(scheduledTime, revisedTime);
  const isDelayed = !isCancelled && delayMinutes >= 5;

  return {
    type,
    date,
    time: extractTime(scheduledTime) || extractTime(timeSource) || "--:--",
    airline,
    flightNumber,
    airportName,
    airportCode,
    route: airportCode ? `${airportName} (${airportCode})` : airportName,
    isJet2: /jet2/i.test(airline),
    sourceUrl: getLbaRoute(type),
    status,
    isLive: true,
    liveSource: "Leeds Bradford Airport",
    liveStatusText: status,
    scheduledTime,
    revisedTime,
    runwayTime: actualTime,
    actualTime,
    hasExpectedUpdate: isDifferentMinute(scheduledTime, revisedTime),
    isCancelled,
    isDelayed,
    delayMinutes: isDelayed ? delayMinutes : 0,
    terminal: flight.TerminalCode || "",
    gate: flight.GateCode || "",
    baggageBelt: flight.CarouselCode || "",
    checkInDesk: [flight.CheckInFrom, flight.CheckInTo].filter(Boolean).join("-"),
    runway: flight.Runway || "",
    callSign: flight.CallSign || "",
    aircraftRegistration: flight.Registration || "",
    aircraftModel: flight.AircraftTypeDesc || flight.AircraftTypeICAO || ""
  };
}

function dedupeAndSortFlights(flights, selectedDate) {
  const byKey = new Map();

  flights
    .filter((flight) => flight.date === selectedDate)
    .filter((flight) => flight.route)
    .forEach((flight) => byKey.set(`${flight.type}|${flight.flightNumber}|${flight.airportCode || flight.route}`, flight));

  return [...byKey.values()]
    .sort((left, right) => `${left.time} ${left.type}`.localeCompare(`${right.time} ${right.type}`));
}

async function fetchAirportWindow(fromLocal, toLocal, apiKey) {
  const url = new URL(`${AERODATABOX_BASE_URL}/flights/airports/iata/${AIRPORT_CODE}/${fromLocal}/${toLocal}`);
  url.searchParams.set("withLeg", "true");
  url.searchParams.set("withCancelled", "true");
  url.searchParams.set("withCodeshared", "false");
  url.searchParams.set("withCargo", "false");
  url.searchParams.set("withPrivate", "false");

  const response = await fetch(url, {
    headers: {
      "X-RapidAPI-Key": apiKey,
      "X-RapidAPI-Host": "aerodatabox.p.rapidapi.com",
      accept: "application/json"
    }
  });

  if (response.status === 204) {
    return { departures: [], arrivals: [] };
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AeroDataBox request failed (${response.status}): ${text.slice(0, 200)}`);
  }

  return response.json();
}

async function getLiveFlightsForDate(selectedDate, apiKey) {
  const { fromLocal, toLocal } = getLiveWindowForToday();
  const [aeroResult, lbaDeparturesResult, lbaArrivalsResult] = await Promise.allSettled([
    apiKey ? fetchAirportWindow(fromLocal, toLocal, apiKey) : Promise.resolve({ departures: [], arrivals: [] }),
    fetchLbaBoard("departures"),
    fetchLbaBoard("arrivals")
  ]);
  const payload = aeroResult.status === "fulfilled" ? aeroResult.value : { departures: [], arrivals: [] };
  const departures = payload.departures || [];
  const arrivals = payload.arrivals || [];
  const lbaDepartures = lbaDeparturesResult.status === "fulfilled" ? lbaDeparturesResult.value : [];
  const lbaArrivals = lbaArrivalsResult.status === "fulfilled" ? lbaArrivalsResult.value : [];
  const lbaFlights = dedupeAndSortFlights([
    ...lbaDepartures.map((flight) => normalizeLbaFlight(flight, "departures", selectedDate)),
    ...lbaArrivals.map((flight) => normalizeLbaFlight(flight, "arrivals", selectedDate))
  ], selectedDate);

  if (lbaFlights.length) {
    return lbaFlights;
  }

  const normalizedFlights = [
    ...departures.map((flight) => normalizeFlight(flight, "departures", selectedDate)),
    ...arrivals.map((flight) => normalizeFlight(flight, "arrivals", selectedDate))
  ];

  return dedupeAndSortFlights(normalizedFlights, selectedDate);
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    setCacheHeaders(res, "dynamic");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.AERODATABOX_RAPIDAPI_KEY;

  const requestedDate = typeof req.query?.date === "string" ? req.query.date : getTodayDateString();
  const today = getTodayDateString();

  if (requestedDate !== today) {
    sendJson(res, 400, { error: `Live feed is only enabled for today (${today}) right now.` });
    return;
  }

  try {
    const payload = await getCachedLiveFlightsForDate(requestedDate, apiKey);
    setCacheHeaders(res, "success");
    sendJson(res, 200, payload);
  } catch (error) {
    const stalePayload = getStaleLivePayload(requestedDate);
    if (stalePayload) {
      setCacheHeaders(res, "rate-limit");
      sendJson(res, 200, {
        ...stalePayload,
        message: "Live refresh failed, showing recently cached live data."
      });
      return;
    }

    if (String(error.message).includes("(429)")) {
      setCacheHeaders(res, "rate-limit");
    } else {
      setCacheHeaders(res, "dynamic");
    }
    sendJson(res, 502, { error: error.message });
  }
};
