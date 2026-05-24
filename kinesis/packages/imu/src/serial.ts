// Web Serial transport for an Arduino streaming IMU frames.
//
// Two wire protocols are accepted on the same port — the parser sniffs
// the first character of each line:
//
//   CSV (compact, default):
//     t,ax,ay,az,gx,gy,gz[,mx,my,mz[,temperature]]\n
//
//   JSON (richer — used by the MYOSA ESP32 firmware that fuses
//   orientation on-device with Madgwick):
//     {"t":..,"ax":..,"ay":..,"az":..,"gx":..,"gy":..,"gz":..,
//      "qw":..,"qx":..,"qy":..,"qz":..,"roll":..,"pitch":..,"yaw":..}\n
//
// Numbers are decimal in both. Accel in g, gyro in deg/s. Bad / partial /
// empty lines are silently dropped.
//
// The frame rate is whatever the firmware emits — typically 50–100 Hz.
// The transport does no rate-limiting; consumers can decimate if needed.

import type { ImuFrame, ImuStatus, ImuTransport, ImuTransportEvent } from './types';

// The Web Serial API is not in standard DOM types yet. We declare just the
// pieces we touch — `unknown`-y everywhere else.
type WebSerialPort = {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?: (signals: { dataTerminalReady?: boolean; requestToSend?: boolean }) => Promise<void>;
};
type WebSerial = {
  requestPort(): Promise<WebSerialPort>;
  getPorts(): Promise<WebSerialPort[]>;
};

/** Counter incremented for every raw byte the transport reads. Exposed
 *  so the UI can show "data is or isn't actually flowing" without
 *  depending on lines parsing successfully. */
export const rawByteCounter = { count: 0 };

function getSerial(): WebSerial | null {
  if (typeof navigator === 'undefined') return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (navigator as any).serial ?? null;
}

export type WebSerialImuOptions = {
  /** Default 115200 — matches the reference sketch. */
  baudRate?: number;
};

export class WebSerialImuTransport implements ImuTransport {
  private port: WebSerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private readonly subs = new Set<(e: ImuTransportEvent) => void>();
  private status: ImuStatus = 'idle';
  private stopRequested = false;
  private lineBuf = '';
  private readonly opts: Required<WebSerialImuOptions>;

  constructor(opts: WebSerialImuOptions = {}) {
    // Use ?? rather than a spread default: { baudRate: 115200, ...opts }
    // would let `opts.baudRate === undefined` overwrite the 115200
    // default, which Web Serial then rejects with "Required member
    // is undefined".
    this.opts = { baudRate: opts.baudRate ?? 115200 };
  }

  isSupported(): boolean {
    return getSerial() !== null;
  }

  label(): string {
    return `USB Serial · ${this.opts.baudRate} baud`;
  }

  subscribe(cb: (e: ImuTransportEvent) => void): () => void {
    this.subs.add(cb);
    return () => {
      this.subs.delete(cb);
    };
  }

  private emit(e: ImuTransportEvent) {
    for (const s of this.subs) s(e);
  }

  private setStatus(s: ImuStatus, detail?: string) {
    this.status = s;
    this.emit({ kind: 'status', status: s, detail });
  }

  async start(): Promise<void> {
    const serial = getSerial();
    if (!serial) {
      this.setStatus('error', 'Web Serial is not supported in this browser.');
      this.emit({ kind: 'error', message: 'Web Serial unsupported' });
      return;
    }
    if (this.status === 'streaming' || this.status === 'connecting') return;

    this.stopRequested = false;
    try {
      this.setStatus('requesting');
      const port = await serial.requestPort();
      this.setStatus('connecting');
      await port.open({ baudRate: this.opts.baudRate });
      this.port = port;
      // Reset the ESP32 via RTS so we start from a known-good state.
      // ESP32: RTS=high pulls EN low (reset). Pulse RTS high→low while
      // DTR stays low so we boot into run mode, not bootloader.
      // Silently skipped if the OS / driver doesn't expose setSignals.
      if (port.setSignals) {
        try {
          await port.setSignals({ dataTerminalReady: false, requestToSend: true });
          await new Promise((r) => setTimeout(r, 80));
          await port.setSignals({ dataTerminalReady: false, requestToSend: false });
        } catch {
          // Not all USB-serial drivers support setSignals — ignore.
        }
      }
      if (!port.readable) {
        this.setStatus('error', 'Port has no readable stream.');
        return;
      }
      this.reader = port.readable.getReader();
      this.setStatus('streaming');
      void this.readLoop();
    } catch (e: unknown) {
      // User cancelled the port-picker — DOMException AbortError.
      const msg = e instanceof Error ? e.message : 'Could not connect to the serial port.';
      this.setStatus('error', msg);
      this.emit({ kind: 'error', message: msg });
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    try {
      if (this.reader) {
        try { await this.reader.cancel(); } catch { /* noop */ }
        try { this.reader.releaseLock(); } catch { /* noop */ }
        this.reader = null;
      }
      if (this.port) {
        try { await this.port.close(); } catch { /* noop */ }
        this.port = null;
      }
    } finally {
      this.setStatus('closed');
    }
  }

  private async readLoop() {
    const decoder = new TextDecoder('utf-8');
    // Temporary diagnostic — log first 20 lines we see so we can tell
    // whether (a) firmware isn't streaming, (b) firmware is streaming
    // but the parser is rejecting it. Inspect via window.__imuDebug
    // in DevTools, or watch the console.
    let dbgCount = 0;
    const win = (typeof window !== 'undefined' ? (window as unknown as Record<string, unknown>) : null);
    if (win) win.__imuDebug = [];
    while (!this.stopRequested && this.reader) {
      try {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (!value) continue;
        rawByteCounter.count += value.length;
        const chunk = decoder.decode(value, { stream: true });
        // Log every chunk so we can see exactly what the device sends.
        // eslint-disable-next-line no-console
        if (chunk) console.log('[imu chunk]', value.length, 'B:', JSON.stringify(chunk.slice(0, 200)));
        this.lineBuf += chunk;
        let nl: number;
        while ((nl = this.lineBuf.indexOf('\n')) !== -1) {
          const line = this.lineBuf.slice(0, nl).trim();
          this.lineBuf = this.lineBuf.slice(nl + 1);
          if (!line || line.startsWith('#')) continue;
          const frame = parseImuLine(line);
          if (dbgCount < 20) {
            dbgCount++;
            const entry = { line, parsed: !!frame };
            if (win) (win.__imuDebug as unknown[]).push(entry);
            // eslint-disable-next-line no-console
            console.log('[imu raw]', frame ? 'OK' : 'REJECT', JSON.stringify(line));
          }
          if (frame) this.emit({ kind: 'frame', frame });
        }
      } catch (e: unknown) {
        if (!this.stopRequested) {
          const msg = e instanceof Error ? e.message : 'Serial read failed.';
          this.emit({ kind: 'error', message: msg });
          this.setStatus('error', msg);
        }
        break;
      }
    }
  }
}

/**
 * Parse one frame line. Tries JSON-ish first (any line containing
 * `"ax":` and `"gx":` patterns), falling back to CSV. Returns null
 * on malformed input — caller should drop the line silently.
 *
 * Permissive on purpose: a partial line at connect time, a stray
 * boot message, or a `Serial.print` interleave shouldn't poison the
 * whole session.
 */
export function parseImuLine(line: string): ImuFrame | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  // If the line contains keyed numeric fields anywhere, use the
  // JSON-ish path. Otherwise treat it as CSV.
  if (/"(?:ax|ay|az|gx|gy|gz)"\s*:/.test(trimmed)) return parseImuJson(trimmed);
  if (trimmed.charCodeAt(0) === 123 /* '{' */) return parseImuJson(trimmed);
  return parseImuCsv(trimmed);
}

