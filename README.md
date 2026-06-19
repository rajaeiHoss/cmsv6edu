# CMSV6 Edu

Educational CMSV6-like telematics platform with GPS ingestion, live tracking, alarms, and an MDVR-ready architecture.

## What Is Implemented

- Wialon IPS TCP gateway on port `20332`.
- JT/T 808 TCP gateway subset on port `20380`.
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
GET  /api/events
GET  /api/devices/{id}/history?limit=1000
POST /api/simulate/position
```

## Next Engineering Steps

1. Replace JSONL with PostgreSQL + PostGIS.
2. Add authentication, tenant model, users, roles, and API tokens.
3. Add geofences and a rule engine for overspeed, SOS, offline, route deviation, and stop detection.
4. Add command queue and reliable device command acknowledgements.
5. Add JT/T 1078 MDVR video ingest as a separate service.
6. Integrate SRS, ZLMediaKit, or lkm for HLS/WebRTC/HTTP-FLV playback.
7. Add Wialon IPS retransmission and webhooks.
