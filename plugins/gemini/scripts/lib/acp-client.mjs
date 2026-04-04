import readline from "node:readline";

export class JsonRpcClient {
  constructor() {
    this.pending = new Map();
    this.nextId = 1;
    this.notificationHandler = null;
    this.serverRequestHandlers = new Map();
    this.closed = false;
    this.exitError = null;
    this._exitResolved = false;

    this.exitPromise = new Promise((resolve) => {
      this._resolveExit = resolve;
    });
  }

  setNotificationHandler(handler) {
    this.notificationHandler = handler;
  }

  onServerRequest(method, handler) {
    this.serverRequestHandlers.set(method, handler);
  }

  request(method, params) {
    if (this.closed) {
      return Promise.reject(new Error("ACP client is closed."));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.sendMessage({ jsonrpc: "2.0", id, method, params });
    });
  }

  notify(method, params) {
    if (this.closed) {
      return;
    }
    this.sendMessage({ jsonrpc: "2.0", method, params });
  }

  handleLine(line) {
    if (!line.trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    // Server-to-client request (has id AND method)
    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    // Response (has id, no method)
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);

      if (message.error) {
        const error = new Error(message.error.message ?? `ACP ${pending.method} failed.`);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    // Notification (no id, has method)
    if (message.method && this.notificationHandler) {
      this.notificationHandler(message);
    }
  }

  handleServerRequest(message) {
    const handler = this.serverRequestHandlers.get(message.method);
    if (handler) {
      Promise.resolve()
        .then(() => handler(message.params))
        .then((result) => {
          this.sendMessage({ jsonrpc: "2.0", id: message.id, result });
        })
        .catch((err) => {
          this.sendMessage({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: String(err?.message ?? err) }
          });
        });
    } else {
      this.sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unsupported server request: ${message.method}` }
      });
    }
  }

  handleExit(error) {
    if (this._exitResolved) {
      return;
    }
    this._exitResolved = true;

    this.closed = true;
    this.exitError = error ?? null;

    for (const pending of this.pending.values()) {
      pending.reject(this.exitError ?? new Error("ACP connection closed."));
    }
    this.pending.clear();
    this._resolveExit(undefined);
  }

  sendMessage(_message) {
    throw new Error("sendMessage must be implemented by subclass.");
  }
}

export class GeminiAcpClient extends JsonRpcClient {
  constructor(proc) {
    super();
    this.proc = proc;
    this.stderr = "";

    proc.stdout.setEncoding("utf8");
    if (proc.stderr) {
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk) => {
        this.stderr += chunk;
      });
    }

    this.rl = readline.createInterface({ input: proc.stdout });
    this.rl.on("line", (line) => {
      this.handleLine(line);
    });

    proc.on("error", (error) => {
      this.handleExit(error);
    });

    proc.on("exit", (code, signal) => {
      const detail = code === 0
        ? null
        : new Error(`ACP process exited unexpectedly (${signal ? `signal ${signal}` : `exit ${code}`}).`);
      this.handleExit(detail);
    });
  }

  sendMessage(message) {
    if (this.closed) {
      return;
    }
    try {
      this.proc.stdin.write(`${JSON.stringify(message)}\n`);
    } catch {
      // stdin may already be closed
    }
  }

  async close(opts = {}) {
    const { phase1Ms = 100, phase2Ms = 1500 } = opts;
    if (this.closed) {
      await this.exitPromise;
      return;
    }

    this.closed = true;

    try {
      this.rl.close();
    } catch {
      // ignore
    }
    try {
      this.proc.stdin.end();
    } catch {
      // ignore
    }

    await new Promise((resolve) => {
      const finish = () => {
        try {
          this.proc.stdout.destroy();
        } catch {
          // ignore
        }
        resolve();
      };

      const t1 = setTimeout(() => {
        try {
          this.proc.kill("SIGTERM");
        } catch {
          // ignore
        }
        const t2 = setTimeout(() => {
          try {
            this.proc.kill("SIGKILL");
          } catch {
            // ignore
          }
          finish();
        }, phase2Ms);
        this.proc.once("exit", () => {
          clearTimeout(t2);
          finish();
        });
      }, phase1Ms);

      this.proc.once("exit", () => {
        clearTimeout(t1);
        finish();
      });
    });

    // Only reject remaining pendings if handleExit hasn't already done it
    if (this.pending.size > 0) {
      for (const pending of this.pending.values()) {
        pending.reject(new Error("ACP client closed."));
      }
      this.pending.clear();
    }
    this._exitResolved = true;
    this._resolveExit(undefined);
  }

  get pid() {
    return this.proc.pid;
  }

  get exited() {
    return this.closed;
  }
}
