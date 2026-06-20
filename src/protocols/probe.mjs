const textDecoder = new TextDecoder("utf-8", { fatal: false });

export function describeBytes(buffer) {
  const sample = buffer.subarray(0, 96);
  const ascii = textDecoder
    .decode(sample)
    .replace(/[^\x20-\x7e\r\n\t]/g, ".")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
  return {
    length: buffer.length,
    hex: sample.toString("hex"),
    ascii,
    detectedProtocol: detectProtocol(buffer),
  };
}

export function detectProtocol(buffer) {
  if (!buffer.length) return "empty";
  const text = buffer.subarray(0, 16).toString("utf8");
  if (buffer[0] === 0x7e) return "jt808_or_jt1078";
  if (text.startsWith("#L#") || text.startsWith("#D#")) return "wialon_ips";
  if (text.startsWith("OPTIONS ") || text.startsWith("DESCRIBE ") || text.startsWith("SETUP ")) return "rtsp";
  if (/^(GET|POST|PUT|OPTIONS|HEAD)\s/.test(text)) return "http";
  if (buffer[0] === 0x24 && buffer.length > 4) return "rtp_over_rtsp";
  return "unknown_tcp";
}
