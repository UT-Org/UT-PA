/* DOM code only. Workflow rules and reservation decisions always run on the server. */
const $ = (id) => document.getElementById(id);

let state;
let signedIn = false;
let polling = false;
let busy = false;
let feedbackTimer;
let connectionAvailable = false;

function feedback(message, error = false) {
  clearTimeout(feedbackTimer);
  $("feedback").textContent = message;
  $("feedback").classList.toggle("error", error);
  $("feedback").hidden = false;
  feedbackTimer = setTimeout(() => {
    $("feedback").hidden = true;
  }, 9000);
}

function showSession(active) {
  signedIn = active;
  $("login-panel").hidden = active;
  $("workspace").hidden = !active;
  $("logout").hidden = !active;
  if (!active) state = undefined;
}

async function api(url, body) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    credentials: "same-origin",
    signal: AbortSignal.timeout(12000),
    headers: body
      ? {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        }
      : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (response.status === 401) showSession(false);
  if (!response.ok)
    throw new Error(data.error || data.message || "Request failed.");
  return data;
}

async function run(command) {
  if (busy) return;
  busy = true;
  try {
    const result = await api("/api/command", command);
    feedback(result.message);
    await refresh();
  } catch (error) {
    feedback(error.message, true);
    await refresh();
  } finally {
    busy = false;
  }
}

function time(value) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: state?.policy?.timeZone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(value);
}

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value; // Never render server data as HTML.
  if (className) node.className = className;
  return node;
}

function control(title, type, secondary = true) {
  if ($("controls").querySelector(`[data-command="${type}"]`)) return;
  const button = element("button", title, secondary ? "secondary" : undefined);
  button.dataset.command = type;
  button.addEventListener("click", () => {
    if (type === "resume" && !$("available").checked)
      return feedback(
        "Confirm that the opening is still available before resuming.",
        true,
      );
    if (
      ["stop", "cancelReservation"].includes(type) &&
      !confirm(
        type === "stop"
          ? "Stop all offers for this opening?"
          : "Cancel this reservation? Staff must also update Square if it was entered there.",
      )
    )
      return;
    void run(
      type === "resume"
        ? {
            type,
            openingAvailable: true,
            recoveryVersion: state.recoveryVersion,
          }
        : { type },
    );
  });
  $("controls").append(button);
}

function render(next) {
  const previousActiveId = state?.offers.find((offer) =>
    ["waiting", "sending"].includes(offer.status),
  )?.id;
  const unchanged =
    connectionAvailable && JSON.stringify(state) === JSON.stringify(next);
  if (state?.recoveryVersion !== next.recoveryVersion)
    $("available").checked = false;
  state = next;
  $("phase").textContent = {
    idle: "Ready",
    offering: "Offering",
    paused: "Staff review needed",
    reserved: "Reserved",
    completed: "Completed",
    stopped: "Stopped",
    exhausted: "Waitlist exhausted",
    failed: "Delivery failed",
  }[state.phase];
  $("message").textContent = state.message;
  $("create").disabled = ["offering", "paused", "reserved"].includes(
    state.phase,
  );
  if (state.opening) {
    $("opening-title").textContent =
      `${state.opening.service} with ${state.opening.stylist}`;
    $("opening-detail").textContent =
      `${time(state.opening.startAt)} · ${state.opening.durationMinutes} minutes · Outreach ends ${time(state.opening.startAt - 30 * 60_000)} · ${state.policy.demo ? "Demo: 20-second offers" : "15-minute offers"}`;
  }
  const active = state.offers.find((offer) =>
    ["waiting", "sending"].includes(offer.status),
  );
  $("active-offer").hidden = !active;
  if (active) {
    $("holder").textContent = active.clientName;
    $("deadline").textContent =
      `${state.phase === "paused" ? "Paused. Original deadline: " : "Reply deadline: "}${time(active.deadline)}${Date.now() >= active.deadline ? " (expired)" : ""}`;
  }
  // Deadlines above keep updating; unchanged polls leave focus and DOM intact.
  if (unchanged) return;
  connectionAvailable = true;
  const wantedControls = new Set();

  function showControl(title, type, secondary = true) {
    wantedControls.add(type);
    control(title, type, secondary);
  }

  $("resume-check").hidden = state.phase !== "paused";
  if (state.phase === "offering") showControl("Pause outreach", "pause");
  if (state.phase === "paused") showControl("Resume outreach", "resume", false);
  if (active && ["offering", "paused"].includes(state.phase))
    showControl("Cancel this offer", "cancelOffer");
  if (["offering", "paused"].includes(state.phase))
    showControl("Stop process", "stop");
  if (["stopped", "failed", "exhausted"].includes(state.phase))
    showControl("Reopen manually", "reopen");
  $("reservation").hidden = !state.reservation;
  if (state.reservation) {
    $("reservation").textContent = state.reservation.squareEntered
      ? `Reserved for ${state.reservation.clientName}. Staff marked it entered in Square.`
      : `Reserved for ${state.reservation.clientName}. Staff must enter this appointment in Square.`;
    if (!state.reservation.squareEntered)
      showControl("I've entered it in Square", "squareEntered", false);
    if (state.phase === "reserved")
      showControl("Cancel reservation", "cancelReservation");
    // Old workflow histories may already contain an acknowledged handoff.
    if (state.phase === "reserved" && state.reservation.squareEntered)
      showControl("Complete booking", "squareEntered", false);
  }
  for (const button of [...$("controls").children])
    if (!wantedControls.has(button.dataset.command)) button.remove();
  $("completed-bookings").hidden = !state.completedBookings?.length;
  $("bookings").replaceChildren();
  for (const booking of state.completedBookings ?? [])
    $("bookings").append(
      element(
        "li",
        `${booking.clientName} · ${new Date(booking.opening.startAt).toLocaleDateString(undefined, { timeZone: state.policy?.timeZone })} ${time(booking.opening.startAt)} · ${booking.opening.service} with ${booking.opening.stylist} · Entered in Square`,
      ),
    );
  $("queue-empty").hidden = state.candidates.length > 0;
  $("queue-table").hidden = !state.candidates.length;
  $("queue").replaceChildren();
  for (const client of [...state.candidates].sort(
    (a, b) => a.joinedAt - b.joinedAt,
  )) {
    const row = element(
      "tr",
      undefined,
      client.exclusionReason ? "excluded" : undefined,
    );
    const offer = state.offers.find((item) => item.clientId === client.id);
    for (const value of [
      client.name,
      client.exclusionReason || "Eligible",
      offer?.status.replaceAll("_", " ") ||
        (client.exclusionReason ? "Not contacted" : "In queue"),
    ])
      row.append(element("td", value));
    $("queue").append(row);
  }
  const selected = $("reply-offer").value;
  const offersSignature = state.offers
    .map((offer) => `${offer.id}:${offer.status}`)
    .join();
  if ($("reply-offer").dataset.signature !== offersSignature) {
    $("reply-offer").replaceChildren();
    for (const offer of state.offers) {
      const option = element(
        "option",
        `${offer.clientName} · ${offer.status} · ${offer.id}`,
      );
      option.value = offer.id;
      $("reply-offer").append(option);
    }
    $("reply-offer").value =
      active && active.id !== previousActiveId
        ? active.id
        : state.offers.some((offer) => offer.id === selected)
          ? selected
          : active?.id || state.offers.at(-1)?.id || "";
    $("reply-offer").dataset.signature = offersSignature;
  }
  for (const id of ["accept", "decline", "optout"])
    $(id).disabled = state.offers.length === 0;
  $("events").replaceChildren();
  for (const event of [...state.events].reverse()) {
    const item = element("li");
    item.append(
      element("time", time(event.at)),
      document.createTextNode(event.message),
    );
    $("events").append(item);
  }
}

