function emptyZero(value) {
  return !value || value === "NA" ? "0" : value;
}

function parseTime(date, clock) {
  if (!date || !clock || date === "NA" || clock === "NA") return new Date();
  if (date.length !== 6 || clock.length !== 6) {
    throw new Error(`invalid Wialon IPS date/time: ${date} ${clock}`);
  }
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4)) - 1;
  const year = 2000 + Number(date.slice(4, 6));
  const hour = Number(clock.slice(0, 2));
  const minute = Number(clock.slice(2, 4));
  const second = Number(clock.slice(4, 6));
  return new Date(Date.UTC(year, month, day, hour, minute, second));
}

function parseCoord(value, hemisphere) {
  if (!value || value === "NA") throw new Error("missing coordinate");
  const raw = Number(value);
  if (!Number.isFinite(raw)) throw new Error(`invalid coordinate: ${value}`);
  const degrees = Math.floor(raw / 100);
  const minutes = raw - degrees * 100;
  let coord = degrees + minutes / 60;
  const h = String(hemisphere || "").toUpperCase();
  if (h === "S" || h === "W") coord *= -1;
  if (!["N", "S", "E", "W", ""].includes(h)) throw new Error(`invalid hemisphere: ${hemisphere}`);
  return coord;
}

export function parseWialonLine(line) {
  const text = String(line).trim();
  if (text.startsWith("#L#")) {
    const [deviceId, password = ""] = text.slice(3).split(";");
    if (!deviceId) throw new Error("missing Wialon IPS login IMEI");
    return { kind: "login", deviceId, password };
  }
  if (text.startsWith("#D#")) {
    const fields = text.slice(3).split(";");
    if (fields.length < 10) throw new Error(`Wialon IPS data packet needs at least 10 fields, got ${fields.length}`);
    return {
      kind: "data",
      position: {
        protocol: "wialon_ips",
        time: parseTime(fields[0], fields[1]).toISOString(),
        latitude: parseCoord(fields[2], fields[3]),
        longitude: parseCoord(fields[4], fields[5]),
        speedKph: Number(emptyZero(fields[6])),
        course: Number(emptyZero(fields[7])),
        altitude: Number(emptyZero(fields[8])),
        satellites: Number.parseInt(emptyZero(fields[9]), 10),
        valid: true,
        attrs: {
          hdop: fields[10] || "",
          params: fields[15] || "",
        },
      },
    };
  }
  throw new Error(`unsupported Wialon IPS packet: ${text}`);
}
