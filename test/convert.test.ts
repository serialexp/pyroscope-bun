import { describe, expect, test } from "bun:test";
import { jscToPprof, type JscProfileData } from "../src/convert.ts";

describe("jscToPprof", () => {
  test("converts a simple profile with one trace", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [
        {
          timestamp: 1000.0,
          frames: [
            {
              sourceID: 1,
              name: "inner",
              location: "#abc:Baseline:bc#10",
              line: 10,
              column: 5,
              category: "Baseline",
              flags: 0,
            },
            {
              sourceID: 1,
              name: "outer",
              location: "#abc:Baseline:bc#20",
              line: 20,
              column: 1,
              category: "Baseline",
              flags: 0,
            },
          ],
        },
      ],
      sources: [{ sourceID: 1, url: "/app/index.ts" }],
    };

    const profile = jscToPprof(data);

    // Should have 1 sample with 2 location IDs
    expect(profile.sample.length).toBe(1);
    expect(profile.sample[0]!.locationId.length).toBe(2);

    // Should have 2 functions
    expect(profile.function.length).toBe(2);

    // Check function names are in string table
    const innerFunc = profile.function[0]!;
    expect(profile.stringTable.strings[Number(innerFunc.name)]).toBe("inner");
    expect(profile.stringTable.strings[Number(innerFunc.filename)]).toBe(
      "/app/index.ts",
    );

    const outerFunc = profile.function[1]!;
    expect(profile.stringTable.strings[Number(outerFunc.name)]).toBe("outer");

    // Should have 2 locations
    expect(profile.location.length).toBe(2);

    // Period should be 1ms = 1_000_000 ns
    expect(profile.period).toBe(1_000_000);

    // Sample types: samples/count and wall/nanoseconds
    expect(profile.sampleType.length).toBe(2);
  });

  test("sample value count matches sampleType count", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [
        {
          timestamp: 1.0,
          frames: [
            {
              sourceID: 1,
              name: "work",
              location: "#x:Baseline:bc#1",
              line: 1,
              column: 1,
              category: "Baseline",
              flags: 0,
            },
          ],
        },
        {
          timestamp: 1.001,
          frames: [
            {
              sourceID: 1,
              name: "work",
              location: "#x:Baseline:bc#1",
              line: 1,
              column: 1,
              category: "Baseline",
              flags: 0,
            },
          ],
        },
      ],
      sources: [{ sourceID: 1, url: "/app/test.ts" }],
    };

    const profile = jscToPprof(data);
    const expectedValueCount = profile.sampleType.length;

    for (const sample of profile.sample) {
      expect(sample.value.length).toBe(expectedValueCount);
    }
  });

  test("sample values contain correct count and wall time", () => {
    const data: JscProfileData = {
      interval: 0.0001, // 100μs = 100_000ns
      traces: [
        {
          timestamp: 1.0,
          frames: [
            {
              sourceID: 1,
              name: "fn",
              location: "#x:Baseline:bc#1",
              line: 1,
              column: 1,
              category: "Baseline",
              flags: 0,
            },
          ],
        },
      ],
      sources: [{ sourceID: 1, url: "/app/test.ts" }],
    };

    const profile = jscToPprof(data);
    const sample = profile.sample[0]!;

    // First value: sample count = 1
    expect(Number(sample.value[0])).toBe(1);
    // Second value: wall time in nanoseconds = interval
    expect(Number(sample.value[1])).toBe(100_000);
  });

  test("different intervals produce correct wall time values", () => {
    for (const interval of [0.001, 0.01, 0.0001]) {
      const data: JscProfileData = {
        interval,
        traces: [
          {
            timestamp: 1.0,
            frames: [
              {
                sourceID: 1,
                name: "fn",
                location: "#x:Baseline:bc#1",
                line: 1,
                column: 1,
                category: "Baseline",
                flags: 0,
              },
            ],
          },
        ],
        sources: [{ sourceID: 1, url: "/app/test.ts" }],
      };

      const profile = jscToPprof(data);
      const expectedNs = Math.round(interval * 1e9);

      expect(Number(profile.sample[0]!.value[1])).toBe(expectedNs);
      expect(Number(profile.period)).toBe(expectedNs);
    }
  });

  test("deduplicates identical frames across traces", () => {
    const frame = {
      sourceID: 1,
      name: "handler",
      location: "#x:Baseline:bc#5",
      line: 5,
      column: 1,
      category: "Baseline",
      flags: 0,
    };

    const data: JscProfileData = {
      interval: 0.001,
      traces: [
        { timestamp: 1.0, frames: [frame] },
        { timestamp: 1.001, frames: [frame] },
        { timestamp: 1.002, frames: [frame] },
      ],
      sources: [{ sourceID: 1, url: "/app/handler.ts" }],
    };

    const profile = jscToPprof(data);

    // 3 samples but only 1 unique function and location
    expect(profile.sample.length).toBe(3);
    expect(profile.function.length).toBe(1);
    expect(profile.location.length).toBe(1);

    // All samples reference the same location
    for (const sample of profile.sample) {
      expect(sample.locationId).toEqual([1]);
    }
  });

  test("handles frames with no source URL (builtins)", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [
        {
          timestamp: 1.0,
          frames: [
            {
              sourceID: 99,
              name: "promiseReactionJob",
              location: "#x:LLInt:bc#60",
              line: 1,
              column: 11,
              category: "LLInt",
              flags: 1,
            },
          ],
        },
      ],
      sources: [{ sourceID: 99 }],
    };

    const profile = jscToPprof(data);

    expect(profile.sample.length).toBe(1);
    expect(profile.function.length).toBe(1);
    // Builtin function should have empty filename
    expect(profile.stringTable.strings[Number(profile.function[0]!.filename)]).toBe("");
  });

  test("handles invalid line numbers (uint32 max)", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [
        {
          timestamp: 1.0,
          frames: [
            {
              sourceID: 1,
              name: "native",
              location: "#x:LLInt:bc#0",
              line: 4294967295,
              column: 4294967295,
              category: "LLInt",
              flags: 0,
            },
          ],
        },
      ],
      sources: [{ sourceID: 1, url: "/app/test.ts" }],
    };

    const profile = jscToPprof(data);

    // Line should be normalized to 0
    expect(Number(profile.location[0]!.line[0]!.line)).toBe(0);
    expect(Number(profile.function[0]!.startLine)).toBe(0);
  });

  test("handles empty traces", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [],
      sources: [],
    };

    const profile = jscToPprof(data);
    expect(profile.sample.length).toBe(0);
    expect(profile.function.length).toBe(0);
    expect(profile.location.length).toBe(0);
  });

  test("skips traces with zero frames", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [{ timestamp: 1.0, frames: [] }],
      sources: [],
    };

    const profile = jscToPprof(data);
    expect(profile.sample.length).toBe(0);
  });

  test("produces valid encodable pprof", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [
        {
          timestamp: 1.0,
          frames: [
            {
              sourceID: 1,
              name: "doWork",
              location: "#x:DFG:bc#5",
              line: 42,
              column: 10,
              category: "DFG",
              flags: 0,
            },
          ],
        },
      ],
      sources: [{ sourceID: 1, url: "/app/worker.ts" }],
    };

    const profile = jscToPprof(data);

    // encode() should not throw and should produce a non-empty buffer
    const encoded = profile.encode();
    expect(encoded.length).toBeGreaterThan(0);
  });

  test("handles anonymous functions", () => {
    const data: JscProfileData = {
      interval: 0.001,
      traces: [
        {
          timestamp: 1.0,
          frames: [
            {
              sourceID: 1,
              name: "",
              location: "#x:Baseline:bc#5",
              line: 5,
              column: 1,
              category: "Baseline",
              flags: 0,
            },
          ],
        },
      ],
      sources: [{ sourceID: 1, url: "/app/index.ts" }],
    };

    const profile = jscToPprof(data);
    expect(
      profile.stringTable.strings[Number(profile.function[0]!.name)],
    ).toBe("(anonymous)");
  });
});
