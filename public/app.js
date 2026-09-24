const state = {
  flights: [],
  airports: {},
  dates: [],
  generatedAt: "",
  staticGeneratedAt: "",
  jet2Only: false,
  showCompleted: false,
  activeView: "departures",
  airportCode: "LBA",
  sourceBaseUrl: "",
  staticSourceBaseUrl: "",
  selectedDateIndex: 0,
  selectedFlight: null,
  liveFlightsByDate: {},
  liveStatusByDate: {},
  liveGeneratedAtByDate: {},
  liveMessageByDate: {},
  liveSourceByDate: {},
  liveRefreshTimer: null,
  liveRefreshInFlight: false,
  rosterSelectMode: false,
  showingRoster: false,
  rosterView: "table",
  rosterCalendarMonth: "",
  rosterFlightKeys: []
};

const LIVE_REFRESH_INTERVAL_MS = 60 * 1000;
const ROSTER_STORAGE_KEY = "lba-flight-tracker-roster";

const jet2Toggle = document.getElementById("jet2Only");
const showCompletedToggle = document.getElementById("showCompleted");
const departuresToggle = document.getElementById("departuresToggle");
const arrivalsToggle = document.getElementById("arrivalsToggle");
const rosterSelectToggle = document.getElementById("rosterSelectToggle");
const myRosterToggle = document.getElementById("myRosterToggle");
const previousDayButton = document.getElementById("previousDayButton");
const nextDayButton = document.getElementById("nextDayButton");
const jumpTodayButton = document.getElementById("jumpTodayButton");
const results = document.getElementById("results");
const statusText = document.getElementById("statusText");
const sourceText = document.getElementById("sourceText");
const dayTemplate = document.getElementById("dayTemplate");
const rosterTemplate = document.getElementById("rosterTemplate");
const flightModal = document.getElementById("flightModal");
const closeFlightModalButton = document.getElementById("closeFlightModalButton");
const flightModalEyebrow = document.getElementById("flightModalEyebrow");
const flightModalTitle = document.getElementById("flightModalTitle");
const flightModalSubtitle = document.getElementById("flightModalSubtitle");
const flightModalGrid = document.getElementById("flightModalGrid");

function getDataUrl() {
  return new URL("./data/flights.json", window.location.href).toString();
}

function getAirportsUrl() {
  return new URL("./data/airports.json", window.location.href).toString();
}

function getLiveApiBaseUrl() {
  const configured = window.APP_CONFIG?.liveApiBaseUrl?.trim();
  return configured || "";
}

function getLiveApiUrl(dateString) {
  const baseUrl = getLiveApiBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const url = new URL("/api/live-flights", baseUrl);
  url.searchParams.set("date", dateString);
  return url.toString();
}

function formatFriendlyDate(dateString) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Europe/London"
  }).format(new Date(`${dateString}T12:00:00Z`));
}

function formatMonthLabel(monthKey) {
  return new Intl.DateTimeFormat("en-GB", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/London"
  }).format(new Date(`${monthKey}-01T12:00:00Z`));
}

function formatTimestamp(isoString) {
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/London"
  }).format(new Date(isoString));
}

function formatDateTime(dateTimeString) {
  if (!dateTimeString) {
    return "Not available";
  }

  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(dateTimeString));
}

function formatTime(dateTimeString) {
  if (!dateTimeString) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(dateTimeString));
}

function formatDistance(miles) {
  return Number.isFinite(miles) ? `${miles.toLocaleString("en-GB")} miles` : "Not available";
}

function getDateTimeFromFlightTime(flight) {
  if (flight.date && /^\d{2}:\d{2}$/.test(flight.time)) {
    return `${flight.date}T${flight.time}:00`;
  }

  return "";
}

function getMonthKey(dateString) {
  return String(dateString || "").slice(0, 7);
}

function getMonthDate(monthKey) {
  const [year, month] = String(monthKey || "").split("-").map(Number);
  return new Date(Number.isFinite(year) ? year : new Date().getFullYear(), Number.isFinite(month) ? month - 1 : new Date().getMonth(), 1, 12);
}

