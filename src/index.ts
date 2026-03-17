import {
  startSamplingProfiler,
  samplingProfilerStackTraces,
} from "bun:jsc";
import { jscToPprof } from "./convert.ts";
import type { JscProfileData } from "./convert.ts";
import { PyroscopeExporter, type PyroscopeExporterConfig } from "./exporter.ts";

export type { PyroscopeExporterConfig } from "./exporter.ts";
export { jscToPprof } from "./convert.ts";
export { PyroscopeExporter } from "./exporter.ts";

export interface PyroscopeConfig extends PyroscopeExporterConfig {
  /**
   * Sampling interval in microseconds. Default: 1000 (1ms).
   */
  samplingIntervalMicros?: number;

  /**
   * How often to flush profiles to Pyroscope, in milliseconds. Default: 10000 (10s).
   */
  flushIntervalMs?: number;
}

let flushTimer: ReturnType<typeof setInterval> | undefined;
let lastFlushTime: Date | undefined;
let currentConfig: PyroscopeConfig | undefined;
let exporter: PyroscopeExporter | undefined;

/**
 * Start continuous profiling and send profiles to Pyroscope.
 *
 * Uses bun:jsc's built-in JavaScriptCore sampling profiler.
 * Periodically flushes collected samples, converts them to pprof format,
 * and POSTs them to Pyroscope's /ingest endpoint.
 */
export function start(config: PyroscopeConfig): void {
  if (flushTimer) {
    console.warn("pyroscope-bun: already started, call stop() first");
    return;
  }

  currentConfig = config;
  exporter = new PyroscopeExporter(config);

  const intervalMicros = config.samplingIntervalMicros ?? 1000;
  const flushMs = config.flushIntervalMs ?? 10_000;

  startSamplingProfiler(undefined, intervalMicros);
  lastFlushTime = new Date();

  // Do an initial flush to discard any startup noise
  samplingProfilerStackTraces();

  // biome-ignore lint/suspicious/noConsoleLog: want to confirm profiling is active
  console.log(
    `pyroscope-bun: profiling started (interval=${intervalMicros}μs, flush=${flushMs}ms)`,
  );

  flushTimer = setInterval(() => {
    flush();
  }, flushMs);

  // Ensure timer doesn't prevent process exit
  if (flushTimer && "unref" in flushTimer) {
    flushTimer.unref();
  }
}

/**
 * Stop continuous profiling. Performs a final flush.
 */
export function stop(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = undefined;
  }
  // Final flush
  flush();
  exporter = undefined;
  currentConfig = undefined;
}

function flush(): void {
  if (!exporter || !lastFlushTime) return;

  const data = samplingProfilerStackTraces() as JscProfileData;

  if (!data.traces || data.traces.length === 0) return;

  const startedAt = lastFlushTime;
  const stoppedAt = new Date();
  lastFlushTime = stoppedAt;

  const sampleRate =
    data.interval > 0 ? Math.round(1 / data.interval) : undefined;

  const profile = jscToPprof(data);

  // Fire and forget — don't block the profiling loop
  exporter.send(profile, startedAt, stoppedAt, sampleRate).catch((err) => {
    console.error("pyroscope-bun: flush error:", err);
  });
}
