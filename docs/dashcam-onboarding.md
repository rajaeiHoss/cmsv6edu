# Dashcam Onboarding

Use this workflow before investing more time in the web dashboard. The goal is to prove that the physical dashcam can connect, authenticate, and send at least one usable telemetry packet.

## Ports

| Purpose | Default | Lab Mode | Use When |
| --- | ---: | ---: | --- |
| HTTP/API | 8080 | 18080 | Dashboard and API checks |
| Wialon IPS | 20332 | 21332 | Device says Wialon IPS / Wialon / IPS |
| JT808 | 20380 | 21380 | Device says JT808 / JT/T 808 / Ministry standard |
| Diagnostic capture | 21000 | 21000 | Protocol is unknown, CMSV6 proprietary, or device does not stay online |

## First Test

1. Start the server.
2. Point the dashcam to the server IP and diagnostic port `21000`.
3. Restart the dashcam or force reconnect.
4. Open:

```text
http://SERVER_IP:8080/api/connections
```

If using lab mode locally:

```text
http://localhost:18080/api/connections
```

## Simulator Test Before SIM Card

Run the app in lab mode:

```bash
npm run lab
```

Then run simulated devices:

```bash
npm run simulate:dashcam -- --mode diagnostic --host 127.0.0.1 --port 21000
npm run simulate:dashcam -- --mode wialon --host 127.0.0.1 --port 21332 --count 5
npm run simulate:dashcam -- --mode jt808 --host 127.0.0.1 --port 21380 --count 5
```

The JT808 simulator performs:

1. Terminal registration `0x0100`.
2. Platform registration reply `0x8100`.
3. Terminal authentication `0x0102`.
4. Heartbeat `0x0002`.
5. Location upload `0x0200`.

Use the same simulator against a public server before putting a SIM card in the dashcam:

```bash
npm run simulate:dashcam -- --mode jt808 --host YOUR_PUBLIC_IP --port 20380 --count 10
```

## How To Interpret Captures

| Capture | Meaning | Next Step |
| --- | --- | --- |
| Starts with `7e` | Likely JT808/JT1078 binary framing | Move telemetry server port to JT808 |
| Starts with `#L#` | Wialon IPS login | Move telemetry server port to Wialon IPS |
| Starts with `GET`, `POST`, or `OPTIONS` | HTTP/RTSP-style traffic | Identify whether it is video pull/push, ONVIF, or RTSP |
| Unknown binary | Proprietary protocol, possibly CMSV6 vendor-specific | Keep the raw hex and implement adapter from docs or reverse engineering |

## JT808 Flow Implemented

- Terminal registration `0x0100`.
- Registration reply `0x8100`.
- Heartbeat `0x0002`.
- Authentication `0x0102`.
- Location report `0x0200`.
- Platform general reply `0x8001`.
- 2011/2013 6-byte terminal IDs.
- 2019 versioned 10-byte terminal IDs.

## What We Still Need For MDVR Video

This onboarding layer only proves device connectivity and GPS/control telemetry. Live video needs one of these:

- JT1078 video packet ingest.
- GB28181 SIP/RTP integration.
- RTSP pull from the device.
- Vendor CMSV6 media protocol support.

Do not start the web video player until one real device capture confirms which video path the dashcam uses.