function shiftMonthKey(monthKey, offset) {
  const monthDate = getMonthDate(monthKey || getMonthKey(getTodayDateString()));
  monthDate.setMonth(monthDate.getMonth() + offset);
  return `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
}

function getScheduledDateTime(flight) {
  if (flight.scheduledTime) {
    return formatDateTime(flight.scheduledTime);
  }

  const fallbackDateTime = getDateTimeFromFlightTime(flight);
  if (fallbackDateTime) {
    return formatDateTime(fallbackDateTime);
  }

  return flight.time || "Not available";
}

function getActualDateTime(flight) {
  return flight.actualTime || flight.runwayTime || "";
}

function getActualLabel(flight) {
  return flight.type === "arrivals" ? "Actual arrival" : "Actual departure";
}

function isCancelledFlight(flight) {
  return Boolean(flight.isCancelled) || /cancel/i.test(String(flight.status || ""));
}

function getDelayMinutes(flight) {
  if (Number.isFinite(flight.delayMinutes) && flight.delayMinutes > 0) {
    return flight.delayMinutes;
  }

  if (!flight.scheduledTime || !flight.revisedTime) {
    return 0;
  }

  const delayMinutes = Math.round((new Date(flight.revisedTime).getTime() - new Date(flight.scheduledTime).getTime()) / 60000);
  return Number.isFinite(delayMinutes) && delayMinutes >= 5 ? delayMinutes : 0;
}

function hasExpectedUpdate(flight) {
  return Boolean(flight.hasExpectedUpdate) || (
    flight.scheduledTime &&
    flight.revisedTime &&
    formatTime(flight.scheduledTime) !== formatTime(flight.revisedTime)
  );
}

function isDelayedFlight(flight) {
  return Boolean(flight.isDelayed) || getDelayMinutes(flight) >= 5;
}

function getStatusBadge(flight) {
  if (isCancelledFlight(flight)) {
    return { label: "Cancelled", tone: "cancelled" };
  }

  if (isDelayedFlight(flight)) {
    return { label: "Delayed", tone: "delayed" };
  }

  if (getActualDateTime(flight)) {
    return { label: flight.type === "arrivals" ? "Arrived" : "Departed", tone: "completed" };
  }

  return null;
}

function getAirlineShortcode(flight) {
  const flightCode = String(flight.flightNumber || "").trim().toUpperCase();
  const flightCodePrefix = flightCode.match(/^[A-Z]{3}(?=\d)/)?.[0] || flightCode.match(/^[A-Z0-9]{2}(?=\d)/)?.[0];

  if (flightCodePrefix) {
    return flightCodePrefix;
  }

  return String(flight.airline || "")
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .slice(0, 4)
    .toUpperCase() || "N/A";
}

function getAirlineLogoPath(airline) {
  const normalizedAirline = String(airline || "").toLowerCase();

  if (normalizedAirline.includes("jet2")) {
    return "./assets/airlines/jet2.svg";
  }

  if (normalizedAirline.includes("ryanair")) {
    return "./assets/airlines/ryanair.svg";
  }

  if (normalizedAirline.includes("klm")) {
    return "./assets/airlines/klm.svg";
  }

  if (normalizedAirline.includes("easyjet")) {
    return "./assets/airlines/easyjet.svg";
  }

  if (normalizedAirline.includes("tui")) {
    return "./assets/airlines/tui.svg";
  }

  if (normalizedAirline.includes("aer lingus")) {
    return "./assets/airlines/aer-lingus.svg";
  }

  if (normalizedAirline.includes("wizz")) {
    return "./assets/airlines/wizz.svg";
  }

  if (normalizedAirline.includes("aurigny")) {
    return "./assets/airlines/aurigny.svg";
  }

  return "";
}

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getAirlineBadge(flight) {
  const airline = flight.airline || "Unknown airline";
  const logoPath = getAirlineLogoPath(airline);
  const safeAirline = escapeAttribute(airline);

  if (logoPath) {
    return `<img class="airline-logo" src="${logoPath}" alt="${safeAirline}" title="${safeAirline}" loading="lazy">`;
  }

  return `<span class="airline-badge" title="${safeAirline}">${getAirlineShortcode(flight)}</span>`;
}

function getVisibleFlights() {
  const selectedDate = state.dates[state.selectedDateIndex];
  const flightsForSelectedDate = getFlightsForDate(selectedDate);
  const filteredFlights = state.showCompleted
    ? flightsForSelectedDate
    : flightsForSelectedDate.filter((flight) => !shouldHideCompletedFlight(flight, selectedDate));

  return state.jet2Only
    ? filteredFlights.filter((flight) => flight.isJet2)
    : filteredFlights;
}

function getFlightKey(flight) {
  return `${flight.type}|${flight.flightNumber}|${flight.airportCode || flight.route}`;
}

function getRosterFlightKey(flight) {
  return `${flight.date}|${getFlightKey(flight)}`;
}

function loadRosterFlightKeys() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(ROSTER_STORAGE_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((key) => typeof key === "string") : [];
  } catch {
    return [];
  }
}

function saveRosterFlightKeys() {
  window.localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(state.rosterFlightKeys));
}

function isRosterFlight(flight) {
  return state.rosterFlightKeys.includes(getRosterFlightKey(flight));
}

function getFlightsForDate(dateString) {
  const liveFlights = state.liveFlightsByDate[dateString];
  const staticFlights = state.flights.filter((flight) => flight.date === dateString);

  return Array.isArray(liveFlights)
    ? mergeLiveFlights(staticFlights, liveFlights)
    : staticFlights;
}

function mergeFlightData(staticFlight, liveFlight) {
  return {
    ...staticFlight,
    ...liveFlight,
    airportFullName: staticFlight.airportFullName || liveFlight.airportFullName,
    airportCountryCode: staticFlight.airportCountryCode || liveFlight.airportCountryCode,
    airportCountryName: staticFlight.airportCountryName || liveFlight.airportCountryName,
    airportMunicipality: staticFlight.airportMunicipality || liveFlight.airportMunicipality,
    airportIcaoCode: staticFlight.airportIcaoCode || liveFlight.airportIcaoCode,
    airportLatitude: staticFlight.airportLatitude || liveFlight.airportLatitude,
    airportLongitude: staticFlight.airportLongitude || liveFlight.airportLongitude,
    routeDistanceMiles: staticFlight.routeDistanceMiles || liveFlight.routeDistanceMiles
  };
}

function mergeLiveFlights(staticFlights, liveFlights) {
  const liveByKey = new Map(liveFlights.map((flight) => [getFlightKey(flight), flight]));
  const mergedFlights = staticFlights.map((flight) => {
    const liveFlight = liveByKey.get(getFlightKey(flight));
    return liveFlight ? mergeFlightData(flight, liveFlight) : flight;
  });
  const staticKeys = new Set(staticFlights.map(getFlightKey));
  const liveOnlyFlights = liveFlights.filter((flight) => !staticKeys.has(getFlightKey(flight)));

  return [...mergedFlights, ...liveOnlyFlights].sort((left, right) => {
    return `${left.time} ${left.type}`.localeCompare(`${right.time} ${right.type}`);
  });
}

function getComparableFlightTime(flight) {
  const dateTime = flight.scheduledTime || getDateTimeFromFlightTime(flight) || flight.revisedTime || getActualDateTime(flight);
  const time = getDateTimeMs(dateTime);
  return Number.isFinite(time) ? time : 0;
}

function findExpectedReturnFlight(flight) {
  if (!flight.isJet2 || !flight.airportCode) {
    return null;
  }

  const oppositeType = flight.type === "departures" ? "arrivals" : "departures";
  const selectedTime = getComparableFlightTime(flight);
  const candidates = getFlightsForDate(flight.date)
    .filter((candidate) => candidate.isJet2)
    .filter((candidate) => candidate.type === oppositeType)
    .filter((candidate) => candidate.airportCode === flight.airportCode)
    .filter((candidate) => getRosterFlightKey(candidate) !== getRosterFlightKey(flight))
    .sort((left, right) => getComparableFlightTime(left) - getComparableFlightTime(right));

  return candidates.find((candidate) => getComparableFlightTime(candidate) >= selectedTime) || candidates[0] || null;
}

function getRosterSelectionFlights(flight) {
  return [flight, findExpectedReturnFlight(flight)].filter(Boolean);
}

function addRosterFlightKey(key, nextKeys) {
  if (!nextKeys.includes(key)) {
    nextKeys.push(key);
  }
}

function addRosterFlights(flight) {
  const nextKeys = [...state.rosterFlightKeys];
  getRosterSelectionFlights(flight).forEach((rosterFlight) => {
    addRosterFlightKey(getRosterFlightKey(rosterFlight), nextKeys);
  });
  state.rosterFlightKeys = nextKeys;
  saveRosterFlightKeys();
}

function removeRosterFlights(flight) {
  const keysToRemove = new Set(getRosterSelectionFlights(flight).map(getRosterFlightKey));
  state.rosterFlightKeys = state.rosterFlightKeys.filter((key) => !keysToRemove.has(key));
  saveRosterFlightKeys();
}

function toggleRosterFlight(flight) {
  if (isRosterFlight(flight)) {
    removeRosterFlights(flight);
  } else {
    addRosterFlights(flight);
  }

  render();
}

function isFlightMarkedCompleted(flight) {
  const normalizedStatus = String(flight.status || "").toLowerCase();
  return /airborn|arriv|land|depart/.test(normalizedStatus);
}

function getCompletionDateTime(flight) {
  const candidates = [
    getActualDateTime(flight),
    flight.revisedTime,
    flight.scheduledTime,
    getDateTimeFromFlightTime(flight)
  ]
    .map((dateTime) => ({ dateTime, time: getDateTimeMs(dateTime) }))
    .filter(({ time }) => Number.isFinite(time));

  if (!candidates.length) {
    return "";
  }

  return candidates.reduce((latest, candidate) => {
    return candidate.time > latest.time ? candidate : latest;
  }).dateTime;
}

function getDateTimeMs(dateTimeString) {
  if (!dateTimeString) {
    return NaN;
  }

  const normalizedDateTime = String(dateTimeString).replace(" ", "T");
  return new Date(normalizedDateTime).getTime();
}

function shouldHideCompletedFlight(flight, selectedDate) {
  const today = getTodayDateString();

  if (selectedDate > today) {
    return false;
  }

  if (selectedDate < today) {
    return true;
  }

  const completionDateTime = getCompletionDateTime(flight);
  if (!completionDateTime) {
    return false;
  }

  if (!isFlightMarkedCompleted(flight) && !getActualDateTime(flight) && !getDateTimeFromFlightTime(flight)) {
    return false;
  }

  const hideAfter = getDateTimeMs(completionDateTime) + 30 * 60 * 1000;
  return Date.now() >= hideAfter;
}

function getAirportForFlight(flight) {
  return flight.airport ||
    state.airports[flight.airportCode] ||
    (flight.airportFullName ? {
      name: flight.airportFullName,
      countryCode: flight.airportCountryCode,
      countryName: flight.airportCountryName,
      municipality: flight.airportMunicipality,
      icaoCode: flight.airportIcaoCode,
      iataCode: flight.airportCode,
      latitude: flight.airportLatitude,
      longitude: flight.airportLongitude,
      distanceMiles: flight.routeDistanceMiles
    } : null);
}

function hasExtraDetails(flight) {
  const airport = getAirportForFlight(flight);

  return Boolean(
    airport ||
    flight.sourceUrl ||
    flight.isLive && (
      flight.aircraftRegistration ||
      flight.aircraftModel ||
      flight.revisedTime ||
      flight.runwayTime ||
      flight.terminal ||
      flight.gate ||
      flight.checkInDesk ||
      flight.baggageBelt ||
      flight.runway ||
      flight.callSign ||
      flight.status
    )
  );
}

function createFlightRow(flight) {
  const row = document.createElement("tr");
  const detailsAvailable = hasExtraDetails(flight);
  const airport = getAirportForFlight(flight);
  const actualDateTime = getActualDateTime(flight);
  const actualTime = formatTime(actualDateTime);
  const revisedTime = formatTime(flight.revisedTime);
  const statusBadge = getStatusBadge(flight);
  const expectedStatusText = flight.liveStatusText && /^now due/i.test(flight.liveStatusText)
    ? flight.liveStatusText
    : revisedTime
      ? `Due ${revisedTime}`
      : "";
  const timeCell = actualTime
    ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta" data-mobile="${actualTime}">${flight.type === "arrivals" ? "Arrived" : "Departed"} ${actualTime}</span></span>`
    : isCancelledFlight(flight)
      ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta is-cancelled" data-mobile="CXL">Cancelled</span></span>`
      : isDelayedFlight(flight) && revisedTime
        ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta is-delayed" data-mobile="${revisedTime}">Delayed ${revisedTime}</span></span>`
      : hasExpectedUpdate(flight) && expectedStatusText
        ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta" data-mobile="${revisedTime || expectedStatusText}">${expectedStatusText}</span></span>`
    : `<span class="time-main">${flight.time}</span>`;
  const routeCode = flight.airportCode || airport?.iataCode || flight.route || "Not available";
  const routeName = flight.airportName || airport?.municipality || airport?.name || flight.route || "";
  const routeMeta = [
    routeName && routeName !== routeCode ? routeName : "",
    airport?.countryName || flight.airportCountryName,
    formatDistance(airport?.distanceMiles || flight.routeDistanceMiles)
  ].filter((value) => value && value !== "Not available").join(" • ");
  const routeCell = `<span class="route-wrap"><span class="route-main">${routeCode}</span>${routeMeta ? `<span class="route-meta">${routeMeta}</span>` : ""}</span>`;
  const statusCell = flight.liveStatusText || flight.status || "Not available";
  const infoItems = flight.type === "departures"
    ? [
        flight.gate ? `Gate ${flight.gate}` : "",
        flight.checkInDesk ? `Desk ${flight.checkInDesk}` : "",
        flight.terminal || ""
      ]
    : [
        flight.baggageBelt ? `Belt ${flight.baggageBelt}` : "",
        flight.terminal || "",
        flight.gate ? `Gate ${flight.gate}` : ""
      ];
  const infoCell = infoItems.filter(Boolean).join(" • ") || "Not available";
  const flightCell = detailsAvailable
    ? `<span class="flight-code-wrap"><span class="flight-code">${flight.flightNumber}</span><span class="details-icon" aria-hidden="true">✈</span>${statusBadge ? `<span class="status-badge is-${statusBadge.tone}">${statusBadge.label}</span>` : ""}</span>`
    : `<span class="flight-code">${flight.flightNumber}</span>${statusBadge ? `<span class="status-badge is-${statusBadge.tone}">${statusBadge.label}</span>` : ""}`;
  const rosterButton = state.rosterSelectMode && flight.isJet2
    ? `<button class="roster-action ${isRosterFlight(flight) ? "is-selected" : ""}" type="button" aria-label="${isRosterFlight(flight) ? "Remove" : "Add"} ${flight.flightNumber} ${isRosterFlight(flight) ? "from" : "to"} roster">${isRosterFlight(flight) ? "-" : "+"}</button>`
    : "";
  row.innerHTML = `
    <td data-label="Time">${timeCell}</td>
    <td data-label="Flight"><span class="flight-cell-content">${rosterButton}${flightCell}</span></td>
    <td data-label="Airline">${getAirlineBadge(flight)}</td>
    <td data-label="${flight.type === "departures" ? "To" : "From"}">${routeCell}</td>
    <td data-label="Status"><span class="desktop-detail">${statusCell}</span></td>
    <td data-label="Info"><span class="desktop-detail">${infoCell}</span></td>
  `;

  if (detailsAvailable) {
    row.classList.add("has-details");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `Open details for ${flight.flightNumber}`);
    row.addEventListener("click", () => openFlightModal(flight));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openFlightModal(flight);
      }
    });
  }

  const rosterAction = row.querySelector(".roster-action");
  if (rosterAction) {
    rosterAction.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRosterFlight(flight);
    });
  }

  return row;
}

