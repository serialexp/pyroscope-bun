declare module "bun:jsc" {
  export function startSamplingProfiler(
    directory?: string,
    intervalMicroseconds?: number,
  ): void;
  export function samplingProfilerStackTraces(): unknown;
}
