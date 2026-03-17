# pyroscope-bun

Continuous profiling for Bun applications with [Pyroscope](https://pyroscope.io/) as the backend.

Uses JavaScriptCore's built-in sampling profiler (`bun:jsc`) — zero native dependencies, works on any platform Bun supports.

## Installation

```bash
bun add pyroscope-bun
```

## Quick Start

```typescript
import { start, stop } from "pyroscope-bun";

start({
  serverAddress: "http://localhost:4040",
  appName: "my-app",
});

// Your application code...

// Optional: stop profiling and flush remaining data
process.on("SIGTERM", () => stop());
```

## Configuration

```typescript
start({
  // Required
  serverAddress: "http://pyroscope:4040",
  appName: "my-app",

  // Optional: sampling interval in microseconds (default: 1000 = 1ms)
  samplingIntervalMicros: 1000,

  // Optional: how often to flush to Pyroscope in ms (default: 10000 = 10s)
  flushIntervalMs: 10_000,

  // Optional: authentication
  authToken: "Bearer token",
  // or
  basicAuthUser: "user",
  basicAuthPassword: "pass",

  // Optional: multi-tenant Pyroscope
  tenantID: "my-tenant",
});
```

## How It Works

1. Starts JavaScriptCore's sampling profiler via `bun:jsc`
2. Periodically flushes collected stack samples
3. Converts JSC's frame format to [pprof](https://github.com/google/pprof) protobuf
4. POSTs gzipped profiles to Pyroscope's `/ingest` HTTP API

The profiler collects wall-time samples at configurable intervals. Flushes are fire-and-forget to avoid blocking your application.

## Advanced Usage

### Using the converter directly

If you want to collect profiles without sending them to Pyroscope:

```typescript
import { samplingProfilerStackTraces, startSamplingProfiler } from "bun:jsc";
import { jscToPprof } from "pyroscope-bun";

startSamplingProfiler(undefined, 1000);

// ... do work ...

const data = samplingProfilerStackTraces();
const profile = jscToPprof(data);
const encoded = profile.encode(); // raw pprof protobuf
```

### Using the exporter directly

```typescript
import { PyroscopeExporter } from "pyroscope-bun";

const exporter = new PyroscopeExporter({
  serverAddress: "http://pyroscope:4040",
  appName: "my-app",
});

await exporter.send(profile, startTime, endTime, sampleRate);
```

## Requirements

- Bun >= 1.0

## License

ISC
