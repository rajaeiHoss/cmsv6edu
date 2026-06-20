const state = {
  devices: new Map(),
  alarms: [],
  connections: [],
  markers: new Map(),
  route: null,
  sampleIndex: 0,
  showLab: true,
};

const tehranRoute = [
  [35.6892, 51.3890],
  [35.6951, 51.4023],
  [35.7040, 51.4148],
  [35.7114, 51.4268],
  [35.7212, 51.4384],
];

const map = L.map("map", { zoomControl: true }).setView([35.6892, 51.3890], 12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);

async function loadSnapshot() {
  const res = await fetch("/api/snapshot");
  const snapshot = await res.json();
  snapshot.devices.forEach((device) => state.devices.set(device.id, device));
  state.alarms = snapshot.alarms || [];
  state.connections = snapshot.connections || [];
  render();
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "device") {
      state.devices.set(message.data.id, message.data);
    }
    if (message.type === "position") {
      const existing = state.devices.get(message.data.deviceId) || {
        id: message.data.deviceId,
        protocol: message.data.protocol,
      };
      existing.online = true;
      existing.lastSeen = new Date().toISOString();
      existing.lastPosition = message.data;
      state.devices.set(existing.id, existing);
    }
    if (message.type === "alarm") {
      state.alarms.unshift(message.data);
      state.alarms = state.alarms.slice(0, 50);
    }
    if (message.type === "connection") {
      state.connections.unshift(message.data);
      state.connections = state.connections.slice(0, 100);
    }
    if (message.type === "connections_reset") {
      state.connections = [];
    }
    render();
  };
}

function render() {
  renderDevices();
  renderAlarms();
  renderConnections();
  renderMarkers();
}

function renderDevices() {
  const devices = Array.from(state.devices.values()).sort((a, b) => a.id.localeCompare(b.id));
  document.getElementById("deviceCount").textContent = devices.length;
  const el = document.getElementById("devices");
  el.innerHTML = devices.length
    ? devices.map(deviceTemplate).join("")
    : `<div class="meta">No devices connected yet. Use Simulate or connect Wialon IPS/JT808 clients.</div>`;
}

function renderConnections() {
  const panel = document.getElementById("deviceLabPanel");
  panel.hidden = !state.showLab;
  document.getElementById("connectionCount").textContent = state.connections.length;
  const el = document.getElementById("connections");
  const visible = state.connections.slice(0, 16);
  el.innerHTML = visible.length
    ? visible.map(connectionTemplate).join("")
    : `<div class="meta">No dashcam connections yet. Point the device to port 21000 first.</div>`;
}

function connectionTemplate(connection) {
  const time = connection.at ? new Date(connection.at).toLocaleTimeString() : "";
  const detected = connection.detectedProtocol || connection.messageId || connection.error || "";
  const cls = connection.phase === "reject" || connection.error ? " bad" : "";
  const raw = connection.hex
    ? `<details><summary>Raw packet</summary><code class="packet">${escapeHtml(connection.hex)}</code><div class="meta">${escapeHtml(connection.ascii || "")}</div></details>`
    : "";
  return `
    <div class="item connection${cls}">
      <strong>${escapeHtml(connection.protocol)} · ${escapeHtml(connection.phase)}</strong>
      <div class="meta">
        ${time} · ${escapeHtml(connection.remoteAddress || "")}:${escapeHtml(connection.remotePort || "")}<br />
        ${detected ? `Detected: ${escapeHtml(detected)}<br />` : ""}
        ${connection.deviceId ? `Device: ${escapeHtml(connection.deviceId)}<br />` : ""}
        ${connection.length ? `Bytes: ${connection.length}` : ""}
      </div>
      ${raw}
    </div>`;
}

function deviceTemplate(device) {
  const p = device.lastPosition;
  const lastSeen = device.lastSeen ? new Date(device.lastSeen).toLocaleString() : "never";
  const location = p ? `${p.latitude.toFixed(5)}, ${p.longitude.toFixed(5)}` : "no position";
  const speed = p ? `${Math.round(p.speedKph)} km/h` : "n/a";
  return `
    <div class="item">
      <strong>${escapeHtml(device.id)}</strong>
      <div class="meta">
        <span class="status ${device.online ? "" : "offline"}">${device.online ? "online" : "offline"}</span>
        · ${escapeHtml(device.protocol || "unknown")} · ${speed}<br />
        ${location}<br />
        Last seen: ${lastSeen}
      </div>
    </div>`;
}

function renderAlarms() {
  document.getElementById("alarmCount").textContent = state.alarms.length;
  const el = document.getElementById("alarms");
  el.innerHTML = state.alarms.length
    ? state.alarms.slice(0, 12).map(alarmTemplate).join("")
    : `<div class="meta">No alarms.</div>`;
}

function alarmTemplate(alarm) {
  return `
    <div class="item alarm">
      <strong>${escapeHtml(alarm.type)}</strong>
      <div class="meta">${escapeHtml(alarm.deviceId)} · ${new Date(alarm.createdAt).toLocaleString()}<br />${escapeHtml(alarm.message)}</div>
    </div>`;
}

function renderMarkers() {
  for (const device of state.devices.values()) {
    const p = device.lastPosition;
    if (!p) continue;
    const latLng = [p.latitude, p.longitude];
    let marker = state.markers.get(device.id);
    if (!marker) {
      marker = L.marker(latLng).addTo(map);
      state.markers.set(device.id, marker);
    }
    marker.setLatLng(latLng);
    marker.bindPopup(`<strong>${escapeHtml(device.id)}</strong><br>${Math.round(p.speedKph)} km/h`);
  }
  const points = Array.from(state.devices.values())
    .map((d) => d.lastPosition)
    .filter(Boolean)
    .map((p) => [p.latitude, p.longitude]);
  if (points.length && !state.hasFit) {
    map.fitBounds(points, { padding: [40, 40], maxZoom: 14 });
    state.hasFit = true;
  }
}

async function simulatePosition() {
  const [latitude, longitude] = tehranRoute[state.sampleIndex % tehranRoute.length];
  state.sampleIndex += 1;
  await fetch("/api/simulate/position", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      deviceId: "SIM-TEHRAN-001",
      protocol: "simulator",
      time: new Date().toISOString(),
      latitude,
      longitude,
      speedKph: 48 + state.sampleIndex * 3,
      course: 90,
      altitude: 1200,
      satellites: 10,
      valid: true,
      alarm: state.sampleIndex % 4 === 0 ? "overspeed" : "",
    }),
  });
}

async function resetConnections() {
  await fetch("/api/connections/reset", { method: "POST" });
  state.connections = [];
  renderConnections();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.getElementById("simulateBtn").addEventListener("click", simulatePosition);
document.getElementById("resetConnectionsBtn").addEventListener("click", resetConnections);
document.getElementById("labModeBtn").addEventListener("click", () => {
  state.showLab = !state.showLab;
  document.getElementById("labModeBtn").classList.toggle("active", state.showLab);
  renderConnections();
});
document.getElementById("labModeBtn").classList.toggle("active", state.showLab);
loadSnapshot().then(connectEvents);