function createDetailItem(label, value) {
  const item = document.createElement("div");
  item.className = "flight-detail-item";
  item.innerHTML = `<p class="flight-detail-label">${label}</p><p class="flight-detail-value">${value}</p>`;
  return item;
}

function createRosterRow(flight) {
  const row = createFlightRow(flight);
  const dateCell = document.createElement("td");
  dateCell.dataset.label = "Date";
  dateCell.innerHTML = `<span class="roster-date">${formatFriendlyDate(flight.date)}</span>`;
  row.insertBefore(dateCell, row.firstChild);
  return row;
}

function openFlightModal(flight) {
  if (!hasExtraDetails(flight)) {
    return;
  }

  state.selectedFlight = flight;
  renderFlightModal();
  flightModal.showModal();
}

function closeFlightModal() {
  state.selectedFlight = null;
  flightModal.close();
}

function renderFlightModal() {
  const flight = state.selectedFlight;
  if (!flight) {
    return;
  }

  const airport = getAirportForFlight(flight);
  const delayMinutes = getDelayMinutes(flight);
  const details = [
    ["Flight", flight.flightNumber],
    ["Airline", flight.airline],
    [flight.type === "departures" ? "Destination" : "Origin", flight.route],
    ["Status", flight.status || "Unknown"],
    ["Scheduled time", getScheduledDateTime(flight)],
    ["Revised time", formatDateTime(flight.revisedTime)],
    ["Expected update", hasExpectedUpdate(flight) ? (flight.liveStatusText || formatDateTime(flight.revisedTime)) : "Not available"],
    ["Delay", delayMinutes ? `${delayMinutes} minutes` : "Not available"],
    ["Cancellation", isCancelledFlight(flight) ? "Cancelled" : "Not available"],
    [getActualLabel(flight), formatDateTime(getActualDateTime(flight))],
    ["Terminal", flight.terminal || "Not available"],
    ["Gate", flight.gate || "Not available"],
    ["Check-in desk", flight.checkInDesk || "Not available"],
    ["Baggage belt", flight.baggageBelt || "Not available"],
    ["Runway", flight.runway || "Not available"],
    ["Call sign", flight.callSign || "Not available"],
    ["Aircraft registration", flight.aircraftRegistration || "Not available"],
    ["Aircraft model", flight.aircraftModel || "Not available"],
    ["Airport name", airport?.name || "Not available"],
    ["Airport country", airport?.countryName || "Not available"],
    ["Airport municipality", airport?.municipality || "Not available"],
    ["Airport codes", [airport?.iataCode || flight.airportCode, airport?.icaoCode].filter(Boolean).join(" / ") || "Not available"],
    ["Distance from LBA", formatDistance(airport?.distanceMiles || flight.routeDistanceMiles)],
    ["Elevation", Number.isFinite(airport?.elevationFt) ? `${airport.elevationFt.toLocaleString("en-GB")} ft` : "Not available"],
    ["Scheduled service", typeof airport?.scheduledService === "boolean" ? (airport.scheduledService ? "Yes" : "No") : "Not available"],
    ["Source", flight.isLive ? flight.liveSource || "Live airport board" : "flight.info schedule"]
  ].filter(([, value]) => value !== "Not available");

  flightModalEyebrow.textContent = flight.type === "departures" ? "Departure details" : "Arrival details";
  flightModalTitle.textContent = flight.flightNumber;
  flightModalSubtitle.textContent = `${flight.airline} • ${flight.route}`;
  flightModalGrid.replaceChildren(...details.map(([label, value]) => createDetailItem(label, value)));
}

