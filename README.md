# CMSV6 Edu

Educational CMSV6-like telematics platform with GPS ingestion, live tracking, alarms, and an MDVR-ready architecture.

## What Is Implemented

- Wialon IPS TCP gateway on port `20332`.
- JT/T 808 TCP gateway subset on port `20380`.
- Diagnostic TCP capture gateway on port `21000` for unknown dashcam protocols.
- HTTP dashboard and REST API on port `8080`.
- Live map updates with Server-Sent Events.
- Fleet device list, online/offline state, route points, and alarms.
- JSONL persistence under `data/`.
- Protocol parser tests.
- Dockerfile and Docker Compose.

## Run Locally

Use the bundled Node.js runtime in this Codex workspace:

```bash
/Users/hossien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node src/server.mjs
```

Then open:

```text
http://localhost:8080
```

Or with a system Node.js:

```bash
npm start
```

For local device-lab testing without colliding with an existing web server:

```bash
npm run lab
```

That uses:

```text
HTTP dashboard:     18080
Wialon IPS gateway: 21332
JT808 gateway:      21380
Raw capture:        21000
```

## Test

```bash
/Users/hossien/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --test
```

## Docker

```bash
docker compose up --build
```

## Wialon IPS Example

```bash
printf '#L#123456789012345;\\r\\n#D#190626;101530;3540.0000;N;05125.0000;E;72;180;120;8;1.0;;;;;ignition:1\\r\\n' | nc localhost 20332
```

## API

```text
GET  /api/health
GET  /api/snapshot
GET  /api/connections
POST /api/connections/reset
GET  /api/events
GET  /api/devices/{id}/history?limit=1000
POST /api/simulate/position
```

## Real Dashcam Test Plan

1. Put the server on a public/static IP or put both the dashcam and server on the same LAN.
2. Configure the dashcam server address to this machine's IP.
3. If the device protocol is known:
   - Wialon IPS: use port `20332`.
   - JT808: use port `20380`.
4. If the protocol is unknown or proprietary CMSV6: use diagnostic port `21000` first.
5. Open `/api/connections` or inspect `data/connections.jsonl`.
6. If packets start with `7e`, move the device to the JT808 port.
7. If packets start with `#L#`, move the device to the Wialon IPS port.
8. If packets look like RTSP/HTTP or unknown binary, keep the capture and use it to add the correct protocol adapter.

For JT808 devices, the server now replies to terminal registration `0x0100` with `0x8100` and an auth code. The default auth code is `cmsv6edu`; override it with:

```bash
JT808_AUTH_CODE=your-code npm start
```

## Next Engineering Steps

1. Replace JSONL with PostgreSQL + PostGIS.
2. Add authentication, tenant model, users, roles, and API tokens.
3. Add geofences and a rule engine for overspeed, SOS, offline, route deviation, and stop detection.
4. Add command queue and reliable device command acknowledgements.
5. Add JT/T 1078 MDVR video ingest as a separate service.
6. Integrate SRS, ZLMediaKit, or lkm for HLS/WebRTC/HTTP-FLV playback.
7. Add Wialon IPS retransmission and webhooks.
