import test from "node:test";
import assert from "node:assert/strict";
import { parseWialonLine } from "../src/protocols/wialonips.mjs";
import { JT808, decodeJT808Frame, encodeJT808Frame } from "../src/protocols/jt808.mjs";

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