function fillTable(tbody, flights, emptyLabel) {
  tbody.replaceChildren();

  if (!flights.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-state">${emptyLabel}</td>`;
    tbody.appendChild(row);
    return;
  }

  flights.forEach((flight) => tbody.appendChild(createFlightRow(flight)));
}

function getRosterFlights() {
  const rosterKeys = new Set(state.rosterFlightKeys);
  const flights = state.dates.flatMap((dateString) => getFlightsForDate(dateString));
  const byRosterKey = new Map(flights.map((flight) => [getRosterFlightKey(flight), flight]));

  return [...rosterKeys]
    .map((key) => byRosterKey.get(key))
    .filter(Boolean)
    .sort((left, right) => {
      return getComparableFlightTime(left) - getComparableFlightTime(right);
    });
}

function getRosterDepartureFlights(rosterFlights) {
  return rosterFlights.filter((flight) => flight.type === "departures");
}

function ensureRosterCalendarMonth(rosterDepartureFlights) {
  if (state.rosterCalendarMonth) {
    return;
  }

  const today = getTodayDateString();
  const nextDeparture = rosterDepartureFlights.find((flight) => flight.date >= today) || rosterDepartureFlights[0];
  const selectedDate = state.dates[state.selectedDateIndex];
  state.rosterCalendarMonth = getMonthKey(nextDeparture?.date || selectedDate || today);
}

