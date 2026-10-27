import http from "node:http";
import https from "node:https";
import net from "node:net";
import { pipeline } from "node:stream";
import tls from "node:tls";
import type { AddressInfo } from "node:net";
import type { MockApiRequest, MockApiResponse } from "./auth.fixture";

/**
 * #919 — an origin of the specs' own, in front of the dev server, that answers
 * `/api/**` from the stand-in API and forwards everything else.
 *
 * Why it exists: once the app's service worker controls a page, WebKit sends
 * that page's `fetch()` calls through the worker, and Playwright's `page.route`
 * and `browserContext.route` never see them (#862, PR #880). They then reach
 * the real dev server, whose `/api/auth/me` answers 401. A spec that tests the
 * worker therefore cannot rely on routing for its API on WebKit. This server
 * sits on the network path instead, which every request crosses whether or not
 * a worker is in control, so the spec's `mockApiState` answers on every engine.
 *
 * It also carries a connection switch. While "down", it destroys every request
 * at the socket with no response, which a browser reports as a network error,
 * so the worker falls back to its cache and the app's `fetch()` rejects, as with
 * no connection. WebKit needs this: `page.reload()` under `context.setOffline`
 * throws there once a worker controls the page (PR #880).
 */
export type StandInOrigin = {
  /** `http://127.0.0.1:<port>` — the spec's `baseURL`. */
  url: string;
  /** Serve `/api/**` with this handler. Until set, the API answers 503; a
   *  handler that throws answers 500, so the spec sees the failure. */
  serveApi: (handler: (request: MockApiRequest) => MockApiResponse) => void;
  /** Drop every connection (true) or serve again (false). */
  setReachable: (reachable: boolean) => void;
  close: () => Promise<void>;
};

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

function parseJsonBody(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Start the origin. `upstream` is the dev server's base URL. */
export async function startStandInOrigin(upstream: string): Promise<StandInOrigin> {
  const target = new URL(upstream);
  const secure = target.protocol === "https:";
  if (!secure && target.protocol !== "http:") {
    throw new Error(`stand-in origin forwards to http(s) only, got ${upstream}`);
  }
  const targetPort = Number(target.port || (secure ? 443 : 80));
  const requestUpstream = secure ? https.request : http.request;
  const connectUpstream = (onConnect: () => void): net.Socket =>
    secure
      ? tls.connect({ host: target.hostname, port: targetPort, servername: target.hostname }, onConnect)
      : net.connect(targetPort, target.hostname, onConnect);

  let apiHandler: ((request: MockApiRequest) => MockApiResponse) | null = null;
  let reachable = true;
  /** Browser connections carrying plain requests: dropped while unreachable. */
  const sockets = new Set<net.Socket>();
  /** Upgraded WebSocket tunnels, both ends: closed only with the server. */
  const tunnels = new Set<net.Socket>();

  /** Headers for the upstream request: the dev server sees its own host, so
   *  it treats the request as same-origin, as it would without this hop. */
  function upstreamHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
    const out: http.OutgoingHttpHeaders = { ...headers, host: target.host };
    if (typeof headers.origin === "string") out.origin = target.origin;
    if (typeof headers.referer === "string") {
      try {
        const referer = new URL(headers.referer);
        out.referer = `${target.origin}${referer.pathname}${referer.search}`;
      } catch {
        delete out.referer;
      }
    }
    return out;
  }

  const server = http.createServer(async (request, response) => {
    if (!reachable) {
      request.socket.destroy();
      return;
    }
    const url = new URL(request.url ?? "/", "http://stand-in.invalid");

    if (url.pathname.startsWith("/api/")) {
      let text: string;
      try {
        text = await readBody(request);
      } catch {
        request.socket.destroy();
        return;
      }
      // The connection may have been dropped while the body was arriving.
      if (!reachable) {
        request.socket.destroy();
        return;
      }
      let reply: MockApiResponse;
      try {
        reply = apiHandler
          ? apiHandler({ method: request.method ?? "GET", pathname: url.pathname, body: parseJsonBody(text) })
          : { status: 503, body: { error: "stand-in API not ready" } };
      } catch (error) {
        reply = { status: 500, body: { error: `stand-in API threw: ${String(error)}` } };
      }
      const { status, body } = reply;
      response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      response.end(JSON.stringify(body));
      return;
    }

    const forwarded = requestUpstream(
      {
        hostname: target.hostname,
        port: targetPort,
        method: request.method,
        path: request.url,
        headers: upstreamHeaders(request.headers),
      },
      (upstreamResponse) => {
        // The connection was dropped (or the origin made unreachable) while the
        // dev server was still answering — the service worker's background
        // route-data refreshes (#967) can outlive a switch to offline. Piping
        // into the destroyed response would throw, so drop the answer instead.
        if (response.destroyed || !reachable) {
          upstreamResponse.destroy();
          request.socket.destroy();
          return;
        }
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
        // pipeline, not pipe: an upstream that closes mid-response errors its
        // stream, and this destroys the browser's response instead of leaving
        // it open or crashing the server on an unhandled error.
        pipeline(upstreamResponse, response, (error) => {
          if (error) request.socket.destroy();
        });
      },
    );
    forwarded.on("error", () => request.socket.destroy());
    pipeline(request, forwarded, (error) => {
      if (error) request.socket.destroy();
    });
  });

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });

  // Dev-server WebSockets (hot reload): piped through raw, so the dev client
  // keeps its connection instead of reloading the page to recover it.
  server.on("upgrade", (request, socket, head) => {
    if (!reachable) {
      socket.destroy();
      return;
    }
    // A tunnel is not a plain request: the switch below leaves it open, so a
    // dropped connection does not make the dev client reload the page.
    sockets.delete(socket as net.Socket);
    tunnels.add(socket as net.Socket);
    socket.on("close", () => tunnels.delete(socket as net.Socket));
    const upstreamSocket = connectUpstream(() => {
      const headers = upstreamHeaders(request.headers);
      const lines = [`${request.method} ${request.url} HTTP/${request.httpVersion}`];
      for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${item}`);
      }
      upstreamSocket.write(`${lines.join("\r\n")}\r\n\r\n`);
      if (head.length > 0) upstreamSocket.write(head);
      upstreamSocket.pipe(socket);
      socket.pipe(upstreamSocket);
    });
    tunnels.add(upstreamSocket);
    upstreamSocket.on("close", () => tunnels.delete(upstreamSocket));
    upstreamSocket.on("error", () => socket.destroy());
    socket.on("error", () => upstreamSocket.destroy());
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    serveApi: (handler) => {
      apiHandler = handler;
    },
    setReachable: (next) => {
      reachable = next;
      // Open keep-alive connections would otherwise keep answering.
      if (!next) for (const socket of sockets) socket.destroy();
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of [...sockets, ...tunnels]) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
