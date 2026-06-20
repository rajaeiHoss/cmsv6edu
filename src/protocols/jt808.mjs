export const JT808 = {
  HEARTBEAT: 0x0002,
  REGISTER: 0x0100,
  AUTH: 0x0102,
  LOCATION: 0x0200,
  GENERAL_REPLY: 0x8001,
  REGISTER_REPLY: 0x8100,
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

function phoneToBcd(phone, bytes = 6) {
  const width = bytes * 2;
  const digits = String(phone).padStart(width, "0").slice(-width);
  const out = Buffer.alloc(bytes);
  for (let i = 0; i < bytes; i += 1) {
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
  const versioned = Boolean(props & (1 << 14));
  const terminalBytes = versioned ? 10 : 6;
  const terminalStart = versioned ? 5 : 4;
  const terminalEnd = terminalStart + terminalBytes;
  if (payload.length < terminalEnd + 3) throw new Error("JT808 header is incomplete");
  const protocolVersion = versioned ? payload[4] : undefined;
  const deviceId = bcdString(payload.subarray(terminalStart, terminalEnd));
  const serial = payload.readUInt16BE(terminalEnd);
  const baseBodyStart = terminalEnd + 2;
  const bodyStart = props & (1 << 13) ? baseBodyStart + 4 : baseBodyStart;
  const bodyEnd = bodyStart + bodyLength;
  if (bodyEnd > payload.length - 1) throw new Error(`JT808 body length out of range: ${bodyLength}`);
  const body = payload.subarray(bodyStart, bodyEnd);
  const packet = {
    messageId,
    deviceId,
    serial,
    body,
    protocolVersion,
    versioned,
    terminalBytes,
  };
  if (messageId === JT808.LOCATION) packet.position = parseLocation(deviceId, body);
  return packet;
}

export function encodeJT808Frame(messageId, phone, serial, body = Buffer.alloc(0), options = {}) {
  const versioned = Boolean(options.versioned);
  const terminalBytes = options.terminalBytes || (versioned ? 10 : 6);
  const headerLength = versioned ? 5 + terminalBytes + 2 : 4 + terminalBytes + 2;
  const payload = Buffer.alloc(headerLength + body.length + 1);
  payload.writeUInt16BE(messageId, 0);
  payload.writeUInt16BE(body.length | (versioned ? (1 << 14) : 0), 2);
  let offset = 4;
  if (versioned) {
    payload[offset] = options.protocolVersion || 1;
    offset += 1;
  }
  phoneToBcd(phone, terminalBytes).copy(payload, offset);
  offset += terminalBytes;
  payload.writeUInt16BE(serial, offset);
  offset += 2;
  body.copy(payload, offset);
  payload[payload.length - 1] = checksum(payload.subarray(0, payload.length - 1));
  return Buffer.concat([Buffer.from([0x7e]), escapePayload(payload), Buffer.from([0x7e])]);
}

function responseOptions(packet) {
  return {
    versioned: packet.versioned,
    terminalBytes: packet.terminalBytes,
    protocolVersion: packet.protocolVersion,
  };
}

export function encodeGeneralReply(phone, serial, replyTo, result = 0, options = {}) {
  const body = Buffer.alloc(5);
  body.writeUInt16BE(serial, 0);
  body.writeUInt16BE(replyTo, 2);
  body[4] = result;
  return encodeJT808Frame(JT808.GENERAL_REPLY, phone, serial, body, options);
}

export function encodeGeneralReplyForPacket(packet, result = 0) {
  return encodeGeneralReply(packet.deviceId, packet.serial, packet.messageId, result, responseOptions(packet));
}

export function encodeRegisterReply(packet, authCode = "cmsv6edu", result = 0) {
  const auth = Buffer.from(result === 0 ? authCode : "", "utf8");
  const body = Buffer.alloc(3 + auth.length);
  body.writeUInt16BE(packet.serial, 0);
  body[2] = result;
  auth.copy(body, 3);
  return encodeJT808Frame(JT808.REGISTER_REPLY, packet.deviceId, packet.serial, body, responseOptions(packet));
}
