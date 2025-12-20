// iris_client.ts
import express, { Express, Request, Response } from "express";
import axios, { AxiosInstance } from "axios";

//////////////////////
// 타입 정의
//////////////////////

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
  msg?: string;
  sender?: string;
  json?: Record<string, any>;
  [k: string]: any;
}

export interface UserInfo {
  name: string | null;
  id: string;
  profileImage: string | null;
  type: string | null;
  raw: any;
}

export interface ChannelInfo {
  id: string;
  name: string | null;
  bannerImage: string | null;
  raw: any;
}

export interface MessageInfo {
  content: string;
  id: string;
  image: string | null;
  raw: any;
}

export interface BotEvent {
  raw: IrisWebhookBody;

  user: UserInfo;
  channel: ChannelInfo;
  message: MessageInfo;

  // ✅ 최종 통일: event.send()
  send(text: string): Promise<any>;
}

// error 이벤트는 payload 모양이 다를 수 있어서 별도 타입
export interface BotErrorEvent {
  error: unknown;
  event?: string;
}

//////////////////////
// Iris HTTP API 래퍼
//////////////////////
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

  // /reply
  async send(payload: { type: string; room: string; data: string }): Promise<any> {
    const body = {
      type: String(payload.type),
      room: String(payload.room),
      data: String(payload.data),
    };
    const res = await this.http.post("/reply", body);
    return res.data;
  }

  // /query
  async query(query: string, bind: any[] = []): Promise<any> {
    const res = await this.http.post("/query", { query, bind });
    return res.data; // { success, message, data: [...] }
  }

  // /aot
  async getAot(): Promise<any> {
    const res = await this.http.get("/aot");
    return res.data; // { aot: { access_token, d_id, ... } }
  }
}

/////////////////////////////////////
// irisDB: DB 조회 함수들 (내부용)
/////////////////////////////////////
function createIrisDB(iris: IrisAPI) {
  const irisDB = {
    async getUserInfo(userId: string | number) {
      const sql = "SELECT * FROM open_chat_member WHERE user_id = ?";
      const result = await iris.query(sql, [userId]);
      return (result?.data && result.data[0]) || null;
    },

    async getChatInfo(chatId: string | number) {
      const sql = "SELECT * FROM chat_rooms WHERE id = ?";
      const result = await iris.query(sql, [chatId]);
      return (result?.data && result.data[0]) || null;
    },

    async findChatLog(logId: string | number) {
      const sql = "SELECT * FROM chat_logs WHERE id = ?";
      const result = await iris.query(sql, [logId]);
      return (result?.data && result.data[0]) || null;
    },
  };

  return irisDB;
}

//
// ======================= buildEvent ======================= //
// /message 바디 + irisDB + iris → event 생성
//
async function buildEvent(
  data: IrisWebhookBody,
  irisDB: ReturnType<typeof createIrisDB>,
  iris: IrisAPI
): Promise<BotEvent> {
  const json = data?.json || {};
  const userId = json.user_id;
  const chatId = json.chat_id;
  const logId = json.id; // chat_logs.id

  // 1) DB 조회
  const userRow = userId ? await irisDB.getUserInfo(userId) : null;
  const chatRow = chatId ? await irisDB.getChatInfo(chatId) : null;
  const logRow = logId ? await irisDB.findChatLog(logId) : null;

  // 2) 메시지 본문 (이벤트 종류 상관없이 안전하게)
  const content =
    (logRow && logRow.message) ||
    json.message ||
    data.msg ||
    "";

  // 3) 이미지 추출 (attachment.urls[0])
  let image: string | null = null;
  try {
    const attStr = (logRow && logRow.attachment) || json.attachment;
    if (attStr) {
      const att = typeof attStr === "string" ? JSON.parse(attStr) : attStr;
      if (att?.urls?.length) image = att.urls[0];
    }
  } catch (_) {}

  const event: BotEvent = {
    raw: data,

    user: {
      name: userRow ? userRow.nickname : (data.sender || null),
      id: userRow ? String(userRow.user_id) : String(userId || ""),
      profileImage: userRow
        ? (userRow.full_profile_image_url ||
          userRow.profile_image_url ||
          userRow.original_profile_image_url ||
          null)
        : null,
      type: userRow ? (userRow.profile_type || null) : null,
      raw: userRow,
    },

    channel: {
      id: chatRow ? String(chatRow.id) : String(chatId || ""),
      name: data.room || null,
      bannerImage: null,
      raw: chatRow,
    },

    message: {
      content: String(content || ""),
      id: logRow ? String(logRow.id) : String(logId || ""),
      image,
      raw: logRow || json,
    },

    // ✅ 최종 통일: event.send()
    send: async (text: string) => {
      if (!chatId) throw new Error("chat_id 없음");
      return iris.send({
        type: "text",
        room: String(chatId),
        data: String(text),
      });
    },
  };

  return event;
}

