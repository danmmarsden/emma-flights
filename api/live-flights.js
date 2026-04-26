const AIRPORT_CODE = "LBA";
const AERODATABOX_BASE_URL = "https://aerodatabox.p.rapidapi.com";
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function getTodayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function getDateStringInZone(date, timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function extractTime(dateTimeString) {
  const match = String(dateTimeString || "").match(/T(\d{2}:\d{2})/);
  return match ? match[1] : "";
}

function getBestMovementTime(movement) {
  return movement?.revisedTime?.local || movement?.scheduledTime?.local || movement?.runwayTime?.local || "";
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
  const airport = movement?.airport;
  const airportCode = airport?.iata || airport?.icao || "";
  const airportName = normalizeAirportName(airport);
  const route = airportCode ? `${airportName} (${airportCode})` : airportName;
  const airline = flight.airline?.name || "Unknown airline";
  const flightNumber = flight.airline?.iata ? `${flight.airline.iata}${flight.number}` : flight.number;

  return {
    type,
    date: selectedDate,
    time: extractTime(timeSource) || "--:--",
    airline,
    flightNumber,
    airportName,
    airportCode,
    route,
    isJet2: /jet2/i.test(airline),
    sourceUrl: null,
    status: flight.status || "Unknown",
    isLive: true,
    scheduledTime: primaryMovement?.scheduledTime?.local || "",
    revisedTime: primaryMovement?.revisedTime?.local || "",
    runwayTime: primaryMovement?.runwayTime?.local || "",
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
  const windows = [
    [`${selectedDate}T00:00`, `${selectedDate}T11:59`],
    [`${selectedDate}T12:00`, `${selectedDate}T23:59`]
  ];

  const responses = await Promise.all(windows.map(([fromLocal, toLocal]) => fetchAirportWindow(fromLocal, toLocal, apiKey)));
  const departures = [];
  const arrivals = [];

  for (const payload of responses) {
    departures.push(...(payload.departures || []));
    arrivals.push(...(payload.arrivals || []));
  }

  const normalizedFlights = [
    ...departures.map((flight) => normalizeFlight(flight, "departures", selectedDate)),
    ...arrivals.map((flight) => normalizeFlight(flight, "arrivals", selectedDate))
  ];

  return normalizedFlights
    .filter((flight) => flight.route)
    .sort((left, right) => `${left.time} ${left.type}`.localeCompare(`${right.time} ${right.type}`));
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.AERODATABOX_RAPIDAPI_KEY;
  if (!apiKey) {
    sendJson(res, 500, { error: "Missing AERODATABOX_RAPIDAPI_KEY" });
    return;
  }

  const requestedDate = typeof req.query?.date === "string" ? req.query.date : getTodayDateString();
  const today = getTodayDateString();

  if (requestedDate !== today) {
    sendJson(res, 400, { error: `Live feed is only enabled for today (${today}) right now.` });
    return;
  }

  try {
    const flights = await getLiveFlightsForDate(requestedDate, apiKey);
    sendJson(res, 200, {
      airport: {
        code: AIRPORT_CODE,
        timeZone: "Europe/London"
      },
      date: requestedDate,
      generatedAt: new Date().toISOString(),
      source: {
        name: "AeroDataBox",
        baseUrl: "https://aerodatabox.com/"
      },
      flights
    });
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
};
