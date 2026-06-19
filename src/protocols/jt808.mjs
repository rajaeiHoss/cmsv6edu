export const JT808 = {
  HEARTBEAT: 0x0002,
  REGISTER: 0x0100,
  AUTH: 0x0102,
  LOCATION: 0x0200,
  GENERAL_REPLY: 0x8001,
};

function checksum(buffer) {
  let value = 0;
  for (const byte of buffer) value ^= byte;
  return value;
}

function unescapePayload(buffer) {
  const out = [];
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] !== 0x7d) {
      out.push(buffer[i]);
      continue;
    }
    i += 1;
    if (i >= buffer.length) throw new Error("dangling JT808 escape byte");
    if (buffer[i] === 0x01) out.push(0x7d);
    else if (buffer[i] === 0x02) out.push(0x7e);
    else throw new Error(`invalid JT808 escape sequence: 0x7d 0x${buffer[i].toString(16)}`);
  }
  return Buffer.from(out);
}

function escapePayload(buffer) {
  const out = [];
  for (const byte of buffer) {
    if (byte === 0x7d) out.push(0x7d, 0x01);
    else if (byte === 0x7e) out.push(0x7d, 0x02);
    else out.push(byte);
  }
  return Buffer.from(out);
}

function bcdString(buffer) {
  let text = "";
  for (const byte of buffer) {
    text += ((byte >> 4) & 0x0f).toString(10);
    text += (byte & 0x0f).toString(10);
  }
  return text.replace(/^0+(?=\d)/, "");
}

function phoneToBcd(phone) {
  const digits = String(phone).padStart(12, "0").slice(-12);
  const out = Buffer.alloc(6);
  for (let i = 0; i < 6; i += 1) {
    out[i] = (Number(digits[i * 2]) << 4) | Number(digits[i * 2 + 1]);
  }
  return out;
}

function bcdByte(byte) {
  return ((byte >> 4) & 0x0f) * 10 + (byte & 0x0f);
}

function bcdTime(buffer) {
  if (buffer.length < 6) return new Date().toISOString();
  return new Date(Date.UTC(
    2000 + bcdByte(buffer[0]),
    bcdByte(buffer[1]) - 1,
    bcdByte(buffer[2]),
    bcdByte(buffer[3]),
    bcdByte(buffer[4]),
    bcdByte(buffer[5]),
  )).toISOString();
}

function parseLocation(deviceId, body) {
  if (body.length < 28) throw new Error(`JT808 location body too short: ${body.length}`);
  const alarmBits = body.readUInt32BE(0);
  const statusBits = body.readUInt32BE(4);
  let latitude = body.readUInt32BE(8) / 1_000_000;
  let longitude = body.readUInt32BE(12) / 1_000_000;
  if (statusBits & (1 << 2)) latitude *= -1;
  if (statusBits & (1 << 3)) longitude *= -1;
  let alarm = "";
  if (alarmBits & 1) alarm = "sos";
  else if (alarmBits & (1 << 1)) alarm = "overspeed";
  else if (alarmBits & (1 << 5)) alarm = "gnss_fault";
  return {
    deviceId,
    protocol: "jt808",
    time: bcdTime(body.subarray(22, 28)),
    latitude,
    longitude,
    altitude: body.readUInt16BE(16),
    speedKph: body.readUInt16BE(18) / 10,
    course: body.readUInt16BE(20),
    valid: Boolean(statusBits & 1),
    alarm,
    attrs: { statusBits: String(statusBits), alarmBits: String(alarmBits) },
  };
}

export function decodeJT808Frame(frame) {
  if (!Buffer.isBuffer(frame)) frame = Buffer.from(frame);
  if (frame.length < 2 || frame[0] !== 0x7e || frame[frame.length - 1] !== 0x7e) {
    throw new Error("JT808 frame must start and end with 0x7e");
  }
  const payload = unescapePayload(frame.subarray(1, frame.length - 1));
  if (payload.length < 13) throw new Error(`JT808 payload too short: ${payload.length}`);
  const expected = payload[payload.length - 1];
  const actual = checksum(payload.subarray(0, payload.length - 1));
  if (expected !== actual) throw new Error("JT808 checksum mismatch");
  const messageId = payload.readUInt16BE(0);
  const props = payload.readUInt16BE(2);
  const bodyLength = props & 0x03ff;
  const deviceId = bcdString(payload.subarray(4, 10));
  const serial = payload.readUInt16BE(10);
  const bodyStart = props & (1 << 13) ? 16 : 12;
  const bodyEnd = bodyStart + bodyLength;
  if (bodyEnd > payload.length - 1) throw new Error(`JT808 body length out of range: ${bodyLength}`);
  const body = payload.subarray(bodyStart, bodyEnd);
  const packet = { messageId, deviceId, serial, body };
  if (messageId === JT808.LOCATION) packet.position = parseLocation(deviceId, body);
  return packet;
}

export function encodeJT808Frame(messageId, phone, serial, body = Buffer.alloc(0)) {
  const payload = Buffer.alloc(12 + body.length + 1);
  payload.writeUInt16BE(messageId, 0);
  payload.writeUInt16BE(body.length, 2);
  phoneToBcd(phone).copy(payload, 4);
  payload.writeUInt16BE(serial, 10);
  body.copy(payload, 12);
  payload[payload.length - 1] = checksum(payload.subarray(0, payload.length - 1));
  return Buffer.concat([Buffer.from([0x7e]), escapePayload(payload), Buffer.from([0x7e])]);
}

export function encodeGeneralReply(phone, serial, replyTo, result = 0) {
  const body = Buffer.alloc(5);
  body.writeUInt16BE(serial, 0);
  body.writeUInt16BE(replyTo, 2);
  body[4] = result;
  return encodeJT808Frame(JT808.GENERAL_REPLY, phone, serial, body);
}