function createCalendarFlightItem(flight) {
  const item = document.createElement("div");
  item.className = "calendar-flight";

  if (state.rosterSelectMode) {
    const removeButton = document.createElement("button");
    removeButton.className = "roster-action is-selected";
    removeButton.type = "button";
    removeButton.setAttribute("aria-label", `Remove ${flight.flightNumber} from roster`);
    removeButton.textContent = "-";
    removeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleRosterFlight(flight);
    });
    item.appendChild(removeButton);
  }

  const summary = document.createElement(hasExtraDetails(flight) ? "button" : "span");
  summary.className = "calendar-flight-summary";
  if (summary.tagName === "BUTTON") {
    summary.type = "button";
    summary.addEventListener("click", () => openFlightModal(flight));
  }
  summary.textContent = `${flight.time} ${flight.airportCode || flight.route}`;
  item.appendChild(summary);

  return item;
}

function renderRosterCalendar(fragment, rosterDepartureFlights) {
  ensureRosterCalendarMonth(rosterDepartureFlights);

  const calendarGrid = fragment.querySelector(".roster-calendar-grid");
  const calendarMonth = fragment.querySelector(".roster-calendar-month");
  const monthDate = getMonthDate(state.rosterCalendarMonth);
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const firstDay = new Date(year, month, 1, 12);
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const leadingBlankDays = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((leadingBlankDays + daysInMonth) / 7) * 7;
  const flightsByDate = new Map();

  rosterDepartureFlights
    .filter((flight) => getMonthKey(flight.date) === state.rosterCalendarMonth)
    .forEach((flight) => {
      const flightsForDate = flightsByDate.get(flight.date) || [];
      flightsForDate.push(flight);
      flightsByDate.set(flight.date, flightsForDate);
    });

  calendarMonth.textContent = formatMonthLabel(state.rosterCalendarMonth);
  calendarGrid.replaceChildren();

  ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].forEach((weekday) => {
    const heading = document.createElement("div");
    heading.className = "calendar-weekday";
    heading.textContent = weekday;
    calendarGrid.appendChild(heading);
  });

  for (let cellIndex = 0; cellIndex < totalCells; cellIndex += 1) {
    const dayNumber = cellIndex - leadingBlankDays + 1;
    const day = document.createElement("div");
    day.className = "calendar-day";

    if (dayNumber < 1 || dayNumber > daysInMonth) {
      day.classList.add("is-empty");
      calendarGrid.appendChild(day);
      continue;
    }

    const dateString = `${state.rosterCalendarMonth}-${String(dayNumber).padStart(2, "0")}`;
    const dayFlights = (flightsByDate.get(dateString) || []).sort((left, right) => {
      return getComparableFlightTime(left) - getComparableFlightTime(right);
    });
    const dayLabel = document.createElement("span");
    dayLabel.className = "calendar-day-number";
    dayLabel.textContent = String(dayNumber);
    day.appendChild(dayLabel);

    if (dayFlights.length) {
      day.classList.add("has-flights");
      dayFlights.forEach((flight) => day.appendChild(createCalendarFlightItem(flight)));
    }

    calendarGrid.appendChild(day);
  }
}

