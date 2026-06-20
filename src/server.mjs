import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseWialonLine } from "./protocols/wialonips.mjs";
import { describeBytes } from "./protocols/probe.mjs";
import { JT808, decodeJT808Frame, encodeGeneralReplyForPacket, encodeRegisterReply } from "./protocols/jt808.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(root, "web");
const dataPath = process.env.DATA_PATH || path.join(root, "data");

const state = {
  devices: new Map(),
  positions: [],
  alarms: [],
  connections: [],
  clients: new Set(),
};

const jt808AuthCode = process.env.JT808_AUTH_CODE || "cmsv6edu";

function publish(type, data) {
  const message = `data: ${JSON.stringify({ type, data })}\n\n`;
  for (const client of state.clients) client.write(message);
}

function upsertDevice(id, protocol, online = true) {
  const existing = state.devices.get(id) || { id };
  const device = { ...existing, id, protocol, online, lastSeen: new Date().toISOString() };
  state.devices.set(id, device);
  publish("device", device);
  return device;
}

function setOffline(id) {
  const device = state.devices.get(id);
  if (!device) return;
  device.online = false;
  device.lastSeen = new Date().toISOString();
  state.devices.set(id, device);
  publish("device", device);
}

function addConnectionEvent(event) {
  const enriched = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...event,
  };
  state.connections.unshift(enriched);
  if (state.connections.length > 500) state.connections.length = 500;
  appendJsonl("connections.jsonl", enriched);
  publish("connection", enriched);
  return enriched;
}

function addPosition(position) {
  const p = {
    time: new Date().toISOString(),
    valid: true,
    speedKph: 0,
    course: 0,
    altitude: 0,
    satellites: 0,
    attrs: {},
    ...position,
  };
  const device = upsertDevice(p.deviceId, p.protocol, true);
  device.lastPosition = p;
  state.devices.set(p.deviceId, device);
  state.positions.push(p);
  if (state.positions.length > 20000) state.positions.splice(0, state.positions.length - 20000);
  appendJsonl("positions.jsonl", p);
  publish("position", p);
  if (p.alarm) {
    addAlarm({
      id: `${p.deviceId}-${Date.now()}`,
      deviceId: p.deviceId,
      type: p.alarm,
      severity: "warning",
      message: `${p.deviceId} reported ${p.alarm}`,
      createdAt: new Date().toISOString(),
    });
  }
}

function addAlarm(alarm) {
  state.alarms.unshift(alarm);
  if (state.alarms.length > 1000) state.alarms.length = 1000;
  appendJsonl("alarms.jsonl", alarm);
  publish("alarm", alarm);
}

function appendJsonl(name, value) {
  try {
    fs.mkdirSync(dataPath, { recursive: true });
    fs.appendFileSync(path.join(dataPath, name), `${JSON.stringify(value)}\n`);
  } catch (error) {
    console.warn("event persistence failed", error.message);
  }
}

function snapshot() {
  return {
    devices: Array.from(state.devices.values()),
    positions: state.positions,
    alarms: state.alarms,
    connections: state.connections,
  };
}

function json(res, status, value) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) reject(new Error("request body too large"));
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/health") return json(res, 200, { status: "ok" });
  if (req.method === "GET" && url.pathname === "/api/snapshot") return json(res, 200, snapshot());
  if (req.method === "GET" && url.pathname === "/api/connections") return json(res, 200, state.connections);
  if (req.method === "POST" && url.pathname === "/api/connections/reset") {
    state.connections = [];
    publish("connections_reset", []);
    return json(res, 200, { status: "ok" });
  }
  if (req.method === "GET" && url.pathname === "/api/events") {
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");
    state.clients.add(res);
    req.on("close", () => state.clients.delete(res));
    return;
  }
  const historyMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/history$/);
  if (req.method === "GET" && historyMatch) {
    const limit = Number(url.searchParams.get("limit") || 1000);
    const deviceId = decodeURIComponent(historyMatch[1]);
    return json(res, 200, state.positions.filter((p) => p.deviceId === deviceId).slice(-limit));
  }
  if (req.method === "POST" && url.pathname === "/api/simulate/position") {
    const body = JSON.parse(await readBody(req));
    if (!body.deviceId) return json(res, 400, { error: "deviceId is required" });
    addPosition({ protocol: "simulator", ...body });
    return json(res, 201, body);
  }
  return false;
}

function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(webRoot, requested));
  if (!filePath.startsWith(webRoot)) return json(res, 403, { error: "forbidden" });
  fs.readFile(filePath, (error, content) => {
    if (error) return json(res, 404, { error: "not found" });
    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".svg": "image/svg+xml",
    }[ext] || "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(content);
  });
}

function startHttp(port) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(req, res, url);
        if (handled !== false) return;
      }
      serveStatic(req, res, url);
    } catch (error) {
      json(res, 500, { error: error.message });
    }
  });
  server.listen(port, () => console.log(`HTTP dashboard listening on http://localhost:${port}`));
  return server;
}

