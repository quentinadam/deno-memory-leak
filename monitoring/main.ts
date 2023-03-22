import { loadEnv } from './deps.ts';

function indexOf(haystack: Uint8Array, needle: Uint8Array) {
  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let found = true;
    for (let j = 0; j < needle.length; j++) {
      if (needle[j] !== haystack[i + j]) {
        found = false;
        break;
      }
    }
    if (found) {
      return i;
    }
  }
}

function concat(buffers: Uint8Array[]) {
  const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const result = new Uint8Array(length);
  buffers.reduce((offset, buffer) => {
    result.set(buffer, offset);
    return offset + buffer.length;
  }, 0);
  return result;
}

async function repeat(fn: () => Promise<void> | void, interval: number) {
  while (true) {
    const start = Date.now();
    try {
      await fn();
    } catch (error) {
      console.error(error);
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, start + interval - Date.now())));
  }
}

function require<T>(value: T | undefined): T {
  if (value !== undefined) {
    return value;
  }
  throw new Error('Value is undefined');
}

class BufferReader {
  #buffer = new Uint8Array();
  readonly #connection;

  constructor(connection: Deno.UnixConn) {
    this.#connection = connection;
  }

  async #read() {
    const buffer = new Uint8Array(65536);
    const length = await this.#connection.read(buffer);
    if (length === null) {
      throw new Error('EOF');
    }
    this.#buffer = concat([this.#buffer, buffer.slice(0, length)]);
  }

  async readLine() {
    const needle = new Uint8Array([13, 10]);
    while (true) {
      const index = indexOf(this.#buffer, needle);
      if (index !== undefined) {
        const line = new TextDecoder().decode(this.#buffer.slice(0, index));
        this.#buffer = this.#buffer.slice(index + needle.length);
        return line;
      }
      await this.#read();
    }
  }

  async read(length: number) {
    while (true) {
      if (this.#buffer.length >= length) {
        const buffer = this.#buffer.slice(0, length);
        this.#buffer = this.#buffer.slice(length);
        return buffer;
      }
      await this.#read();
    }
  }
}

class HttpRequester {
  readonly #connection;
  readonly #host;

  constructor(connection: Deno.Conn, host: string) {
    this.#connection = connection;
    this.#host = host;
  }

  async get(path: string) {
    const request = `GET ${path} HTTP/1.1\r\nHost: ${this.#host}\r\nConnection: close\r\n\r\n`;
    this.#connection.write(new TextEncoder().encode(request));
    const reader = new BufferReader(this.#connection);
    await reader.readLine();
    const headers = new Array<{ key: string; value: string }>();
    while (true) {
      const line = await reader.readLine();
      if (line.length === 0) {
        break;
      }
      const match = line.match(/^\s*(.*)\s*:\s*(.*)\s*$/);
      if (match === null) {
        throw new Error(`Invalid header ${line}`);
      }
      headers.push({ key: match[1].toLowerCase(), value: match[2] });
    }

    let header: { key: string; value: string } | undefined;
    if ((header = headers.find(({ key }) => key === 'content-length')) !== undefined) {
      return await reader.read(parseInt(header.value, 10));
    }

    if (headers.find(({ key, value }) => key === 'transfer-encoding' && value === 'chunked') !== undefined) {
      const chunks = new Array<Uint8Array>();
      while (true) {
        const length = parseInt(await reader.readLine(), 16);
        if (length === 0) {
          break;
        }
        chunks.push(await reader.read(length));
        await reader.read(2);
      }
      return concat(chunks);
    }

    throw new Error('Unsupported response');
  }
}

class Docker {
  async request<T>(path: string): Promise<T> {
    const connection = await Deno.connect({
      transport: 'unix',
      path: '/var/run/docker.sock',
    });
    const requester = new HttpRequester(connection, 'docker');
    const response = await requester.get(path);
    return JSON.parse(new TextDecoder().decode(response));
  }

  async getContainers() {
    return await this.request<{ Id: string; Names: string[]; Image: string }[]>('/containers/json');
  }

  async getContainerStats(id: string) {
    return await this.request<{ memory_stats: { usage: number} }>(
      `/containers/${id}/stats?stream=false`,
    );
  }
}

class InfluxDB {
  readonly #host;
  readonly #org;
  readonly #bucket;
  readonly #token;

  constructor(
    options?: { host?: string; org?: string; bucket?: string; token?: string },
  ) {
    this.#host = require(options?.host ?? Deno.env.get('INFLUX_HOST'));
    this.#org = require(options?.org ?? Deno.env.get('INFLUX_ORG'));
    this.#bucket = require(options?.bucket ?? Deno.env.get('INFLUX_BUCKET'));
    this.#token = require(options?.token ?? Deno.env.get('INFLUX_TOKEN'));
  }

  async write(points: {
    measurement: string;
    tags: { [key: string]: string | number };
    fields: { [key: string]: string | number };
    timestamp?: Date;
  }[]) {
    if (points.length > 0) {
      const timestamp = new Date();
      const format = (pairs: { [key: string]: string | number }) => {
        return Object.entries(pairs).map(([key, value]) => `${key}=${value}`).join(',');
      };
      const lines = points.map((point) => {
        const line = `${point.measurement},${format(point.tags)} ${format(point.fields)} ${
          BigInt((point.timestamp ?? timestamp).valueOf()) * 1000000n
        }`;
        console.log(line);
        return line;
      });
      const url = `${this.#host}/api/v2/write?org=${this.#org}&bucket=${this.#bucket}&precision=ns`;
      const parameters = {
        method: 'POST',
        headers: {
          authorization: `Token ${this.#token}`,
          'content-type': 'text/plain',
        },
        body: lines.join('\n'),
      };
      const response = await fetch(url, parameters);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }
    }
  }
}

await loadEnv({ export: true });

const influx = new InfluxDB();
const docker = new Docker();

repeat(async () => {
  const containers = await docker.getContainers();
  const points = await Promise.all(containers.map(async (container) => {
    const id = container.Id;
    const name = container.Names[0].slice(1);
    const stats = await docker.getContainerStats(id);
    return {
      measurement: 'memory',
      tags: { container: name },
      fields: { usage: stats.memory_stats.usage },
    };
  }));
  await influx.write(points);
}, 10000);
