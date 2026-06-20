#!/usr/bin/env node
import net from "node:net";
import { JT808, decodeJT808Frame, encodeJT808Frame } from "../src/protocols/jt808.mjs";

const defaults = {
  host: "127.0.0.1",
  mode: "jt808",
  deviceId: "123456789012",
  intervalMs: 2000,
  count: 5,
  lat: 35.6892,
  lon: 51.3890,
  speed: 48,
  course: 90,
  port: undefined,
};

const options = parseArgs(process.argv.slice(2));
if (!options.port) {
  options.port = options.mode === "wialon" ? 21332 : options.mode === "diagnostic" ? 21000 : 21380;
}

if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.mode === "wialon") {
  await runWialon(options);
} else if (options.mode === "diagnostic") {
  await runDiagnostic(options);
} else if (options.mode === "jt808") {
  await runJT808(options);
} else {
  throw new Error(`unsupported mode: ${options.mode}`);
}

function parseArgs(args) {
  const out = { ...defaults };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const value = args[i + 1];
      i += 1;
      if (value == null) throw new Error(`missing value for ${arg}`);
      if (["port", "intervalMs", "count"].includes(key)) out[key] = Number(value);
      else if (["lat", "lon", "speed", "course"].includes(key)) out[key] = Number(value);
      else out[key] = value;
    }
  }
  return out;
}

function connect({ host, port }) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, host, () => resolve(socket));
    socket.setNoDelay(true);
    socket.once("error", reject);
  });
}

async function runDiagnostic(opts) {
  const socket = await connect(opts);
  console.log(`diagnostic simulator connected to ${opts.host}:${opts.port}`);
  socket.end(`#L#${opts.deviceId};\r\n`);
  await waitForClose(socket);
}

async function runWialon(opts) {
  const socket = await connect(opts);
  console.log(`wialon simulator connected to ${opts.host}:${opts.port}`);
  socket.on("data", (chunk) => console.log(`server: ${chunk.toString("utf8").trim()}`));
  socket.write(`#L#${opts.deviceId};\r\n`);
  for (let i = 0; i < opts.count; i += 1) {
    await sleep(i === 0 ? 250 : opts.intervalMs);
    socket.write(wialonDataLine(opts, i));
    console.log(`sent Wialon position ${i + 1}/${opts.count}`);
  }
  await sleep(250);
  socket.end();
  await waitForClose(socket);
}

async function runJT808(opts) {
  const socket = await connect(opts);
  let serial = 1;
  let authenticated = false;
  console.log(`jt808 simulator connected to ${opts.host}:${opts.port}`);

  socket.on("data", (chunk) => {
    for (const frame of splitJT808Frames(chunk)) {
      try {
        const packet = decodeJT808Frame(frame);
        console.log(`server reply: 0x${packet.messageId.toString(16).padStart(4, "0")}`);
        if (packet.messageId === JT808.REGISTER_REPLY) {
          const auth = packet.body.subarray(3).toString("utf8") || "cmsv6edu";
          socket.write(encodeJT808Frame(JT808.AUTH, opts.deviceId, serial++, Buffer.from(auth, "utf8")));
          authenticated = true;
          console.log(`sent JT808 auth: ${auth}`);
        }
      } catch (error) {
        console.warn(`could not decode server reply: ${error.message}`);
      }
    }
  });

  socket.write(encodeJT808Frame(JT808.REGISTER, opts.deviceId, serial++, buildRegisterBody()));
  console.log("sent JT808 register");
  await sleep(500);
  if (!authenticated) {
    socket.write(encodeJT808Frame(JT808.AUTH, opts.deviceId, serial++, Buffer.from("cmsv6edu", "utf8")));
    console.log("sent fallback JT808 auth");
  }

  for (let i = 0; i < opts.count; i += 1) {
    await sleep(i === 0 ? 250 : opts.intervalMs);
    socket.write(encodeJT808Frame(JT808.HEARTBEAT, opts.deviceId, serial++));
    socket.write(encodeJT808Frame(JT808.LOCATION, opts.deviceId, serial++, buildLocationBody(opts, i)));
    console.log(`sent JT808 heartbeat + position ${i + 1}/${opts.count}`);
  }
  await sleep(500);
  socket.end();
  await waitForClose(socket);
}

