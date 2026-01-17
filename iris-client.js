  const express = require("express");
const axios = require("axios");


class Bot {
  constructor(irisHost, irisPort) {
    this.irisHost = String(irisHost);
    this.irisPort = Number(irisPort);

    this.ENDPOINT = {
      MESSAGE: "/message",
      QUERY: `http://${this.irisHost}:3000/query`,
      REPLY: `http://${this.irisHost}:3000/reply`,
      AOT: `http://${this.irisHost}:3000/aot`,
    };

    this.app = express();
    this.http = axios.create({
      timeout: 10000,
      headers: { "Content-Type": "application/json" },
    });

    this.events = Object.create(null);

    this.app.use(express.json({ limit: "4mb" }));
    this.app.post(this.ENDPOINT.MESSAGE, this._onWebhook.bind(this));
  }

  onEvent(name, handler) {
    (this.events[name] ??= []).push(handler);
  }

  async _emit(name, event) {
    for (const fn of this.events[name] ?? []) {
      try {
        await Promise.resolve(fn(event));
      } catch (e) {
        if (name !== "error") {
          await this._emit("error", { error: e, raw: event?.raw, event: name });
        }
      }
    }
  }

  async _onWebhook(req, res) {
    try {
      await this._dispatch(req.body);
      res.json({ ok: true });
    } catch (e) {
      await this._emit("error", { error: e, raw: req.body, event: "webhook" });
      res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
  }

  _detectEvent(raw) {
    const j = raw?.json ?? raw ?? {};
    const type = String(j.type ?? "");

    if (type === "1") return "message";

    if (type === "0") {
      const feedType = Number(j.feedType ?? j?.message?.feedType ?? 0);
      const map = { 4: "join", 2: "leave", 6: "kick", 14: "delete", 26: "hide" };
      return map[feedType] ?? null;
    }

    return null;
  }

  async _dispatch(raw) {
    const j = raw?.json ?? raw ?? {};

    // ✅ 요구사항: /message에서 userId/chatId/logId(json.id)만 사용
    const userId = j.user_id;
    const chatId = j.chat_id;
    const logId = j.id;

    if (userId == null || chatId == null || logId == null) {
      await this._emit("error", {
        error: new Error("필수 키 누락: user_id / chat_id / id"),
        raw,
        event: "parse",
      });
      return;
    }

    // ✅ 3개 ID로만 DB 조회
    const [userRow, channelRow, logRow] = await Promise.all([
      this._row("open_chat_member", "user_id", userId),
      this._row("chat_rooms", "id", chatId),
      this._row("chat_logs", "id", logId),
    ]);

    const user = normalizeUser(userRow);
    const channel = normalizeChannel(channelRow);
    const message = normalizeMessage(logRow);

    // event 객체 생성
    const event = {
      user,
      channel,
      message,
      raw,

      // ✅ TalkAPI (event.talkAPI)
      talkAPI: async (text, attach = {}, type = 1) =>
        this._talkAPI(chatId, text, attach, type),
    };

    // ✅ channel API 부착
    if (channel) {
      channel.send = async (text) => this._reply(chatId, text);
      channel.react = async (type = 3) => this._react(chatId, logId, channel.linkId, type);
      channel.share = async (noticeId) => this._share(noticeId, channel.linkId);
    }

    // all 먼저
    await this._emit("all", event);

    // 실제 이벤트
    const evName = this._detectEvent(raw);
    if (evName) await this._emit(evName, event);
  }

  /* =========================
   * Iris DB Query
   * ========================= */
  async _row(table, key, value) {
    const r = await this.http.post(this.ENDPOINT.QUERY, {
      query: `SELECT * FROM ${table} WHERE ${key} = ?`,
      bind: [String(value)],
    });
    return r.data?.data?.[0] ?? null;
  }

  /* =========================
   * Iris Reply (3000/reply)
   * ========================= */
  async _reply(chatId, text) {
    await this.http.post(this.ENDPOINT.REPLY, {
      type: "text",
      roomId: String(chatId),
      data: String(text),
    });
  }

  /* =========================
   * AOT / Session
   * ========================= */
  async _aotSession() {
    const r = await this.http.get(this.ENDPOINT.AOT);
    const a = r.data?.aot;
    if (!a?.access_token || !a?.d_id) throw new Error("AOT(access_token, d_id) 없음");
    return {
      accessToken: a.access_token,
      dId: a.d_id,
      session: `${a.access_token}-${a.d_id}`,
    };
  }

  /* =========================
   * External APIs (utils.js style)
   * ========================= */

  // TalkAPI
  async _talkAPI(chatId, msg, attach = {}, type = 1) {
    const s = await this._aotSession();

    await axios.post(
      "https://talk-external.kakao.com/talk/write",
      {
        chatId: String(chatId),
        type: Number(type ?? 1),
        message: String(msg ?? ""),
        attachment: attach || {},
        msgId: Date.now(),
      },
      {
        timeout: 10000,
        headers: {
          Authorization: s.accessToken,
          Duuid: s.dId,
          "Content-Type": "application/json; charset=utf-8",
          "User-Agent": "okhttp/4.12.0",
          Connection: "keep-alive",
        },
      }
    );
  }

  // Reaction
  async _react(chatId, logId, linkId, type = 3) {
    const s = await this._aotSession();

    await axios.post(
      `https://talk-pilsner.kakao.com/messaging/chats/${chatId}/bubble/reactions`,
      {
        logId: String(logId),
        reqId: Date.now(),
        type: Number(type ?? 3),
        linkId: linkId ?? null,
      },
      {
        timeout: 10000,
        headers: {
          Authorization: s.session,
          "talk-agent": "android/25.8.2",
          "talk-language": "ko",
          "content-type": "application/json",
          "user-agent": "okhttp/4.9.0",
        },
      }
    );
  }

  // Notice Share
  async _share(noticeId, linkId) {
    if (!noticeId) throw new Error("share: noticeId가 없습니다.");

    const s = await this._aotSession();
    const base = linkId ? "https://open.kakao.com/moim" : "https://talkmoim-api.kakao.com";

    const url = linkId
      ? `${base}/posts/${noticeId}/share?link_id=${encodeURIComponent(String(linkId))}`
      : `${base}/posts/${noticeId}/share`;

    await axios.post(url, null, {
      timeout: 10000,
      headers: {
        Authorization: s.session,
        "accept-language": "ko",
        "content-type": "application/x-www-form-urlencoded",
        A: "android/25.8.2/ko",
      },
    });
  }

  /* =========================
   * Server Start
   * ========================= */
  start() {
    this.app.listen(this.irisPort, this.irisHost, () => {
      console.log(`[IrisBot] listen: http://${this.irisHost}:${this.irisPort}`);
    });
  }
}

/* =========================
 * normalize
 * ========================= */
function normalizeUser(u) {
  if (!u) return null;
  return {
    id: String(u.user_id ?? ""),
    name: u.nickname ?? u.name ?? null,
    profileImage: u.profile_image_url ?? u.profile_image ?? null,
    type: u.link_member_type ?? u.type ?? null,
    raw: u,
  };
}

function normalizeChannel(c) {
  if (!c) return null;
  return {
    id: String(c.id ?? ""),
    name: c.name ?? null,
    linkId: c.link_id ?? null,
    raw: c,
  };
}

function normalizeMessage(m) {
  if (!m) return null;
  return {
    id: String(m.id ?? ""),
    content: m.message ?? m.content ?? "",
    raw: m,
  };
}

module.exports = { Bot };