import {
  Profile,
  StringTable,
  Sample,
  Location,
  Function as PprofFunction,
  Line,
  ValueType,
} from "pprof-format";

/** Shape returned by bun:jsc samplingProfilerStackTraces() */
export interface JscFrame {
  sourceID: number;
  name: string;
  location: string;
  line: number;
  column: number;
  category: string;
  flags: number;
}

export interface JscTrace {
  timestamp: number;
  frames: JscFrame[];
}

export interface JscSource {
  sourceID: number;
  url?: string;
}

export interface JscProfileData {
  interval: number;
  traces: JscTrace[];
  sources: JscSource[];
}

const INVALID_LINE = 4294967295; // uint32 max, used by JSC for unknown locations

/**
 * Convert bun:jsc sampling profiler data to pprof Profile format.
 *
 * Each JSC trace becomes a pprof Sample. Frames are deduplicated into
 * shared Location/Function entries. The profile uses wall-time sample type.
 */
export function jscToPprof(data: JscProfileData): Profile {
  const stringTable = new StringTable();

  // Pre-populate string table index 0 with empty string (pprof convention)
  stringTable.dedup("");

  const samplesIdx = stringTable.dedup("samples");
  const countIdx = stringTable.dedup("count");
  const wallIdx = stringTable.dedup("wall");
  const nanosecondsIdx = stringTable.dedup("nanoseconds");

  // Build source ID -> URL map
  const sourceUrlMap = new Map<number, string>();
  for (const source of data.sources) {
    if (source.url) {
      sourceUrlMap.set(source.sourceID, source.url);
    }
  }

  // Deduplicate functions and locations
  // Key: "sourceID:name:line" -> function/location ID
  const functionMap = new Map<string, number>();
  const locationMap = new Map<string, number>();
  const functions: PprofFunction[] = [];
  const locations: Location[] = [];

  function getOrCreateFunction(frame: JscFrame): number {
    const line = frame.line === INVALID_LINE ? 0 : frame.line;
    const key = `${frame.sourceID}:${frame.name}:${line}`;
    const existing = functionMap.get(key);
    if (existing !== undefined) return existing;

    const id = functions.length + 1; // pprof IDs are 1-based
    const url = sourceUrlMap.get(frame.sourceID) ?? "";

    functions.push(
      PprofFunction.create({
        id,
        name: stringTable.dedup(frame.name || "(anonymous)"),
        systemName: stringTable.dedup(frame.name || "(anonymous)"),
        filename: stringTable.dedup(url),
        startLine: line,
      }),
    );

    functionMap.set(key, id);
    return id;
  }

  function getOrCreateLocation(frame: JscFrame): number {
    const line = frame.line === INVALID_LINE ? 0 : frame.line;
    const key = `${frame.sourceID}:${frame.name}:${line}:${frame.column}`;
    const existing = locationMap.get(key);
    if (existing !== undefined) return existing;

    const id = locations.length + 1;
    const funcId = getOrCreateFunction(frame);

    locations.push(
      Location.create({
        id,
        line: [
          Line.create({
            functionId: funcId,
            line: line,
          }),
        ],
      }),
    );

    locationMap.set(key, id);
    return id;
  }

  // Convert traces to samples
  // JSC frames are innermost-first, pprof locationId expects leaf-first too
  const samples: Sample[] = [];
  for (const trace of data.traces) {
    if (trace.frames.length === 0) continue;

    const locationIds: number[] = [];
    for (const frame of trace.frames) {
      locationIds.push(getOrCreateLocation(frame));
    }

    samples.push(
      Sample.create({
        locationId: locationIds,
        value: [1], // 1 sample count per trace
      }),
    );
  }

  const intervalNs = Math.round(data.interval * 1e9);

  return new Profile({
    sampleType: [
      ValueType.create({ type: samplesIdx, unit: countIdx }),
      ValueType.create({ type: wallIdx, unit: nanosecondsIdx }),
    ],
    sample: samples,
    location: locations,
    function: functions,
    stringTable,
    periodType: ValueType.create({ type: wallIdx, unit: nanosecondsIdx }),
    period: intervalNs,
  });
}
