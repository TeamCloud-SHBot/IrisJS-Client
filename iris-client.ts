// iris_client.ts
import express, { Express, Request, Response } from "express";
import axios, { AxiosInstance } from "axios";

export type EventName =
  | "message"
  | "join"
  | "leave"
  | "kick"
  | "delete"
  | "hide"
  | "error";

export interface IrisWebhookBody {
  room?: string;
  msg?: any;
  sender?: string;
  json?: Record<string, any>;
  [k: string]: any;
}

export interface BotEvent {
  raw: IrisWebhookBody;
  user: any | null;
  channel: any | null;
  message: any | null;
  send(text: string): Promise<any>;
}

export interface BotErrorEvent {
  error: unknown;
  event?: string;
  raw?: any;
}

class IrisAPI {
  private http: AxiosInstance;

  constructor(baseUrl: string) {
    const clean = String(baseUrl || "").replace(/\/+$/, "");
    this.http = axios.create({
      baseURL: clean,
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  }

  async reply(payload: { type: string; roomId: string; data: string }) {
    const res = await this.http.post("/reply", {
      type: String(payload.type),
      roomId: String(payload.roomId),
      data: String(payload.data),
    });
    return res.data;
  }

  async query(query: string, bind: any[] = []) {
    const res = await this.http.post("/query", { query, bind });
    return res.data; // { success, message, data: [...] }
  }

  async aot() {
    const res = await this.http.get("/aot");
    return res.data;
  }
}

function createIrisDB(iris: IrisAPI) {
  return {
    async user(userId: string | number) {
      if (!userId) return null;
      const r = await iris.query(
        "SELECT * FROM open_chat_member WHERE user_id = ?",
        [userId]
      );
      return (r?.data && r.data[0]) || null;
    },

    async channel(chatId: string | number) {
      if (!chatId) return null;
      const r = await iris.query("SELECT * FROM chat_rooms WHERE id = ?", [
        chatId,
      ]);
      return (r?.data && r.data[0]) || null;
    },

    async log(msgId: string | number) {
      if (!msgId) return null;
      const r = await iris.query("SELECT * FROM chat_logs WHERE id = ?", [
        msgId,
      ]);
      return (r?.data && r.data[0]) || null;
    },
  };
}

function quoteBigIntIds(text: string) {
  const keys = [
    "src_logId",
    "src_userId",
    "user_id",
    "chat_id",
    "id",
    "prev_id",
    "client_message_id",
    "src_id",
    "msg_id",
  ];

  const pattern = new RegExp(
    `"(${keys.join("|")})"\\s*:\\s*(-?\\d{15,})(?=\\s*[,}\\]])`,
    "g"
  );

  return String(text).replace(pattern, (_m, k, num) => `"${k}":"${num}"`);
}

function safeJsonParse<T>(value: any, fallback: T): T {
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function nestedJson(body: IrisWebhookBody): IrisWebhookBody {
  if (!body || typeof body !== "object") return body;

  if (typeof body.msg === "string") {
    body.msg = safeJsonParse<any>(body.msg, body.msg);
  }

  if (body.json && typeof body.json === "object") {
    for (const key of ["message", "attachment", "v"]) {
      const v = body.json[key];
      if (typeof v === "string") {
        const src = key === "attachment" ? quoteBigIntIds(v) : v;
        body.json[key] = safeJsonParse<any>(src, v);
      }
    }
  }

  return body;
}

export class Bot {
  private iris: IrisAPI;
  private irisDB: ReturnType<typeof createIrisDB>;

  private app: Express;
  private server: any;

  private bindHost: string;
  private listenPort: number;

  private endpointMessage: string;
  private endpointReply: string;

  private listeners: Record<EventName, Array<(event: any) => any>> = {
    message: [],
    join: [],
    leave: [],
    kick: [],
    delete: [],
    hide: [],
    error: [],
  };

  constructor(
    irisHost: string,
    listenPort: number,
    opts?: {
      bindHost?: string;
      endpointMessage?: string;
      endpointReply?: string;
    }
  ) {
    this.bindHost = opts?.bindHost ?? "0.0.0.0";
    this.listenPort = Number(listenPort);

    this.endpointMessage = opts?.endpointMessage ?? "/message";
    this.endpointReply = opts?.endpointReply ?? "/reply";

    this.iris = new IrisAPI(`http://${irisHost}:3000`);
    this.irisDB = createIrisDB(this.iris);

    this.app = express();
    this.app.use(express.json({ limit: "2mb" }));

    this.app.post(this.endpointMessage, async (req: any, res: any) => {
      await this.handleMessage(req, res);
    });

    this.app.post(this.endpointReply, async (req: any, res: any) => {
      await this.handleReply(req, res);
    });
  }

  onEvent(name: "message", handler: (event: BotEvent) => any): void;
  onEvent(name: "join", handler: (event: BotEvent) => any): void;
  onEvent(name: "leave", handler: (event: BotEvent) => any): void;
  onEvent(name: "kick", handler: (event: BotEvent) => any): void;
  onEvent(name: "delete", handler: (event: BotEvent) => any): void;
  onEvent(name: "hide", handler: (event: BotEvent) => any): void;
  onEvent(name: "error", handler: (event: BotErrorEvent) => any): void;
  onEvent(name: EventName, handler: (event: any) => any): void {
    this.listeners[name].push(handler);
  }

  private async emit(name: EventName, payload: any) {
    for (const fn of this.listeners[name]) {
      try {
        await Promise.resolve(fn(payload));
      } catch (err) {
        if (name !== "error") {
          await this.emit("error", {
            error: err,
            event: name,
            raw: payload?.raw,
          } as BotErrorEvent);
        }
      }
    }
  }

  private detectEvent(body: IrisWebhookBody): Exclude<EventName, "error"> | null {
    const json = body?.json || {};
    const type = String(json.type ?? "");

    if (type === "1") return "message";

    if (type === "0") {
      const feedType = Number(json?.feedType) || Number(json?.message?.feedType) || 0;

      if (feedType === 4) return "join";
      if (feedType === 2) return "leave";
      if (feedType === 6) return "kick";
      if (feedType === 14) return "delete";
      if (feedType === 26) return "hide";
    }

    return null;
  }

  private async buildEvent(body: IrisWebhookBody): Promise<BotEvent> {
    const json = body?.json || {};

    const chatId = json.chat_id ?? json.roomId ?? json.room ?? body.room;
    const userId = json.user_id ?? json.userId;

    const msgId = json.msg_id ?? json.id;

    const [user, channel, message] = await Promise.all([
      this.irisDB.user(userId),
      this.irisDB.channel(chatId),
      this.irisDB.log(msgId),
    ]);

    return {
      raw: body,
      user,
      channel,
      message,
      send: async (text: string) => {
        if (!chatId) throw new Error("chat_id 없음");
        return this.iris.reply({
          type: "text",
          roomId: String(chatId),
          data: String(text),
        });
      },
    };
  }

  private async handleMessage(req: Request, res: Response) {
    try {
      const body = nestedJson((req.body || {}) as IrisWebhookBody);
      const evName = this.detectEvent(body);

      if (!evName) {
        res.json({ ok: true, ignored: true });
        return;
      }

      const ev = await this.buildEvent(body);
      await this.emit(evName, ev);

      res.json({ ok: true, event: evName });
    } catch (err) {
      await this.emit("error", {
        error: err,
        event: "webhook",
        raw: req.body,
      } as BotErrorEvent);
      res.status(500).json({ ok: false, error: String(err) });
    }
  }

  private async handleReply(req: Request, res: Response) {
    try {
      const body = (req.body || {}) as any;

      const type = body.type;
      const roomId = body.roomId ?? body.room;
      const data = body.data;

      if (type == null || roomId == null || data == null) {
        res.status(400).json({ ok: false, error: "type/roomId/data 필요" });
        return;
      }

      const irisRes = await this.iris.reply({
        type: String(type),
        roomId: String(roomId),
        data: String(data),
      });

      res.json({ ok: true, forwarded: true, iris: irisRes });
    } catch (err) {
      await this.emit("error", {
        error: err,
        event: "reply",
        raw: req.body,
      } as BotErrorEvent);
      res.status(500).json({ ok: false, error: String(err) });
    }
  }

  start() {
    this.server = this.app.listen(this.listenPort, this.bindHost, () => {
      console.log(`[Bot] listen: http://${this.bindHost}:${this.listenPort}`);
      console.log(`[Bot] POST  : ${this.endpointMessage} (receive)`);
      console.log(`[Bot] POST  : ${this.endpointReply} (forward to Iris:3000)`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
