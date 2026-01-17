"use strict";

const express = require("express");
const axios = require("axios");

class Bot {
  constructor(irisHost, listenPort, opts = {}) {
    this.irisHost = String(irisHost);
    this.listenPort = Number(listenPort);
    this.listenHost = opts.listenHost ?? "0.0.0.0";
    this.endpointMessage = opts.endpointMessage ?? "/message";

    this.ENDPOINT = {
      MESSAGE: this.endpointMessage,
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
      await fn(event);
    }
  }

  async _onWebhook(req, res) {
    try {
      await this._dispatch(req.body);
      res.json({ ok: true });
    } catch (e) {
      await this._emit("error", { error: e, raw: req.body });
      res.status(500).json({ ok: false });
    }
  }

  _detectEvent(raw) {
    const j = raw?.json ?? raw ?? {};
    if (String(j.type) === "1") return "message";

    if (String(j.type) === "0") {
      const f = Number(j.feedType ?? j?.message?.feedType);
      return { 4: "join", 2: "leave", 6: "kick", 14: "delete", 26: "hide" }[f];
    }
    return null;
  }

  async _dispatch(raw) {
    const j = raw?.json ?? raw ?? {};
    const userId = j.user_id;
    const chatId = j.chat_id;
    const logId = j.id;

    const [u, c, m] = await Promise.all([
      this._row("open_chat_member", "user_id", userId),
      this._row("chat_rooms", "id", chatId),
      this._row("chat_logs", "id", logId),
    ]);

    const user = normalizeUser(u);
    const channel = normalizeChannel(c);
    const message = normalizeMessage(m);

    /* =========================
     * event 객체 (최종 형태)
     * ========================= */
    const event = {
      user,
      channel,
      message,
      raw,

      /* 🔥 TalkAPI */
      talkAPI: async (text, attach = {}, type = 1) =>
        this._talkAPI(chatId, text, attach, type),
    };

    /* 🔥 channel API */
    if (channel) {
      channel.send = async (text) => this._reply(chatId, text);
      channel.react = async (type = 3) =>
        this._react(chatId, logId, channel.linkId, type);
      channel.share = async (noticeId) =>
        this._share(noticeId, channel.linkId);
    }

    await this._emit("all", event);

    const ev = this._detectEvent(raw);
    if (ev) await this._emit(ev, event);
  }

  async _row(table, key, value) {
    const r = await this.http.post(this.ENDPOINT.QUERY, {
      query: `SELECT * FROM ${table} WHERE ${key} = ?`,
      bind: [String(value)],
    });
    return r.data?.data?.[0] ?? null;
  }

  /* =========================
   * Iris API / External API
   * ========================= */

  async _reply(chatId, text) {
    await this.http.post(this.ENDPOINT.REPLY, {
      type: "text",
      roomId: String(chatId),
      data: String(text),
    });
  }

  async _aot() {
    const r = await this.http.get(this.ENDPOINT.AOT);
    const a = r.data?.aot;
    return {
      accessToken: a.access_token,
      dId: a.d_id,
      session: `${a.access_token}-${a.d_id}`,
    };
  }

  async _talkAPI(chatId, msg, attach = {}, type = 1) {
    const s = await this._aot();
    await axios.post(
      "https://talk-external.kakao.com/talk/write",
      {
        chatId: String(chatId),
        type,
        message: String(msg),
        attachment: attach,
        msgId: Date.now(),
      },
      {
        headers: {
          Authorization: s.accessToken,
          Duuid: s.dId,
          "Content-Type": "application/json",
        },
      }
    );
  }

  async _react(chatId, logId, linkId, type) {
    const s = await this._aot();
    await axios.post(
      `https://talk-pilsner.kakao.com/messaging/chats/${chatId}/bubble/reactions`,
      {
        logId: String(logId),
        reqId: Date.now(),
        type,
        linkId,
      },
      {
        headers: {
          Authorization: s.session,
          "content-type": "application/json",
        },
      }
    );
  }

  async _share(noticeId, linkId) {
    const s = await this._aot();
    const base = linkId
      ? "https://open.kakao.com/moim"
      : "https://talkmoim-api.kakao.com";
    await axios.post(
      `${base}/posts/${noticeId}/share${linkId ? `?link_id=${linkId}` : ""}`,
      null,
      {
        headers: {
          Authorization: s.session,
          "content-type": "application/x-www-form-urlencoded",
        },
      }
    );
  }

  start() {
    this.app.listen(this.listenPort, this.listenHost, () => {
      console.log(`[IrisBot] listen http://${this.listenHost}:${this.listenPort}`);
    });
  }
}

/* =========================
 * normalize
 * ========================= */
function normalizeUser(u) {
  if (!u) return null;
  return { id: u.user_id, name: u.nickname, raw: u };
}

function normalizeChannel(c) {
  if (!c) return null;
  return { id: c.id, name: c.name, linkId: c.link_id, raw: c };
}

function normalizeMessage(m) {
  if (!m) return null;
  return { id: m.id, content: m.message, raw: m };
}

module.exports = { Bot };
