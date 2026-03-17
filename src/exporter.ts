import { gzipSync } from "node:zlib";
import type { Profile } from "pprof-format";

export interface PyroscopeExporterConfig {
  serverAddress: string;
  appName: string;
  authToken?: string;
  basicAuthUser?: string;
  basicAuthPassword?: string;
  tenantID?: string;
}

export class PyroscopeExporter {
  private readonly config: PyroscopeExporterConfig;

  constructor(config: PyroscopeExporterConfig) {
    this.config = config;
  }

  async send(
    profile: Profile,
    startedAt: Date,
    stoppedAt: Date,
    sampleRate?: number,
  ): Promise<void> {
    const url = this.buildUrl(startedAt, stoppedAt, sampleRate);
    const headers = this.buildHeaders();
    const encoded = gzipSync(profile.encode());

    const formData = new FormData();
    formData.append("profile", new Blob([encoded]), "profile");

    try {
      const response = await fetch(url, {
        method: "POST",
        body: formData,
        headers,
      });

      if (!response.ok) {
        const body = await response.text();
        console.error(
          `Pyroscope ingest failed (HTTP ${response.status}): ${body}`,
        );
      }
    } catch (error) {
      console.error(
        `Pyroscope ingest error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private buildUrl(
    startedAt: Date,
    stoppedAt: Date,
    sampleRate?: number,
  ): string {
    const url = new URL(`${this.config.serverAddress}/ingest`);
    url.searchParams.set(
      "from",
      Math.floor(startedAt.getTime() / 1000).toString(),
    );
    url.searchParams.set(
      "until",
      Math.floor(stoppedAt.getTime() / 1000).toString(),
    );
    url.searchParams.set("name", this.config.appName);
    url.searchParams.set("spyName", "bunspy");
    if (sampleRate !== undefined) {
      url.searchParams.set("sampleRate", sampleRate.toString());
    }
    return url.toString();
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};

    if (this.config.authToken) {
      headers["authorization"] = `Bearer ${this.config.authToken}`;
    } else if (this.config.basicAuthUser && this.config.basicAuthPassword) {
      const encoded = btoa(
        `${this.config.basicAuthUser}:${this.config.basicAuthPassword}`,
      );
      headers["authorization"] = `Basic ${encoded}`;
    }

    if (this.config.tenantID) {
      headers["X-Scope-OrgID"] = this.config.tenantID;
    }

    return headers;
  }
}
