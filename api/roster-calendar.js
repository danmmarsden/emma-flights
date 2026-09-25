const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type"
};

function sendText(res, statusCode, text, contentType = "text/plain; charset=utf-8") {
  res.statusCode = statusCode;
  Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
  res.setHeader("content-type", contentType);
  res.setHeader("cache-control", "no-store");
  res.end(text);
}

function getRosterCalendarUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Missing roster calendar URL.");
  }

  const normalizedUrl = rawUrl.trim().replace(/^webcal:\/\//i, "https://");
  const url = new URL(normalizedUrl);

  if (url.protocol !== "https:") {
    throw new Error("Roster calendar URL must use HTTPS or WebCal.");
  }

  if (!/(^|\.)rosterbuster\.(com|aero)$/i.test(url.hostname)) {
    throw new Error("Only RosterBuster calendar links are supported.");
  }

  if (!url.pathname.toLowerCase().endsWith(".ics")) {
    throw new Error("RosterBuster calendar link must end with .ics.");
  }

  return url;
}

module.exports = async (req, res) => {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    Object.entries(CORS_HEADERS).forEach(([key, value]) => res.setHeader(key, value));
    res.setHeader("cache-control", "no-store");
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendText(res, 405, "Method not allowed");
    return;
  }

  try {
    const calendarUrl = getRosterCalendarUrl(req.query?.url);
    const response = await fetch(calendarUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; LBA-roster-import/1.0)",
        accept: "text/calendar,text/plain,*/*"
      }
    });

    if (!response.ok) {
      throw new Error(`RosterBuster calendar request failed (${response.status})`);
    }

    const text = await response.text();
    if (!/BEGIN:VCALENDAR/i.test(text)) {
      throw new Error("RosterBuster did not return an ICS calendar.");
    }

    sendText(res, 200, text, "text/calendar; charset=utf-8");
  } catch (error) {
    sendText(res, 400, error.message);
  }
};
