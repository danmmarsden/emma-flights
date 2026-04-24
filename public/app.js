const state = {
  flights: [],
  dates: [],
  generatedAt: "",
  staticGeneratedAt: "",
  jet2Only: false,
  activeView: "departures",
  airportCode: "LBA",
  sourceBaseUrl: "",
  staticSourceBaseUrl: "",
  selectedDateIndex: 0,
  liveFlightsByDate: {},
  liveStatusByDate: {},
  liveGeneratedAtByDate: {}
};

const jet2Toggle = document.getElementById("jet2Only");
const departuresToggle = document.getElementById("departuresToggle");
const arrivalsToggle = document.getElementById("arrivalsToggle");
const previousDayButton = document.getElementById("previousDayButton");
const nextDayButton = document.getElementById("nextDayButton");
const jumpTodayButton = document.getElementById("jumpTodayButton");
const results = document.getElementById("results");
const statusText = document.getElementById("statusText");
const sourceText = document.getElementById("sourceText");
const dayTemplate = document.getElementById("dayTemplate");

function getDataUrl() {
  return new URL("./data/flights.json", window.location.href).toString();
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

function getVisibleFlights() {
  const selectedDate = state.dates[state.selectedDateIndex];
  const liveFlights = state.liveFlightsByDate[selectedDate];
  const flightsForSelectedDate = Array.isArray(liveFlights)
    ? liveFlights
    : state.flights.filter((flight) => flight.date === selectedDate);

  return state.jet2Only
    ? flightsForSelectedDate.filter((flight) => flight.isJet2)
    : flightsForSelectedDate;
}

function createFlightRow(flight) {
  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${flight.time}</td>
    <td class="flight-code">${flight.flightNumber}</td>
    <td><span class="airline-badge">${flight.airline}</span></td>
    <td>${flight.route}</td>
  `;
  return row;
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
  const sourceBaseUrl = liveStatus === "live" ? "https://aerodatabox.com/" : state.staticSourceBaseUrl;
  const sourceName = liveStatus === "live" ? "AeroDataBox" : "flight.info";
  const generatedAt = liveStatus === "live" ? state.liveGeneratedAtByDate[selectedDate] : state.staticGeneratedAt;
  const activeFlights = visibleFlights.filter((flight) => flight.type === state.activeView);
  statusText.textContent = state.jet2Only
    ? `Showing ${activeFlights.length} Jet2 ${state.activeView} for ${selectedDate} from ${state.airportCode}.`
    : `Showing ${activeFlights.length} ${state.activeView} for ${selectedDate} from ${state.airportCode}.`;

  departuresToggle.classList.toggle("is-active", state.activeView === "departures");
  arrivalsToggle.classList.toggle("is-active", state.activeView === "arrivals");

  sourceText.innerHTML = generatedAt
    ? `${liveStatus === "live"
        ? "Using live data for today. "
        : liveStatus === "fallback"
          ? "Live data unavailable, showing scheduled fallback data. "
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
    const response = await fetch(getDataUrl(), { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Request failed");
    }

    state.flights = payload.flights;
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
  const today = getTodayDateString();
  const liveApiUrl = getLiveApiUrl(today);

  if (!liveApiUrl || !state.dates.includes(today)) {
    return;
  }

  state.liveStatusByDate[today] = "loading";
  render();

  try {
    const response = await fetch(liveApiUrl, { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Live request failed");
    }

    state.liveFlightsByDate[today] = payload.flights || [];
    state.liveStatusByDate[today] = "live";
    state.liveGeneratedAtByDate[today] = payload.generatedAt;

    if (state.dates[state.selectedDateIndex] === today) {
      render();
    }
  } catch (_error) {
    state.liveStatusByDate[today] = "fallback";

    if (state.dates[state.selectedDateIndex] === today) {
      render();
    }
  }
}

jet2Toggle.addEventListener("change", () => {
  state.jet2Only = jet2Toggle.checked;
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

loadFlights().then(() => loadLiveFlightsForTodayIfAvailable());
