import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { Profile } from "pprof-format";
import {
  startSamplingProfiler,
  samplingProfilerStackTraces,
} from "bun:jsc";
import { jscToPprof, type JscProfileData } from "../src/convert.ts";

describe("end-to-end: bun:jsc -> pprof -> pyroscope ingest", () => {
  test("converts real JSC profiler data to valid pprof that Pyroscope can decode", () => {
    startSamplingProfiler(undefined, 100); // 100μs for lots of samples

    // Generate some CPU work
    function fibonacci(n: number): number {
      if (n <= 1) return n;
      return fibonacci(n - 1) + fibonacci(n - 2);
    }
    fibonacci(30);

    const data = samplingProfilerStackTraces() as JscProfileData;
    expect(data.traces.length).toBeGreaterThan(0);

    const profile = jscToPprof(data);

    // Encode to protobuf
    const encoded = profile.encode();
    expect(encoded.length).toBeGreaterThan(0);

    // Verify round-trip: decode should produce valid profile
    const decoded = Profile.decode(encoded);
    expect(decoded.sample.length).toBeGreaterThan(0);
    expect(decoded.function.length).toBeGreaterThan(0);
    expect(decoded.location.length).toBeGreaterThan(0);

    // Check we can find our fibonacci function
    const funcNames = decoded.function.map(
      (f) => decoded.stringTable.strings[Number(f.name)],
    );
    expect(funcNames).toContain("fibonacci");
  });

  test("gzipped pprof can be decoded (simulates Pyroscope ingest)", () => {
    // Collect fresh samples
    function doWork() {
      let sum = 0;
      for (let i = 0; i < 100000; i++) {
        sum += Math.sqrt(i);
      }
      return sum;
    }
    doWork();

    const data = samplingProfilerStackTraces() as JscProfileData;
    if (data.traces.length === 0) {
      // If no samples collected (unlikely but possible on fast machines), skip
      return;
    }

    const profile = jscToPprof(data);
    const encoded = profile.encode();
    const gzipped = Bun.gzipSync(encoded);

    // Simulate what Pyroscope server does: gunzip + decode
    const decompressed = gunzipSync(gzipped);
    const decoded = Profile.decode(new Uint8Array(decompressed));

    expect(decoded.sample.length).toBeGreaterThan(0);
    expect(decoded.sampleType.length).toBe(2);

    // Verify sample types
    const sampleTypeNames = decoded.sampleType.map(
      (st) => decoded.stringTable.strings[Number(st.type)],
    );
    expect(sampleTypeNames).toContain("samples");
    expect(sampleTypeNames).toContain("wall");
  });
});
