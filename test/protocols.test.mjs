import test from "node:test";
import assert from "node:assert/strict";
import { parseWialonLine } from "../src/protocols/wialonips.mjs";
import { JT808, decodeJT808Frame, encodeGeneralReplyForPacket, encodeJT808Frame, encodeRegisterReply } from "../src/protocols/jt808.mjs";
import { detectProtocol } from "../src/protocols/probe.mjs";

test("parses Wialon IPS login packets", () => {
  const msg = parseWialonLine("#L#123456789012345;secret\r\n");
  assert.equal(msg.kind, "login");
  assert.equal(msg.deviceId, "123456789012345");
  assert.equal(msg.password, "secret");
});

test("parses Wialon IPS data packets", () => {
  const msg = parseWialonLine("#D#190626;101530;3540.0000;N;05125.0000;E;72;180;120;8;1.0;;;;;ignition:1");
  assert.equal(msg.kind, "data");
  assert.ok(msg.position.latitude > 35.66 && msg.position.latitude < 35.67);
  assert.ok(msg.position.longitude > 51.41 && msg.position.longitude < 51.42);
  assert.equal(msg.position.speedKph, 72);
});

test("encodes and decodes JT808 location packets", () => {
  const body = Buffer.alloc(28);
  body.writeUInt32BE(0, 0);
  body.writeUInt32BE(1, 4);
  body.writeUInt32BE(35689123, 8);
  body.writeUInt32BE(51420123, 12);
  body.writeUInt16BE(120, 16);
  body.writeUInt16BE(725, 18);
  body.writeUInt16BE(180, 20);
  Buffer.from([0x26, 0x06, 0x19, 0x10, 0x15, 0x30]).copy(body, 22);

  const frame = encodeJT808Frame(JT808.LOCATION, "123456789012", 7, body);
  const packet = decodeJT808Frame(frame);
  assert.equal(packet.messageId, JT808.LOCATION);
  assert.equal(packet.deviceId, "123456789012");
  assert.equal(packet.position.speedKph, 72.5);
  assert.equal(packet.position.valid, true);
});

test("supports JT808 2019 versioned terminal IDs", () => {
  const frame = encodeJT808Frame(JT808.HEARTBEAT, "12345678901234567890", 9, Buffer.alloc(0), {
    versioned: true,
    terminalBytes: 10,
    protocolVersion: 1,
  });
  const packet = decodeJT808Frame(frame);
  assert.equal(packet.versioned, true);
  assert.equal(packet.deviceId, "12345678901234567890");
  const reply = encodeGeneralReplyForPacket(packet, 0);
  assert.equal(decodeJT808Frame(reply).messageId, JT808.GENERAL_REPLY);
});

test("encodes JT808 registration replies with auth code", () => {
  const register = decodeJT808Frame(encodeJT808Frame(JT808.REGISTER, "123456789012", 10, Buffer.alloc(37)));
  const reply = decodeJT808Frame(encodeRegisterReply(register, "abc123", 0));
  assert.equal(reply.messageId, JT808.REGISTER_REPLY);
  assert.equal(reply.body.readUInt16BE(0), 10);
  assert.equal(reply.body[2], 0);
  assert.equal(reply.body.subarray(3).toString("utf8"), "abc123");
});

test("detects common dashcam connection protocols", () => {
  assert.equal(detectProtocol(Buffer.from([0x7e, 0x01, 0x7e])), "jt808_or_jt1078");
  assert.equal(detectProtocol(Buffer.from("#L#123;\r\n")), "wialon_ips");
  assert.equal(detectProtocol(Buffer.from("GET / HTTP/1.1\r\n")), "http");
  assert.equal(detectProtocol(Buffer.from("OPTIONS rtsp://camera/live RTSP/1.0\r\n")), "rtsp");
});