async function refresh() {
  if (polling) return;
  polling = true;
  try {
    render(await api("/api/state"));
    showSession(true);
  } catch (error) {
    connectionAvailable = false;
    if (signedIn) {
      $("phase").textContent = "Connection unavailable";
      $("message").textContent =
        "Status may be stale. Staff should handle this opening manually until the service returns. Do not assume an action succeeded.";
      $("controls").replaceChildren();
      for (const id of ["accept", "decline", "optout", "create"])
        $(id).disabled = true;
    }
  } finally {
    polling = false;
  }
}

$("login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await api("/api/login", { code: $("code").value });
    $("code").value = "";
    showSession(true);
    await refresh();
  } catch (error) {
    feedback(error.message, true);
  }
});
$("logout").addEventListener("click", async () => {
  try {
    await api("/api/logout", {});
    showSession(false);
  } catch (error) {
    feedback(error.message, true);
  }
});
$("opening-form").addEventListener("submit", (event) => {
  event.preventDefault();
  void run({
    type: "start",
    startAt: new Date($("start").value).toISOString(),
    durationMinutes: Number($("duration").value),
    service: $("service").value,
    stylist: $("stylist").value,
    timeZone: $("timezone").value,
    opens: $("opens").value,
    closes: $("closes").value,
    demo: $("demo").checked,
  });
});

function reply(answer) {
  const offer = state?.offers.find(
    (item) => item.id === $("reply-offer").value,
  );
  if (offer)
    void run({
      type: "reply",
      offerId: offer.id,
      clientId: offer.clientId,
      answer,
    });
}

$("accept").addEventListener("click", () => reply("accept"));
$("decline").addEventListener("click", () => reply("decline"));
$("optout").addEventListener("click", () => {
  const offer = state?.offers.find(
    (item) => item.id === $("reply-offer").value,
  );
  if (offer) void run({ type: "optOut", clientId: offer.clientId });
});
$("fail-next").addEventListener("click", () => {
  void run({ type: "failNextMessage" });
});
const defaultStart = new Date(Date.now() + 90 * 60_000);
$("start").value = new Date(
  defaultStart.getTime() - defaultStart.getTimezoneOffset() * 60_000,
)
  .toISOString()
  .slice(0, 16);
$("timezone").value = Intl.DateTimeFormat().resolvedOptions().timeZone;
void refresh();
setInterval(() => {
  if (signedIn && !document.hidden) void refresh();
}, 2000);
