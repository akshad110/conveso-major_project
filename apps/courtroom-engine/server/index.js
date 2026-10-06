import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CourtroomEngine } from "../src/engine.js";
import { TrialEngine } from "../src/trialEngine.js";
import { buildStateEvent } from "../src/courtroomEvents.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const port = Number(process.env.PORT || 4177);
const host = process.env.HOST || "127.0.0.1";

// Two engines, on purpose, and they do not overlap.
//
// `engine` is the original rule-based one. It still owns the Developer Mode path:
// a DISPATCH from the keyboard controls goes straight to the renderer without any
// AI in the loop, which is exactly what you want when you are debugging an
// animation and not a trial.
//
// `trial` is the AI courtroom. It decides, validates, queues and broadcasts on its
// own clock. Both write to the same socket because both speak the same message
// contract, so the frontend does not need to know which one is talking.
const engine = new CourtroomEngine();
const trial = new TrialEngine({
  // The story the simulation ships with. COURT_CASE overrides it, so the older
  // matter is still one environment variable away: COURT_CASE=state-v-malhotra.
  caseId: process.env.COURT_CASE || "state-v-rane",
  speed: Number(process.env.COURT_SPEED || 1),
  stream: process.env.COURT_STREAM !== "0",
  log: (message) => console.log(message)
});
const autostart = process.env.COURT_AUTOSTART !== "0";
let started = false;
const sockets = new Set();

/** Commands that drive the AI trial rather than the developer dispatch path. */
const TRIAL_COMMANDS = new Set([
  "START", "START_TRIAL", "STEP", "NEXT_TURN", "PAUSE", "RESUME", "STOP",
  "CALL_WITNESS", "SET_SPEED",
  // The human seat: claiming a role, and answering when the court asks.
  "SET_HUMAN_ROLE", "HUMAN_ACTION", "HUMAN_HANDOFF", "HUMAN_PASS"
]);

// Autostart, with a beat of grace.
//
// A client that lets somebody choose a role has to register that choice before the
// first turn is taken, otherwise the trial has already opened without them. So
// autostart no longer fires the instant a socket connects: a client says HOLD to
// claim the opening, and the timer is only there for clients that do not — the
// plain browser client in public/, and anything else that just wants to watch. On
// loopback a HOLD lands in single-digit milliseconds, so the wait is generous.
const AUTOSTART_GRACE_MS = 900;
let autostartTimer = null;
let held = false;

function scheduleAutostart() {
  if (!autostart || started || held || autostartTimer) return;
  autostartTimer = setTimeout(() => {
    autostartTimer = null;
    if (started || held) return;
    started = true;
    console.log("[server] nobody took a seat; starting with the AI playing every role");
    void trial.command({ type: "START" });
  }, AUTOSTART_GRACE_MS);
}

function cancelAutostart() {
  if (!autostartTimer) return;
  clearTimeout(autostartTimer);
  autostartTimer = null;
}

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
  } catch {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }

  // Render's deploy check requests this path and gives up if it is slow or
  // missing. Keep it free of file reads and trial state.
  if (url.pathname === "/healthz" || url.pathname === "/health") {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
    res.end("ok");
    return;
  }

  if (url.pathname === "/api/state") {
    sendJson(res, engine.snapshot());
    return;
  }

  // The AI trial's own view of the world. Separate endpoint so /api/state keeps
  // returning exactly what it always returned.
  if (url.pathname === "/api/trial") {
    sendJson(res, trial.snapshot());
    return;
  }

  const safePath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(data);
  });
});