function startWialon(port) {
  const server = net.createServer((socket) => {
    let deviceId = "";
    let buffer = "";
    addConnectionEvent({
      protocol: "wialon_ips",
      phase: "connect",
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      localPort: socket.localPort,
    });
    socket.on("data", (chunk) => {
      addConnectionEvent({
        protocol: "wialon_ips",
        phase: "data",
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: socket.localPort,
        ...describeBytes(chunk),
      });
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = parseWialonLine(line);
          if (msg.kind === "login") {
            deviceId = msg.deviceId;
            upsertDevice(deviceId, "wialon_ips", true);
            socket.write("#AL#1\r\n");
          } else if (msg.kind === "data") {
            if (!deviceId) {
              socket.write("#AD#-1\r\n");
              continue;
            }
            addPosition({ ...msg.position, deviceId });
            socket.write("#AD#1\r\n");
          }
        } catch (error) {
          socket.write("#NA\r\n");
          console.warn("Wialon IPS packet rejected:", error.message);
        }
      }
    });
    socket.on("close", () => {
      if (deviceId) setOffline(deviceId);
      addConnectionEvent({
        protocol: "wialon_ips",
        phase: "close",
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: socket.localPort,
        deviceId,
      });
    });
  });
  server.listen(port, () => console.log(`Wialon IPS TCP gateway listening on :${port}`));
  return server;
}

function startJT808(port) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let deviceId = "";
    addConnectionEvent({
      protocol: "jt808",
      phase: "connect",
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      localPort: socket.localPort,
    });
    socket.on("data", (chunk) => {
      addConnectionEvent({
        protocol: "jt808",
        phase: "data",
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: socket.localPort,
        deviceId,
        ...describeBytes(chunk),
      });
      buffer = Buffer.concat([buffer, chunk]);
      while (true) {
        const start = buffer.indexOf(0x7e);
        if (start < 0) {
          buffer = Buffer.alloc(0);
          return;
        }
        const end = buffer.indexOf(0x7e, start + 1);
        if (end < 0) {
          buffer = buffer.subarray(start);
          return;
        }
        const frame = buffer.subarray(start, end + 1);
        buffer = buffer.subarray(end + 1);
        try {
          const packet = decodeJT808Frame(frame);
          deviceId = packet.deviceId;
          upsertDevice(packet.deviceId, "jt808", true);
          if (packet.position) addPosition(packet.position);
          if (packet.messageId === JT808.REGISTER) {
            socket.write(encodeRegisterReply(packet, jt808AuthCode, 0));
          } else {
            socket.write(encodeGeneralReplyForPacket(packet, 0));
          }
          addConnectionEvent({
            protocol: "jt808",
            phase: "decoded",
            remoteAddress: socket.remoteAddress,
            remotePort: socket.remotePort,
            localPort: socket.localPort,
            deviceId,
            messageId: `0x${packet.messageId.toString(16).padStart(4, "0")}`,
            serial: packet.serial,
            versioned: packet.versioned,
          });
        } catch (error) {
          console.warn("JT808 packet rejected:", error.message);
          addConnectionEvent({
            protocol: "jt808",
            phase: "reject",
            remoteAddress: socket.remoteAddress,
            remotePort: socket.remotePort,
            localPort: socket.localPort,
            deviceId,
            error: error.message,
          });
        }
      }
    });
    socket.on("close", () => {
      if (deviceId) setOffline(deviceId);
      addConnectionEvent({
        protocol: "jt808",
        phase: "close",
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: socket.localPort,
        deviceId,
      });
    });
  });
  server.listen(port, () => console.log(`JT808 TCP gateway listening on :${port}`));
  return server;
}

function startDiagnostic(port) {
  const server = net.createServer((socket) => {
    const connectionId = `${socket.remoteAddress}:${socket.remotePort}:${Date.now()}`;
    addConnectionEvent({
      protocol: "diagnostic",
      phase: "connect",
      connectionId,
      remoteAddress: socket.remoteAddress,
      remotePort: socket.remotePort,
      localPort: socket.localPort,
    });
    socket.on("data", (chunk) => {
      const description = describeBytes(chunk);
      addConnectionEvent({
        protocol: "diagnostic",
        phase: "data",
        connectionId,
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: socket.localPort,
        ...description,
      });
      if (description.detectedProtocol === "http") {
        socket.write("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 17\r\n\r\ncmsv6edu capture\n");
      }
    });
    socket.on("close", () => {
      addConnectionEvent({
        protocol: "diagnostic",
        phase: "close",
        connectionId,
        remoteAddress: socket.remoteAddress,
        remotePort: socket.remotePort,
        localPort: socket.localPort,
      });
    });
  });
  server.listen(port, () => console.log(`Diagnostic TCP capture listening on :${port}`));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const httpPort = Number(process.env.HTTP_PORT || 8080);
  const wialonPort = Number(process.env.WIALON_PORT || 20332);
  const jt808Port = Number(process.env.JT808_PORT || 20380);
  const diagnosticPort = Number(process.env.DIAGNOSTIC_PORT || 21000);
  startHttp(httpPort);
  startWialon(wialonPort);
  startJT808(jt808Port);
  startDiagnostic(diagnosticPort);
}

export { addPosition, snapshot, startDiagnostic, startHttp, startJT808, startWialon };
