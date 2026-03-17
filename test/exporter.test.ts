import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { Profile } from "pprof-format";
import { PyroscopeExporter } from "../src/exporter.ts";
import { jscToPprof, type JscProfileData } from "../src/convert.ts";

function makeTestProfile(): Profile {
  const data: JscProfileData = {
    interval: 0.001,
    traces: [
      {
        timestamp: 1.0,
        frames: [
          {
            sourceID: 1,
            name: "testFunc",
            location: "#x:Baseline:bc#10",
            line: 10,
            column: 1,
            category: "Baseline",
            flags: 0,
          },
        ],
      },
    ],
    sources: [{ sourceID: 1, url: "/app/test.ts" }],
  };
  return jscToPprof(data);
}

describe("PyroscopeExporter", () => {
  test("sends gzipped pprof to /ingest endpoint", async () => {
    let capturedUrl: string | undefined;
    let capturedFormData: FormData | undefined;

    // Spin up a local HTTP server to capture the request
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        capturedUrl = req.url;
        capturedFormData = await req.formData();
        return new Response("ok", { status: 200 });
      },
    });

    try {
      const exporter = new PyroscopeExporter({
        serverAddress: `http://localhost:${server.port}`,
        appName: "test-app",
      });

      const profile = makeTestProfile();
      const start = new Date("2024-01-01T00:00:00Z");
      const stop = new Date("2024-01-01T00:00:10Z");

      await exporter.send(profile, start, stop, 1000);

      expect(capturedUrl).toBeDefined();
      const url = new URL(capturedUrl!);
      expect(url.pathname).toBe("/ingest");
      expect(url.searchParams.get("name")).toBe("test-app");
      expect(url.searchParams.get("spyName")).toBe("bunspy");
      expect(url.searchParams.get("from")).toBe("1704067200");
      expect(url.searchParams.get("until")).toBe("1704067210");
      expect(url.searchParams.get("sampleRate")).toBe("1000");

      // Verify the body is a valid gzipped pprof profile
      expect(capturedFormData).toBeDefined();
      const blob = capturedFormData!.get("profile") as Blob;
      expect(blob).toBeDefined();

      const compressed = new Uint8Array(await blob.arrayBuffer());
      const decompressed = gunzipSync(compressed);
      const decoded = Profile.decode(decompressed);
      expect(decoded.sample.length).toBe(1);
    } finally {
      server.stop();
    }
  });

  test("sends auth token header", async () => {
    let capturedHeaders: Headers | undefined;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        capturedHeaders = req.headers;
        return new Response("ok");
      },
    });

    try {
      const exporter = new PyroscopeExporter({
        serverAddress: `http://localhost:${server.port}`,
        appName: "test-app",
        authToken: "my-secret-token",
      });

      await exporter.send(
        makeTestProfile(),
        new Date(),
        new Date(),
      );

      expect(capturedHeaders?.get("authorization")).toBe(
        "Bearer my-secret-token",
      );
    } finally {
      server.stop();
    }
  });

  test("sends basic auth header", async () => {
    let capturedHeaders: Headers | undefined;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        capturedHeaders = req.headers;
        return new Response("ok");
      },
    });

    try {
      const exporter = new PyroscopeExporter({
        serverAddress: `http://localhost:${server.port}`,
        appName: "test-app",
        basicAuthUser: "user",
        basicAuthPassword: "pass",
      });

      await exporter.send(
        makeTestProfile(),
        new Date(),
        new Date(),
      );

      expect(capturedHeaders?.get("authorization")).toBe(
        `Basic ${btoa("user:pass")}`,
      );
    } finally {
      server.stop();
    }
  });

  test("sends tenant ID header", async () => {
    let capturedHeaders: Headers | undefined;

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        capturedHeaders = req.headers;
        return new Response("ok");
      },
    });

    try {
      const exporter = new PyroscopeExporter({
        serverAddress: `http://localhost:${server.port}`,
        appName: "test-app",
        tenantID: "my-tenant",
      });

      await exporter.send(
        makeTestProfile(),
        new Date(),
        new Date(),
      );

      expect(capturedHeaders?.get("x-scope-orgid")).toBe("my-tenant");
    } finally {
      server.stop();
    }
  });

  test("handles server errors gracefully", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("internal error", { status: 500 });
      },
    });

    try {
      const exporter = new PyroscopeExporter({
        serverAddress: `http://localhost:${server.port}`,
        appName: "test-app",
      });

      // Should not throw
      await exporter.send(
        makeTestProfile(),
        new Date(),
        new Date(),
      );
    } finally {
      server.stop();
    }
  });

  test("handles connection errors gracefully", async () => {
    const exporter = new PyroscopeExporter({
      serverAddress: "http://localhost:1", // unlikely to be listening
      appName: "test-app",
    });

    // Should not throw
    await exporter.send(
      makeTestProfile(),
      new Date(),
      new Date(),
    );
  });
});