//
// ======================= Bot 클래스 ======================= //
//
export class Bot {
  private irisHost: string;
  private iris: IrisAPI;
  private irisDB: ReturnType<typeof createIrisDB>;

  private port: number;
  private endpointPath: string;

  private FEED: {
    JOIN: number;
    LEAVE: number;
    KICK: number;
    DELETE: number;
    HIDE: number;
  };

  private listeners: Record<EventName, Array<(event: any) => any>>;

  private app: Express;
  private server: any;

  /**
   * @param irisHost  예: "127.0.0.1"
   * @param port      webhook 서버 포트 (예: 8080)
   * @param opts      { endpointPath="/message", feedMap={} }
   */
  constructor(
    irisHost: string,
    port: number = 3512,
    opts: { endpointPath?: string; feedMap?: Partial<Bot["FEED"]> } = {}
  ) {
    this.irisHost = String(irisHost || "127.0.0.1");

    // Iris API는 3000 고정
    this.iris = new IrisAPI(`http://${this.irisHost}:3000`);
    this.irisDB = createIrisDB(this.iris);

    this.port = Number(port);
    this.endpointPath = String(opts.endpointPath || "/message");

    // ✅ bot.js에서 쓰는 이벤트만 존재 (all/nickname 없음)
    this.listeners = {
      message: [],
      join: [],
      leave: [],
      kick: [],
      delete: [],
      hide: [],
      error: [],
    };

    // feedType 매핑(환경별로 다르면 덮어쓰기)
    this.FEED = Object.assign(
      { JOIN: 4, LEAVE: 2, KICK: 6, DELETE: 14, HIDE: 26 },
      opts.feedMap || {}
    );

    this.app = express();
    this.app.use(express.json({ limit: "2mb" }));
    this.server = null;
  }

  onEvent(eventName: "message", handler: (event: BotEvent) => any): void;
  onEvent(eventName: "join", handler: (event: BotEvent) => any): void;
  onEvent(eventName: "leave", handler: (event: BotEvent) => any): void;
  onEvent(eventName: "kick", handler: (event: BotEvent) => any): void;
  onEvent(eventName: "delete", handler: (event: BotEvent) => any): void;
  onEvent(eventName: "hide", handler: (event: BotEvent) => any): void;
  onEvent(eventName: "error", handler: (event: BotErrorEvent) => any): void;
  onEvent(eventName: EventName, handler: (event: any) => any): void {
    if (!this.listeners[eventName]) throw new Error(`지원하지 않는 이벤트: ${eventName}`);
    this.listeners[eventName].push(handler);
  }

  private async emit(eventName: EventName, payload: any): Promise<void> {
    const list = this.listeners[eventName] || [];
    for (const fn of list) {
      try {
        await Promise.resolve().then(() => fn(payload));
      } catch (err) {
        if (eventName !== "error") {
          await this.emit("error", { error: err, event: eventName } satisfies BotErrorEvent);
        }
      }
    }
  }

  private detectEvent(body: IrisWebhookBody): Exclude<EventName, "error"> | null {
    const json = body?.json || {};
    const type = String((json as any).type ?? "");

    // 1: 일반 메시지
    if (type === "1") return "message";

    // 0: 피드 이벤트
    if (type === "0") {
      const feedType = Number((json as any).feedType);
      if (feedType === this.FEED.JOIN) return "join";
      if (feedType === this.FEED.LEAVE) return "leave";
      if (feedType === this.FEED.KICK) return "kick";
      if (feedType === this.FEED.DELETE) return "delete";
      if (feedType === this.FEED.HIDE) return "hide";
    }

    return null;
  }

  start(): void {
    this.app.post(this.endpointPath, async (req: Request, res: Response) => {
      try {
        const body = (req.body || {}) as IrisWebhookBody;
        const eventName = this.detectEvent(body);

        if (eventName) {
          const event = await buildEvent(body, this.irisDB, this.iris);
          await this.emit(eventName, event);
        }

        res.json({ ok: true, event: eventName });
      } catch (err) {
        console.error("[Bot] /message 처리 오류:", err);
        await this.emit("error", { error: err, event: "webhook" } satisfies BotErrorEvent);
        res.status(500).json({ ok: false, error: String(err) });
      }
    });

    this.server = this.app.listen(this.port, () => {
      console.log(`[Bot] Webhook 서버: http://${this.irisHost}:${this.port}${this.endpointPath}`);
      console.log(`[Bot] Iris API     : http://${this.irisHost}:3000`);
    });
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