server.on("upgrade", (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== "websocket") {
    socket.destroy();
    return;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");

  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      ""
    ].join("\r\n")
  );

  sockets.add(socket);
  send(socket, { type: "STATE", state: engine.snapshot() });
  // And the trial's state, in the shape the AI engine broadcasts, so a client that
  // connects mid-session can catch up on the phase, the transcript and the
  // evidence register without waiting for the next event.
  send(socket, buildStateEvent(trial.state.currentPhase, {
    reason: "client connected",
    court: trial.snapshot()
  }));

  if (autostart && !started) {
    console.log("[server] client connected (set COURT_AUTOSTART=0 to wait for a START command)");
    scheduleAutostart();
  }

  // One frame is not one chunk. Two commands sent in the same tick — Send clicked
  // twice, a seat chosen and the trial started together — arrive coalesced, and
  // reading only the first silently threw the rest away: the person clicked, the
  // court did nothing, and there is no turn timeout to rescue them. A long speech
  // arrives split, and parsing half of it answered them with a JSON error. So the
  // stream is buffered and drained frame by frame.
  let inbox = Buffer.alloc(0);
  let partial = null; // a fragmented message being assembled
  const MAX_INBOX = 4 * 1024 * 1024;

  socket.on("data", (chunk) => {
    inbox = inbox.length ? Buffer.concat([inbox, chunk]) : chunk;
    if (inbox.length > MAX_INBOX) {
      socket.destroy();
      return;
    }

    for (;;) {
      let frame;
      try {
        frame = readFrame(inbox);
      } catch {
        socket.destroy();
        return;
      }
      if (!frame) return;
      inbox = frame.rest;

      if (frame.opcode === 0x8) { // close
        socket.end(Buffer.from([0x88, 0x00]));
        return;
      }
      if (frame.opcode === 0x9) { // ping -> pong, same payload
        const len = Math.min(frame.payload.length, 125);
        socket.write(Buffer.concat([
          Buffer.from([0x8a, len]), frame.payload.subarray(0, len)
        ]));
        continue;
      }
      if (frame.opcode === 0xa) continue; // pong

      if (frame.opcode === 0x1 || frame.opcode === 0x0) {
        partial = partial ? Buffer.concat([partial, frame.payload]) : frame.payload;
        if (!frame.fin) continue;
        const message = partial.toString("utf8");
        partial = null;
        if (!message) continue;
        try {
          handleClientMessage(socket, JSON.parse(message));
        } catch (error) {
          send(socket, { type: "ERROR", message: error.message });
        }
        continue;
      }

      // Binary or reserved. Nothing here speaks it; drop the frame rather than
      // the connection.
      partial = null;
    }
  });

  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => sockets.delete(socket));
});

engine.onBroadcast((message) => broadcast(message));
trial.onBroadcast((message) => broadcast(message));

server.listen(port, host, () => {
  console.log(`AI Courtroom Simulation Engine running at http://${host}:${port}`);
});

function handleClientMessage(socket, payload) {
  const type = String(payload.type || "").toUpperCase();

  // Developer Mode, untouched: the keyboard controls put an event on the wire and
  // it goes to the renderer as-is. No agent, no validator, no queue.
  if (type === "DISPATCH") {
    engine.dispatch(payload.event);
    return;
  }

  // "Wait for me." A client with a role-selection screen sends this the moment it
  // connects, so the court does not open while somebody is still choosing a seat.
  if (type === "HOLD") {
    held = true;
    cancelAutostart();
    return;
  }

  if (type === "RESET") {
    engine.reset();
    cancelAutostart();
    started = false;
    void trial.command({ type: "RESET" });
    return;
  }

  if (TRIAL_COMMANDS.has(type)) {
    if (type === "START" || type === "START_TRIAL") {
      started = true;
      cancelAutostart();
    }
    // Deliberately not awaited: START runs until the case closes, and awaiting it
    // would hold the socket's data handler open for the whole trial.
    void trial.command(payload);
    return;
  }

  send(socket, { type: "ERROR", message: `Unknown client message: ${payload.type}` });
}

function broadcast(message) {
  for (const socket of sockets) {
    send(socket, message);
  }
}

function send(socket, data) {
  if (socket.destroyed) return;
  const payload = Buffer.from(JSON.stringify(data));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.from([0x81, 126, payload.length >> 8, payload.length & 255]);
  } else {
    // The 64-bit length frame. The AI engine's STATE messages carry the whole
    // transcript and evidence register, which passes 64KB in a long session — and a
    // 16-bit length silently wraps, so the client would see a truncated frame and
    // drop the connection.
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  socket.write(Buffer.concat([header, payload]));
}

/**
 * Read one complete frame out of `buf`, or null if it has not all arrived yet.
 *
 * TCP is a byte stream, not a message stream: two frames written back to back
 * arrive as one chunk, and one big frame arrives as several. The reader below is
 * the only thing standing between that fact and the person playing a seat.
 */
function readFrame(buf) {
  if (buf.length < 2) return null;
  const first = buf[0];
  const second = buf[1];
  const masked = (second & 0x80) !== 0;
  let length = second & 0x7f;
  let offset = 2;

  if (length === 126) {
    if (buf.length < offset + 2) return null;
    length = buf.readUInt16BE(offset);
    offset += 2;
  } else if (length === 127) {
    if (buf.length < offset + 8) return null;
    length = Number(buf.readBigUInt64BE(offset));
    offset += 8;
  }

  let masks = null;
  if (masked) {
    if (buf.length < offset + 4) return null;
    masks = buf.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buf.length < offset + length) return null;

  const payload = Buffer.from(buf.subarray(offset, offset + length));
  if (masks) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= masks[index % 4];
    }
  }

  return {
    fin: (first & 0x80) !== 0,
    opcode: first & 0x0f,
    payload,
    rest: buf.subarray(offset + length)
  };
}

function sendJson(res, body) {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body, null, 2));
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  return {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "text/plain; charset=utf-8";
}
