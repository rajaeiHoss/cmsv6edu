# CMSV6 Edu Architecture

This project is an educational CMSV6-like telematics platform. It is intentionally smaller than CMSV6 or Wialon, but it implements the core shape of the system:

- TCP protocol gateways for device ingestion.
- Normalized position and alarm events.
- Live dashboard updates through Server-Sent Events.
- REST APIs for snapshots and history.
- JSONL persistence for audit/debugging.
- A browser fleet console with map, devices, alarms, and an MDVR extension point.

## Current Protocols

| Protocol | Status | Purpose |
| --- | --- | --- |
| Wialon IPS | Implemented | Login and data packets over TCP. Useful for simple GPS tracker integration and retransmission compatibility. |
| JT/T 808 | Implemented subset | Framing, checksum, phone BCD, general reply, heartbeat/register/auth acknowledgement, and location report decoding. |
| JT/T 1078 | Planned | MDVR live audio/video packet ingest. Should be implemented as a separate video gateway. |
| GB/T 28181 | Planned | SIP/RTP surveillance integration for MDVR/NVR style devices. |

## Recommended Production Shape

```text
Devices
  GPS trackers, MDVRs, dashcams

Protocol gateways
  Wialon IPS TCP
  JT808 TCP
  Teltonika/Concox/etc.

Core event model
  Positions
  Alarms
  Device online/offline
  Commands

Storage
  PostgreSQL + PostGIS for production
  TimescaleDB or partitioned tables for high-volume history

Realtime
  Redis/Kafka/RabbitMQ internally
  SSE/WebSocket to dashboard clients

Video
  JT1078/GB28181 gateway
  SRS/ZLMediaKit/lkm for RTSP, RTMP, HLS, HTTP-FLV, WebRTC
```

## Why Node.js Here?

The repository currently has a runnable dependency-free Node.js implementation because this workspace includes Node.js but not Go. For a high-throughput production protocol gateway, Go, Java/Netty, or Rust would be stronger choices. The protocol boundaries in this code are explicit so the gateway can be rewritten in Go later without changing the dashboard/API model.
