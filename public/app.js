const state = {
  flights: [],
  dates: [],
  generatedAt: "",
  jet2Only: false,
  airportCode: "LBA",
  sourceBaseUrl: "",
  selectedDateIndex: 0
};

const jet2Toggle = document.getElementById("jet2Only");
const previousDayButton = document.getElementById("previousDayButton");
const nextDayButton = document.getElementById("nextDayButton");
const jumpTodayButton = document.getElementById("jumpTodayButton");
const results = document.getElementById("results");
const summaryCards = document.getElementById("summaryCards");
const statusText = document.getElementById("statusText");
const sourceText = document.getElementById("sourceText");
const dayTemplate = document.getElementById("dayTemplate");

function getDataUrl() {
  return new URL("./data/flights.json", window.location.href).toString();
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
  const flightsForSelectedDate = state.flights.filter((flight) => flight.date === selectedDate);

  return state.jet2Only
    ? flightsForSelectedDate.filter((flight) => flight.isJet2)
    : flightsForSelectedDate;
}

function createSummaryCard(value, label) {
  const card = document.createElement("article");
  card.className = "summary-card";
  card.innerHTML = `<h2>${value}</h2><p>${label}</p>`;
  return card;
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

function renderSummary() {
  const visibleFlights = getVisibleFlights();
  const departures = visibleFlights.filter((flight) => flight.type === "departures");
  const arrivals = visibleFlights.filter((flight) => flight.type === "arrivals");
  const selectedDate = state.dates[state.selectedDateIndex];

  summaryCards.replaceChildren(
    createSummaryCard(selectedDate || "No date", "Selected day"),
    createSummaryCard(visibleFlights.length, state.jet2Only ? "Jet2 flights on this day" : "Flights on this day"),
    createSummaryCard(departures.length, "Departures"),
    createSummaryCard(arrivals.length, "Arrivals")
  );
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

  fragment.querySelector(".day-label").textContent = `Day ${state.selectedDateIndex + 1} of ${state.dates.length}`;
  fragment.querySelector(".day-date").textContent = formatFriendlyDate(dateString);
  fragment.querySelector(".total-pill").textContent = `${visibleFlights.length} flights`;
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

  previousDayButton.disabled = state.selectedDateIndex === 0;
  nextDayButton.disabled = state.selectedDateIndex >= state.dates.length - 1;
  jumpTodayButton.disabled = !state.dates.includes(getTodayDateString());
  results.appendChild(fragment);
}

function render() {
  renderSummary();
  renderResults();

  const visibleFlights = getVisibleFlights();
  const selectedDate = state.dates[state.selectedDateIndex];
  statusText.textContent = state.jet2Only
    ? `Showing ${visibleFlights.length} Jet2 flights for ${selectedDate} from ${state.airportCode}.`
    : `Showing ${visibleFlights.length} flights for ${selectedDate} from ${state.airportCode}.`;

  sourceText.innerHTML = state.generatedAt
    ? `Updated ${formatTimestamp(state.generatedAt)}. Browse forward until the dataset runs out. Data source: <a href="${state.sourceBaseUrl}" target="_blank" rel="noreferrer">flight.info</a>.`
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
    state.airportCode = payload.airport.code;
    state.sourceBaseUrl = payload.source.baseUrl;
    state.selectedDateIndex = Math.max(payload.dates.indexOf(getTodayDateString()), 0);
    render();
  } catch (error) {
    summaryCards.replaceChildren();
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

jet2Toggle.addEventListener("change", () => {
  state.jet2Only = jet2Toggle.checked;
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

loadFlights();
