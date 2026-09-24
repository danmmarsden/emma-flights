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
  liveRefreshInFlight: false
};

const LIVE_REFRESH_INTERVAL_MS = 60 * 1000;

const jet2Toggle = document.getElementById("jet2Only");
const showCompletedToggle = document.getElementById("showCompleted");
const departuresToggle = document.getElementById("departuresToggle");
const arrivalsToggle = document.getElementById("arrivalsToggle");
const previousDayButton = document.getElementById("previousDayButton");
const nextDayButton = document.getElementById("nextDayButton");
const jumpTodayButton = document.getElementById("jumpTodayButton");
const results = document.getElementById("results");
const statusText = document.getElementById("statusText");
const sourceText = document.getElementById("sourceText");
const dayTemplate = document.getElementById("dayTemplate");
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

function getVisibleFlights() {
  const selectedDate = state.dates[state.selectedDateIndex];
  const liveFlights = state.liveFlightsByDate[selectedDate];
  const staticFlights = state.flights.filter((flight) => flight.date === selectedDate);
  const flightsForSelectedDate = Array.isArray(liveFlights)
    ? mergeLiveFlights(staticFlights, liveFlights)
    : staticFlights;
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

function isFlightMarkedCompleted(flight) {
  const normalizedStatus = String(flight.status || "").toLowerCase();
  return /airborn|arriv|land|depart/.test(normalizedStatus);
}

function getCompletionDateTime(flight) {
  return getActualDateTime(flight) || flight.revisedTime || flight.scheduledTime || getDateTimeFromFlightTime(flight);
}

function hasMissingDisplayTime(flight) {
  return !flight.time || flight.time === "--:--";
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

  if (hasMissingDisplayTime(flight)) {
    const completionTime = getDateTimeMs(completionDateTime);
    return Number.isFinite(completionTime) && Date.now() >= completionTime;
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
    ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta">${flight.type === "arrivals" ? "Arrived" : "Departed"} ${actualTime}</span></span>`
    : isCancelledFlight(flight)
      ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta is-cancelled">Cancelled</span></span>`
      : isDelayedFlight(flight) && revisedTime
        ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta is-delayed">Delayed ${revisedTime}</span></span>`
      : hasExpectedUpdate(flight) && expectedStatusText
        ? `<span class="time-wrap"><span class="time-main">${flight.time}</span><span class="time-meta">${expectedStatusText}</span></span>`
    : `<span class="time-main">${flight.time}</span>`;
  const routeCode = flight.airportCode || airport?.iataCode || flight.route || "Not available";
  const routeCell = `<span class="route-wrap"><span class="route-main">${routeCode}</span></span>`;
  const flightCell = detailsAvailable
    ? `<span class="flight-code-wrap"><span class="flight-code">${flight.flightNumber}</span><span class="details-icon" aria-hidden="true">✈</span>${statusBadge ? `<span class="status-badge is-${statusBadge.tone}">${statusBadge.label}</span>` : ""}</span>`
    : `<span class="flight-code">${flight.flightNumber}</span>${statusBadge ? `<span class="status-badge is-${statusBadge.tone}">${statusBadge.label}</span>` : ""}`;
  row.innerHTML = `
    <td data-label="Time">${timeCell}</td>
    <td data-label="Flight">${flightCell}</td>
    <td data-label="Airline"><span class="airline-badge">${flight.airline}</span></td>
    <td data-label="${flight.type === "departures" ? "To" : "From"}">${routeCell}</td>
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

  return row;
}

function createDetailItem(label, value) {
  const item = document.createElement("div");
  item.className = "flight-detail-item";
  item.innerHTML = `<p class="flight-detail-label">${label}</p><p class="flight-detail-value">${value}</p>`;
  return item;
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
    row.innerHTML = `<td colspan="4" class="empty-state">${emptyLabel}</td>`;
    tbody.appendChild(row);
    return;
  }

  flights.forEach((flight) => tbody.appendChild(createFlightRow(flight)));
}

function renderResults() {
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
  statusText.textContent = state.jet2Only
    ? `Showing ${activeFlights.length} Jet2 ${state.activeView} for ${selectedDate} from ${state.airportCode}${state.showCompleted ? ", including completed flights" : ""}.`
    : `Showing ${activeFlights.length} ${state.activeView} for ${selectedDate} from ${state.airportCode}${state.showCompleted ? ", including completed flights" : ""}.`;

  departuresToggle.classList.toggle("is-active", state.activeView === "departures");
  arrivalsToggle.classList.toggle("is-active", state.activeView === "arrivals");
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
  render();
});

arrivalsToggle.addEventListener("click", () => {
  state.activeView = "arrivals";
  render();
});

previousDayButton.addEventListener("click", () => {
  state.selectedDateIndex = Math.max(state.selectedDateIndex - 1, 0);
  render();
});

nextDayButton.addEventListener("click", () => {
  state.selectedDateIndex = Math.min(state.selectedDateIndex + 1, state.dates.length - 1);
  render();
});

jumpTodayButton.addEventListener("click", () => {
  const todayIndex = state.dates.indexOf(getTodayDateString());
  if (todayIndex >= 0) {
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