function renderRosterResults() {
  results.replaceChildren();
  const rosterFlights = getRosterFlights();
  const rosterDepartureFlights = getRosterDepartureFlights(rosterFlights);
  const fragment = rosterTemplate.content.cloneNode(true);
  const rosterBody = fragment.querySelector(".roster-body");
  const rosterSection = fragment.querySelector(".roster-section");
  const calendarSection = fragment.querySelector(".roster-calendar-section");

  fragment.querySelector(".roster-pill").textContent = `${rosterFlights.length} sectors`;
  fragment.querySelector(".roster-table-pill").textContent = `${rosterFlights.length} saved`;
  fragment.querySelectorAll(".roster-view-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.rosterView === state.rosterView);
    button.addEventListener("click", () => {
      state.rosterView = button.dataset.rosterView;
      render();
    });
  });
  fragment.querySelectorAll(".calendar-nav-button").forEach((button) => {
    button.addEventListener("click", () => {
      state.rosterCalendarMonth = shiftMonthKey(state.rosterCalendarMonth, Number(button.dataset.calendarStep));
      render();
    });
  });

  rosterBody.replaceChildren();
  if (!rosterFlights.length) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="7" class="empty-state">No flights saved to your roster yet.</td>`;
    rosterBody.appendChild(row);
  } else {
    rosterFlights.forEach((flight) => rosterBody.appendChild(createRosterRow(flight)));
  }

  rosterSection.hidden = state.rosterView !== "table";
  calendarSection.hidden = state.rosterView !== "calendar";
  renderRosterCalendar(fragment, rosterDepartureFlights);

  previousDayButton.disabled = true;
  nextDayButton.disabled = true;
  jumpTodayButton.disabled = false;
  results.appendChild(fragment);
}

function renderResults() {
  if (state.showingRoster) {
    renderRosterResults();
    return;
  }

  const visibleFlights = getVisibleFlights();
  results.replaceChildren();
  const dateString = state.dates[state.selectedDateIndex];

  if (!dateString) {
    previousDayButton.disabled = true;
    nextDayButton.disabled = true;
    jumpTodayButton.disabled = true;
    return;
  }

  const departures = visibleFlights.filter((flight) => flight.type === "departures");
  const arrivals = visibleFlights.filter((flight) => flight.type === "arrivals");
  const fragment = dayTemplate.content.cloneNode(true);
  const departuresSection = fragment.querySelector(".departures-section");
  const arrivalsSection = fragment.querySelector(".arrivals-section");

  fragment.querySelector(".day-label").textContent = `Day ${state.selectedDateIndex + 1} of ${state.dates.length}`;
  fragment.querySelector(".day-date").textContent = formatFriendlyDate(dateString);
  fragment.querySelector(".total-pill").textContent = `${
    state.activeView === "departures" ? departures.length : arrivals.length
  } ${state.activeView}`;
  fragment.querySelector(".departures-pill").textContent = `${departures.length} departures`;
  fragment.querySelector(".arrivals-pill").textContent = `${arrivals.length} arrivals`;

  fillTable(
    fragment.querySelector(".departures-body"),
    departures,
    state.jet2Only ? "No Jet2 departures for this day." : "No departures for this day."
  );
  fillTable(
    fragment.querySelector(".arrivals-body"),
    arrivals,
    state.jet2Only ? "No Jet2 arrivals for this day." : "No arrivals for this day."
  );

  if (state.activeView === "departures") {
    arrivalsSection.remove();
  } else {
    departuresSection.remove();
  }

  previousDayButton.disabled = state.selectedDateIndex === 0;
  nextDayButton.disabled = state.selectedDateIndex >= state.dates.length - 1;
  jumpTodayButton.disabled = !state.dates.includes(getTodayDateString());
  results.appendChild(fragment);
}

function render() {
  renderResults();

  const visibleFlights = getVisibleFlights();
  const selectedDate = state.dates[state.selectedDateIndex];
  const liveStatus = state.liveStatusByDate[selectedDate];
  const liveSource = state.liveSourceByDate[selectedDate] || {};
  const sourceBaseUrl = liveStatus === "live" ? liveSource.baseUrl || "https://www.leedsbradfordairport.co.uk/flights/arrivals" : state.staticSourceBaseUrl;
  const sourceName = liveStatus === "live" ? liveSource.name || "Live airport board" : "flight.info";
  const generatedAt = liveStatus === "live" ? state.liveGeneratedAtByDate[selectedDate] : state.staticGeneratedAt;
  const activeFlights = visibleFlights.filter((flight) => flight.type === state.activeView);
  const liveMessage = state.liveMessageByDate[selectedDate] || "";
  const rosterCount = getRosterFlights().length;

  if (state.showingRoster) {
    statusText.textContent = `Showing ${rosterCount} saved roster sectors.`;
  } else {
    statusText.textContent = state.jet2Only
      ? `Showing ${activeFlights.length} Jet2 ${state.activeView} for ${selectedDate} from ${state.airportCode}${state.showCompleted ? ", including completed flights" : ""}${state.rosterSelectMode ? ", roster select mode on" : ""}.`
      : `Showing ${activeFlights.length} ${state.activeView} for ${selectedDate} from ${state.airportCode}${state.showCompleted ? ", including completed flights" : ""}${state.rosterSelectMode ? ", roster select mode on" : ""}.`;
  }

  departuresToggle.classList.toggle("is-active", state.activeView === "departures");
  arrivalsToggle.classList.toggle("is-active", state.activeView === "arrivals");
  rosterSelectToggle.classList.toggle("is-active", state.rosterSelectMode);
  myRosterToggle.classList.toggle("is-active", state.showingRoster);
  showCompletedToggle.checked = state.showCompleted;

  sourceText.innerHTML = generatedAt
    ? `${liveStatus === "live"
        ? "Using live data for today. "
        : liveStatus === "fallback"
          ? `${liveMessage || "Live data unavailable, showing scheduled fallback data."} `
          : ""}Updated ${formatTimestamp(generatedAt)}. Browse forward until the dataset runs out. Data source: <a href="${sourceBaseUrl}" target="_blank" rel="noreferrer">${sourceName}</a>.`
    : "";
}

function getTodayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

async function loadFlights() {
  statusText.textContent = "Loading flights...";
  previousDayButton.disabled = true;
  nextDayButton.disabled = true;
  jumpTodayButton.disabled = true;

  try {
    const [response, airportsResponse] = await Promise.all([
      fetch(getDataUrl(), { cache: "no-store" }),
      fetch(getAirportsUrl(), { cache: "no-store" }).catch(() => null)
    ]);
    const payload = await response.json();
    const airportsPayload = airportsResponse?.ok ? await airportsResponse.json() : { airports: {} };

    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    state.flights = payload.flights;
    state.airports = airportsPayload.airports || payload.airports || {};
    state.dates = payload.dates;
    state.generatedAt = payload.generatedAt;
    state.staticGeneratedAt = payload.generatedAt;
    state.airportCode = payload.airport.code;
    state.sourceBaseUrl = payload.source.baseUrl;
    state.staticSourceBaseUrl = payload.source.baseUrl;
    state.rosterFlightKeys = loadRosterFlightKeys();
    state.selectedDateIndex = Math.max(payload.dates.indexOf(getTodayDateString()), 0);
    render();
  } catch (error) {
    results.replaceChildren();
    statusText.textContent = `Could not load flights: ${error.message}`;
    sourceText.textContent = "";
  } finally {
    if (state.dates.length) {
      previousDayButton.disabled = state.selectedDateIndex === 0;
      nextDayButton.disabled = state.selectedDateIndex >= state.dates.length - 1;
      jumpTodayButton.disabled = !state.dates.includes(getTodayDateString());
    }
  }
}

async function loadLiveFlightsForTodayIfAvailable() {
  if (state.liveRefreshInFlight) {
    return;
  }

  const today = getTodayDateString();
  const liveApiUrl = getLiveApiUrl(today);

  if (!liveApiUrl || !state.dates.includes(today)) {
    return;
  }

  state.liveStatusByDate[today] = "loading";
  state.liveRefreshInFlight = true;
  render();

  try {
    const response = await fetch(liveApiUrl, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Live request failed");
    }

    if (!Array.isArray(payload.flights) || payload.flights.length === 0) {
      state.liveStatusByDate[today] = "fallback";
      state.liveMessageByDate[today] = "Live feed returned no flights, showing scheduled fallback data.";

      if (state.dates[state.selectedDateIndex] === today) {
        render();
      }
      return;
    }

    state.liveFlightsByDate[today] = payload.flights || [];
    state.liveStatusByDate[today] = "live";
    state.liveGeneratedAtByDate[today] = payload.generatedAt;
    state.liveSourceByDate[today] = payload.source || {};
    state.liveMessageByDate[today] = "";

    if (state.dates[state.selectedDateIndex] === today) {
      render();
    }
  } catch (error) {
    state.liveStatusByDate[today] = "fallback";
    state.liveMessageByDate[today] = String(error.message).includes("(429)")
      ? "Live feed is temporarily rate-limited, showing scheduled fallback data."
      : "Live data unavailable, showing scheduled fallback data.";

    if (state.dates[state.selectedDateIndex] === today) {
      render();
    }
  } finally {
    state.liveRefreshInFlight = false;
  }
}

function startLiveRefresh() {
  if (state.liveRefreshTimer) {
    window.clearInterval(state.liveRefreshTimer);
  }

  state.liveRefreshTimer = window.setInterval(() => {
    if (state.dates[state.selectedDateIndex] === getTodayDateString()) {
      loadLiveFlightsForTodayIfAvailable();
    }
  }, LIVE_REFRESH_INTERVAL_MS);
}

jet2Toggle.addEventListener("change", () => {
  state.jet2Only = jet2Toggle.checked;
  render();
});

showCompletedToggle.addEventListener("change", () => {
  state.showCompleted = showCompletedToggle.checked;
  render();
});

departuresToggle.addEventListener("click", () => {
  state.activeView = "departures";
  state.showingRoster = false;
  render();
});

arrivalsToggle.addEventListener("click", () => {
  state.activeView = "arrivals";
  state.showingRoster = false;
  render();
});

rosterSelectToggle.addEventListener("click", () => {
  state.rosterSelectMode = !state.rosterSelectMode;
  state.jet2Only = state.rosterSelectMode ? true : state.jet2Only;
  jet2Toggle.checked = state.jet2Only;
  render();
});

myRosterToggle.addEventListener("click", () => {
  state.showingRoster = !state.showingRoster;
  render();
});

previousDayButton.addEventListener("click", () => {
  state.showingRoster = false;
  state.selectedDateIndex = Math.max(state.selectedDateIndex - 1, 0);
  render();
});

nextDayButton.addEventListener("click", () => {
  state.showingRoster = false;
  state.selectedDateIndex = Math.min(state.selectedDateIndex + 1, state.dates.length - 1);
  render();
});

jumpTodayButton.addEventListener("click", () => {
  const todayIndex = state.dates.indexOf(getTodayDateString());
  if (todayIndex >= 0) {
    state.showingRoster = false;
    state.selectedDateIndex = todayIndex;
    render();
  }
});

closeFlightModalButton.addEventListener("click", closeFlightModal);

flightModal.addEventListener("click", (event) => {
  const bounds = flightModal.getBoundingClientRect();
  const clickedOutside =
    event.clientX < bounds.left ||
    event.clientX > bounds.right ||
    event.clientY < bounds.top ||
    event.clientY > bounds.bottom;

  if (clickedOutside) {
    closeFlightModal();
  }
});

loadFlights().then(() => {
  loadLiveFlightsForTodayIfAvailable();
  startLiveRefresh();
});
