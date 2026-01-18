const express = require("express");
const axios = require("axios");

class Bot {
  /**
   * @param {string} host
   * @param {number} port
   */
  constructor(host, port) {
    this.host = String(host);
    this.port = Number(port);

    this.ENDPOINT = {
      MESSAGE: "/message",
      QUERY: `http://${this.host}:3000/query`,
      REPLY: `http://${this.host}:3000/reply`,
      AOT: `http://${this.host}:3000/aot`,
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
      let feedType = j.feedType ?? j.feed_type ?? null;

      if (feedType == null && j.message && typeof j.message === "object") {
        feedType = j.message.feedType ?? j.message.feed_type ?? null;
      }
      if (feedType == null && typeof j.message === "string") {
        try {
          const parsed = JSON.parse(j.message);
          feedType = parsed.feedType ?? parsed.feed_type ?? null;
        } catch (e) {
        }
      }

      const ft = Number(feedType ?? 0);

      const map = {
        4: "join",
        2: "leave",
        6: "kick",
        14: "delete",
        26: "hide",
      };

      return map[ft] ?? null;
    }

    return null;
  }

  async _dispatch(raw) {
    const j = raw?.json ?? raw ?? {};

    const [userRow, channelRow, logRow] = await Promise.all([
      this._row("open_chat_member", "user_id", j.user_id),
      this._row("chat_rooms", "id", j.chat_id),
      this._row("chat_logs", "id", j.id ?? j.msg_id),
    ]);

    const user = normalizeUser(userRow);
    const channel = normalizeChannel(channelRow, raw);
    const message = normalizeMessage(logRow);

    const event = {
      user,
      channel,
      message,
      raw,

      GET: async (type, id) => {
        switch (type) {
          case "user": {
            const uRow = await this._row("open_chat_member", "user_id", id);
            console.log(normalizeUser(uRow));
            return normalizeUser(uRow);
          }
          case "channel": {
            const cRow = await this._row("chat_rooms", "id", id);
            console.log(normalizeChannel(cRow, raw));
            return normalizeChannel(cRow, raw);
          }
          case "message": {
            const mRow = await this._row("chat_logs", "id", id);
            console.log(normalizeMessage(mRow));
            return normalizeMessage(mRow);
          }
        }
      },

      talkAPI: async (msg, attach = {}, type = 1) =>
        this._talkAPI(j.chat_id, msg, attach, type),
    };

    if (channel) {
      channel.send = async (data) => this._reply("text", j.chat_id, data);
      channel.react = async (type = 3) => this._react(j.chat_id, j.id ?? j.msg_id, channel.linkId, type);
      channel.share = async (noticeId) => this._share(noticeId, channel.linkId);

      event.send = async (data) => channel.send(data);
    } else {
      event.send = async () => {
        throw new Error("channel 정보가 없어 send를 사용할 수 없습니다.");
      };
    }


    if (j.type === "0" && typeof j.message === "string") {
      try {
        const feed = JSON.parse(j.message);
        event.feed = feed;

        const member = feed?.members?.[0];
        if (member) {
        if (event.user) {
          if (member.userId != null) event.user.id = String(member.userId);
          if (member.nickName != null) event.user.name = String(member.nickName);
        } else {
          event.user = {
            id: member.userId != null ? String(member.userId) : "",
            name: member.nickName != null ? String(member.nickName) : null,
            profileImage: null,
            type: null,
            raw: member,
          };
        }
      }
    } catch(e) {}
  }

    await this._emit("all", event);

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
  /**
   * 
   * @param {String} type ["text", "image", "multi_image"]
   * @param {Number} roomId 
   * @param {String|Array} data string || string[]
   */
  async _reply(type, roomId, data) {
    await this.http.post(this.ENDPOINT.REPLY, {
      type: type,
      room: roomId,
      data: data,
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
   * External APIs
   * ========================= */

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
    this.app.listen(this.port, this.host, () => {
      console.log(`[IrisBot] listen: http://${this.host}:${this.port}`);
      console.log(`[IrisBot] iris api: http://${this.host}:3000`);
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
    type: u.link_member_type ?? u.type ?? null,
    image: u.original_profile_image_url ?? u.original_profile_image_url ?? null,
    memberType: u.link_member_type ?? null,
    raw: u,
  };
}

function normalizeChannel(c, r) {
  if (!c) return null; 
  return {
    id: String(c.id ?? ""),
    name: r.room ?? null,
    members: JSON.parse(c.members) ?? null,
    raw: c,
  };
}

function normalizeMessage(m) {
  if (!m) return null;
  return {
    type: m.type ?? null,
    id: String(m.id ?? ""),
    content: m.message ?? null,

    prev: m.prev_id ?? null,
    
    attachments: m.attachments ? {
      file: m.attachment.url ?? null,

      reply: src_logId ? {
        id: String(m.src_logId ?? ""),
        user: m.src_userId ?? null,
        content: m.src_message ?? null,
      } : null,
    } : null,

    raw: m,
  };
}

module.exports = { Bot };
