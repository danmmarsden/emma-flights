const state = {
  flights: [],
  dates: [],
  generatedAt: "",
  jet2Only: false,
  airportCode: "LBA",
  sourceBaseUrl: ""
};

const jet2Toggle = document.getElementById("jet2Only");
const refreshButton = document.getElementById("refreshButton");
const results = document.getElementById("results");
const summaryCards = document.getElementById("summaryCards");
const statusText = document.getElementById("statusText");
const sourceText = document.getElementById("sourceText");
const dayTemplate = document.getElementById("dayTemplate");

function getApiUrl() {
  if (window.location.protocol === "file:") {
    return "http://127.0.0.1:3000/api/flights";
  }

  return "/api/flights";
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
  return state.jet2Only
    ? state.flights.filter((flight) => flight.isJet2)
    : state.flights;
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

  summaryCards.replaceChildren(
    createSummaryCard(visibleFlights.length, state.jet2Only ? "Jet2 flights in the next 3 days" : "Flights in the next 3 days"),
    createSummaryCard(departures.length, "Departures"),
    createSummaryCard(arrivals.length, "Arrivals")
  );
}

function renderResults() {
  const visibleFlights = getVisibleFlights();
  results.replaceChildren();

  state.dates.forEach((dateString, index) => {
    const dayFlights = visibleFlights.filter((flight) => flight.date === dateString);
    const departures = dayFlights.filter((flight) => flight.type === "departures");
    const arrivals = dayFlights.filter((flight) => flight.type === "arrivals");

    const fragment = dayTemplate.content.cloneNode(true);
    fragment.querySelector(".day-label").textContent = `Day ${index + 1}`;
    fragment.querySelector(".day-date").textContent = formatFriendlyDate(dateString);
    fragment.querySelector(".total-pill").textContent = `${dayFlights.length} flights`;
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

    results.appendChild(fragment);
  });
}

function render() {
  renderSummary();
  renderResults();

  const visibleFlights = getVisibleFlights();
  statusText.textContent = state.jet2Only
    ? `Showing ${visibleFlights.length} Jet2 flights from ${state.airportCode}.`
    : `Showing ${visibleFlights.length} flights from ${state.airportCode}.`;

  sourceText.innerHTML = state.generatedAt
    ? `Updated ${formatTimestamp(state.generatedAt)}. Data source: <a href="${state.sourceBaseUrl}" target="_blank" rel="noreferrer">flight.info</a>.`
    : "";
}

async function loadFlights() {
  statusText.textContent = "Loading flights...";
  refreshButton.disabled = true;

  try {
    const response = await fetch(getApiUrl(), { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Request failed");
    }

    state.flights = payload.flights;
    state.dates = payload.range.dates;
    state.generatedAt = payload.generatedAt;
    state.airportCode = payload.airport.code;
    state.sourceBaseUrl = payload.source.baseUrl;
    render();
  } catch (error) {
    summaryCards.replaceChildren();
    results.replaceChildren();
    statusText.textContent =
      window.location.protocol === "file:"
        ? "Could not load flights. Start the local server with `npm start`, then refresh this page."
        : `Could not load flights: ${error.message}`;
    sourceText.textContent = "";
  } finally {
    refreshButton.disabled = false;
  }
}

jet2Toggle.addEventListener("change", () => {
  state.jet2Only = jet2Toggle.checked;
  render();
});

refreshButton.addEventListener("click", () => {
  loadFlights();
});

loadFlights();