function parseImuCsv(line: string): ImuFrame | null {
  const parts = line.split(',');
  if (parts.length < 7) return null;
  const ns = parts.map((p) => Number(p));
  if (ns.some((n) => !isFinite(n))) return null;
  const [tMs, ax, ay, az, gx, gy, gz, mx, my, mz, temperature] = ns;
  return {
    tMs: tMs ?? 0,
    ax: ax ?? 0,
    ay: ay ?? 0,
    az: az ?? 0,
    gx: gx ?? 0,
    gy: gy ?? 0,
    gz: gz ?? 0,
    ...(mx !== undefined && my !== undefined && mz !== undefined ? { mx, my, mz } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
  };
}

function parseImuJson(line: string): ImuFrame | null {
  // Arduino's `Serial.print(float)` prints `nan` / `inf` / `-inf`
  // verbatim when the value isn't finite, which makes the line
  // invalid JSON. The Madgwick filter on the ESP32 can briefly emit
  // NaN during boot if the IMU's first samples are noisy — without
  // this sanitiser we'd drop every frame for the rest of the session.
  // Replace any non-finite literal with 0 before parsing.
  const sanitised = line.replace(
    /:\s*(-?inf(?:inity)?|nan)\b/gi,
    ': 0',
  );
  let obj: Record<string, unknown> = {};
  let strictParsed = false;
  try {
    obj = JSON.parse(sanitised) as Record<string, unknown>;
    strictParsed = true;
  } catch {
    // Fall through to permissive regex extraction below.
  }
  // Permissive fallback: pull `"key": number` pairs out of the line
  // even if it's not strictly JSON (partial line, embedded prefix,
  // missing braces, trailing garbage). This makes us tolerant to
  // mid-stream connects and Serial.print interleaves.
  if (!strictParsed) {
    const fieldRegex = /"(\w+)"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;
    let m: RegExpExecArray | null;
    while ((m = fieldRegex.exec(sanitised)) !== null) {
      obj[m[1]!] = Number(m[2]!);
    }
    if (Object.keys(obj).length === 0) {
      // eslint-disable-next-line no-console
      console.warn('[imu reject] no JSON fields:', JSON.stringify(line.slice(0, 120)));
      return null;
    }
  }
  const num = (k: string): number | undefined => {
    const v = obj[k];
    return typeof v === 'number' && isFinite(v) ? v : undefined;
  };
  const t = num('t');
  const ax = num('ax'), ay = num('ay'), az = num('az');
  const gx = num('gx'), gy = num('gy'), gz = num('gz');
  // Minimum useful frame must have accel + gyro. Without those, we
  // can't run any of the orientation filters even if a quaternion is
  // present (we still need raw readings to detect motion).
  if (ax === undefined || ay === undefined || az === undefined ||
      gx === undefined || gy === undefined || gz === undefined) {
    // eslint-disable-next-line no-console
    console.warn('[imu reject] missing required fields:',
      { ax, ay, az, gx, gy, gz, keys: Object.keys(obj) },
      JSON.stringify(line.slice(0, 160)));
    return null;
  }
  const mx = num('mx'), my = num('my'), mz = num('mz');
  const temperature = num('temperature') ?? num('temp');
  const qw = num('qw'), qx = num('qx'), qy = num('qy'), qz = num('qz');
  return {
    tMs: t ?? 0,
    ax, ay, az,
    gx, gy, gz,
    ...(mx !== undefined && my !== undefined && mz !== undefined ? { mx, my, mz } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(qw !== undefined && qx !== undefined && qy !== undefined && qz !== undefined
      ? { qw, qx, qy, qz }
      : {}),
  };
}