function splitJT808Frames(buffer) {
  const frames = [];
  let start = buffer.indexOf(0x7e);
  while (start >= 0) {
    const end = buffer.indexOf(0x7e, start + 1);
    if (end < 0) break;
    frames.push(buffer.subarray(start, end + 1));
    start = buffer.indexOf(0x7e, end + 1);
  }
  return frames;
}

function buildRegisterBody() {
  const body = Buffer.alloc(37);
  body.writeUInt16BE(1, 0);
  body.writeUInt16BE(1, 2);
  Buffer.from("CMSV6EDU").copy(body, 4);
  Buffer.from("SIMULATOR-001").copy(body, 15);
  body[36] = 1;
  return body;
}

function buildLocationBody(opts, index) {
  const body = Buffer.alloc(28);
  const lat = Math.round((opts.lat + index * 0.002) * 1_000_000);
  const lon = Math.round((opts.lon + index * 0.0025) * 1_000_000);
  body.writeUInt32BE(index % 4 === 3 ? 1 << 1 : 0, 0);
  body.writeUInt32BE(1, 4);
  body.writeUInt32BE(lat, 8);
  body.writeUInt32BE(lon, 12);
  body.writeUInt16BE(1200, 16);
  body.writeUInt16BE(Math.round((opts.speed + index * 2) * 10), 18);
  body.writeUInt16BE(opts.course, 20);
  encodeBcdTimestamp(new Date()).copy(body, 22);
  return body;
}

function encodeBcdTimestamp(date) {
  const values = [
    date.getUTCFullYear() % 100,
    date.getUTCMonth() + 1,
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];
  return Buffer.from(values.map((value) => ((Math.floor(value / 10) << 4) | (value % 10))));
}

function wialonDataLine(opts, index) {
  const date = new Date();
  const ddmmyy = `${pad(date.getUTCDate())}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCFullYear() % 100)}`;
  const hhmmss = `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`;
  const lat = decimalToNmea(opts.lat + index * 0.002, true);
  const lon = decimalToNmea(opts.lon + index * 0.0025, false);
  return `#D#${ddmmyy};${hhmmss};${lat.value};${lat.hemisphere};${lon.value};${lon.hemisphere};${opts.speed + index * 2};${opts.course};1200;10;1.0;;;;;ignition:1\r\n`;
}

function decimalToNmea(decimal, isLat) {
  const hemisphere = isLat ? (decimal < 0 ? "S" : "N") : (decimal < 0 ? "W" : "E");
  const abs = Math.abs(decimal);
  const degrees = Math.floor(abs);
  const minutes = (abs - degrees) * 60;
  const width = isLat ? 2 : 3;
  return { value: `${String(degrees).padStart(width, "0")}${minutes.toFixed(4).padStart(7, "0")}`, hemisphere };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForClose(socket) {
  return new Promise((resolve) => socket.once("close", resolve));
}

function printHelp() {
  console.log(`Dashcam simulator

Usage:
  node tools/dashcam-simulator.mjs --mode jt808 --host 127.0.0.1 --port 21380
  node tools/dashcam-simulator.mjs --mode wialon --host 127.0.0.1 --port 21332
  node tools/dashcam-simulator.mjs --mode diagnostic --host 127.0.0.1 --port 21000

Options:
  --deviceId     Device identifier. Default: ${defaults.deviceId}
  --count        Number of positions to send. Default: ${defaults.count}
  --intervalMs   Delay between positions. Default: ${defaults.intervalMs}
  --lat          Start latitude. Default: ${defaults.lat}
  --lon          Start longitude. Default: ${defaults.lon}
`);
}
