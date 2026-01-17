// iris-client.js
const express = require("express");
const axios = require("axios");

class Bot {
  constructor(host, port) {
    this.host = host;
    this.port = port;

    this.ENDPOINT = {
      MESSAGE: "/message",
      REPLY: `http://${this.host}:3000/reply`,
      QUERY: `http://${this.host}:3000/query`
    };


    this.app = express();
    this.server = null;
    this.http = axios.create();
    this.events = Object.create(null);

    this.app.use(express.json());
    this.app.post(this.ENDPOINT.MESSAGE, this._onWebhook.bind(this));
  }


  onEvent(name, handler) {
    (this.events[name] ??= []).push(handler);
  }

  async emit(name, ctx) {
    for (const fn of this.events[name] ?? []) {
      await fn(ctx);
    }
    if (name !== "all") {
      for (const fn of this.events.all ?? []) {
        await fn(ctx);
      }
    }
  }

  async _onWebhook(req, res) {
    try {
      await this._dispatchEvent(req.body);
      res.json({ ok: true });
    } catch (e) {
      await this.emit("error", { error: e });
      res.status(500).json({ ok: false });
    }
  }

  async _dispatchEvent(json) {
    const ctx = await this._createContext(json);

    await this.emit("all", ctx);

    if (json.type === "1") {
      return this.emit("message", ctx);
    }

    if (json.type === "0") {
      const feedMap = {
        4: "join",
        2: "leave",
        6: "kick",
        14: "delete",
        26: "hide"
      };
      const event = feedMap[json.feedType];
      if (event) await this.emit(event, ctx);
    }
  }

  async _createContext(json) {
    const [user, channel, message] = await Promise.all([
      this.db.getUser(json.user_id),
      this.db.getChannel(json.chat_id),
      this.db.getMessage(json.log_id)
    ]);

    return {
      user: normalizeUser(user),
      channel: normalizeChannel(channel),
      message: normalizeMessage(message),

      send: (text) => this.send(json.log_id, text)
    };
  }

  async send(logId, text) {
    return this.http.post(this.ENDPOINT.REPLY, { log_id: logId, text });
  }

  db = {
    query: async (sql, bind = []) => {
      const r = await this.http.post(this.ENDPOINT.QUERY, { query: sql, bind });
      return r.data?.data || [];
    },

    getUser: async (id) =>
      (await this.db.query(
        "SELECT * FROM open_chat_member WHERE user_id = ?",
        [id]
      ))[0] ?? null,

    getChannel: async (id) =>
      (await this.db.query(
        "SELECT * FROM chat_rooms WHERE id = ?",
        [id]
      ))[0] ?? null,

    getMessage: async (id) =>
      (await this.db.query(
        "SELECT * FROM chat_logs WHERE id = ?",
        [id]
      ))[0] ?? null,

    getPrevMessage: async (id) => {
      const r = await this.db.query(
        "SELECT prev_id FROM chat_logs WHERE id = ?",
        [id]
      );
      return r[0]?.prev_id ? this.db.getMessage(r[0].prev_id) : null;
    },

    getNextMessage: async (id) => {
      const r = await this.db.query(
        "SELECT id FROM chat_logs WHERE prev_id = ?",
        [id]
      );
      return r[0]?.id ? this.db.getMessage(r[0].id) : null;
    }
  };


  start() {
    this.server = this.app.listen(this.port, this.host, () => {
      console.log(`[IrisBot] http://${this.host}:${this.port}`);
    });
  }

  stop() {
    this.server?.close();
  }
}


function normalizeUser(u) {
  if (!u) return null;
  return {
    id: String(u.user_id),
    name: u.nickname,
    profileImage: u.profile_image,
    type: u.link_member_type
  };
}

function normalizeChannel(c) {
  if (!c) return null;
  return {
    id: String(c.id),
    name: c.name,
    bannerImage: c.banner_image
  };
}

function normalizeMessage(m) {
  if (!m) return null;
  return {
    id: String(m.id),
    content: m.message,
    image: m.attachment?.image ?? null
  };
}

module.exports = { Bot };
