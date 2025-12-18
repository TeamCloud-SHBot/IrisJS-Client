// iris_client.js
"use strict";

const express = require("express");
const axios = require("axios");

//////////////////////
// Iris HTTP API 래퍼 //
//////////////////////
class IrisAPI {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: { "Content-Type": "application/json" },
      timeout: 10000,
    });
  }

  // /reply
  async send(payload) {
    const body = {
      type: String(payload.type),
      room: String(payload.room),
      data: String(payload.data),
    };
    const res = await this.http.post("/reply", body);
    return res.data;
  }

  // /query
  async query(query, bind = []) {
    const res = await this.http.post("/query", { query, bind });
    return res.data; // { success, message, data: [...] }
  }

  // /aot
  async getAot() {
    const res = await this.http.get("/aot");
    return res.data; // { aot: { access_token, d_id, ... } }
  }
}

/////////////////////////////////////
// irisDB: DB 조회/로그 조회 함수들 //
/////////////////////////////////////
function createIrisDB(iris) {
  const irisDB = {};

  irisDB.getUserInfo = async (userId) => {
    const sql = "SELECT * FROM open_chat_member WHERE user_id = ?";
    const result = await iris.query(sql, [userId]);
    return (result.data && result.data[0]) || null;
  };

  irisDB.getChatInfo = async (chatId) => {
    const sql = "SELECT * FROM chat_rooms WHERE id = ?";
    const result = await iris.query(sql, [chatId]);
    return (result.data && result.data[0]) || null;
  };

  irisDB.findChatLog = async (logId) => {
    const sql = "SELECT * FROM chat_logs WHERE id = ?";
    const result = await iris.query(sql, [logId]);
    return (result.data && result.data[0]) || null;
  };

  /** 4. 단일 쿼리 (첫 행만) */
  irisDB.query = async (sql) => {
    const result = await iris.query(sql, []);
    return (result.data && result.data[0]) || null;
  };

  /** 5. 이전 채팅 로그 */
  irisDB.getPrevChat = async (chatRow) => {
    const sid = chatRow?.attachment?.src_logId;
    if (!sid) return null;

    const rowPrevId = await db.query(
      `SELECT prev_id FROM chat_logs WHERE id = ${sid}`
    );
    if (!rowPrevId || rowPrevId.prev_id == null) return null;

    const prev = await db.query(
      `SELECT * FROM chat_logs WHERE id = ${rowPrevId.prev_id}`
    );
    return prev;
  };

  /** 6. 다음 채팅 로그 */
  irisDB.getNextChat = async (chatRow) => {
    const sid = chatRow?.attachment?.src_logId;
    if (!sid) return null;

    const rowNextId = await db.query(
      `SELECT id FROM chat_logs WHERE prev_id = ${sid}`
    );
    if (!rowNextId || rowNextId.id == null) return null;

    const next = await db.query(
      `SELECT * FROM chat_logs WHERE id = ${rowNextId.id}`
    );
    return next;
  };

  /** (옵션) 공지 가져오기 */
  irisDB.getNotices = async (chatId) => {
    const aotRes = await iris.getAot();
    const auth = aotRes.aot;
    if (!auth) throw new Error("AOT 정보 없음");

    const chatInfo = await db.reqChatInfo(chatId);
    if (!chatInfo) throw new Error("채팅방 정보 없음");

    const session = auth.access_token + "-" + auth.d_id;

    let urlBase = chatInfo.link_id
      ? "https://open.kakao.com/moim"
      : "https://talkmoim-api.kakao.com";

    let url = `${urlBase}/chats/${chatId}/posts`;
    if (chatInfo.link_id) url += `?link_id=${chatInfo.link_id}`;

    const headers = {
      Authorization: session,
      "accept-language": "ko",
      "content-type": "application/x-www-form-urlencoded",
      A: "android/25.8.2/ko",
    };

    const res = await axios.get(url, { headers });
    return res.data;
  };

  /** (옵션) 공지 공유 */
  irisDB.shareNotice = async (chatId, noticeId) => {
    const aotRes = await iris.getAot();
    const auth = aotRes.aot;
    if (!auth) throw new Error("AOT 정보 없음");

    const chatInfo = await db.reqChatInfo(chatId);
    if (!chatInfo) throw new Error("채팅방 정보 없음");

    const session = auth.access_token + "-" + auth.d_id;

    let urlBase = chatInfo.link_id
      ? "https://open.kakao.com/moim"
      : "https://talkmoim-api.kakao.com";

    let url = `${urlBase}/posts/${noticeId}/share`;
    if (chatInfo.link_id) url += `?link_id=${chatInfo.link_id}`;

    const headers = {
      Authorization: session,
      "accept-language": "ko",
      "content-type": "application/x-www-form-urlencoded",
      A: "android/25.8.2/ko",
    };

    const res = await axios.post(url, null, { headers });
    return res.data;
  };

  /** (옵션) 말풍선 리액션 */
  irisDB.react = async (chatId, logId, type = 3) => {
    const aotRes = await iris.getAot();
    const auth = aotRes.aot;
    if (!auth) throw new Error("AOT 정보 없음");

    const chatInfo = await db.reqChatInfo(chatId);
    if (!chatInfo) throw new Error("채팅방 정보 없음");

    const session = auth.access_token + "-" + auth.d_id;

    const url = `https://talk-pilsner.kakao.com/messaging/chats/${chatId}/bubble/reactions`;

    const body = {
      logId: logId,
      reqId: Date.now(),
      type: type,
      linkId: chatInfo.link_id,
    };

    const headers = {
      Authorization: session,
      "talk-agent": "android/25.8.2",
      "talk-language": "ko",
      "content-type": "application/json",
      "user-agent": "okhttp/4.9.0",
    };

    const res = await axios.post(url, body, { headers });
    return res.data;
  };

  return irisDB;
}

//
// ======================= buildContext ======================= //
// /message 바디 + db + iris → ctx 생성
//

async function buildContext(data, irisDB, iris) {
  const json = data.json || {};
  const userId = json.user_id;
  const chatId = json.chat_id;
  const logId = json.id; // chat_logs.id (메시지 로그 id)

  // 1) DB 조회
  const userRow = userId ? await irisDB.getUserInfo(userId) : null;
  const chatRow = chatId ? await irisDB.getChatInfo(chatId) : null;
  const logRow = logId ? await irisDB.findChatLog(logId) : null;

  // 2) 메시지 본문
  const content =
    (logRow && logRow.message) ||
    json.message ||
    data.msg ||
    "";

  // 3) 이미지 추출 (attachment.urls[0])
  let image = null;
  try {
    const attStr = (logRow && logRow.attachment) || json.attachment;
    if (attStr) {
      const att = typeof attStr === "string" ? JSON.parse(attStr) : attStr;
      if (att && att.urls && att.urls.length > 0) image = att.urls[0];
    }
  } catch (_) {}

  // 4) 최종 ctx 구성
  const ctx = {
    raw: data,  // /message 원본

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
      raw: userRow
    },

    channel: {
      id:   chatRow ? chatRow.id : String(chatId || ""),
      name: data.room || null,
      bannerImage: null,
      raw: chatRow
    },

    message: {
      content: content,
      id: logRow ? String(logRow.id) : String(logId || ""),
      image: image,
      raw: logRow || json
    },

    // 간편 send
    send: async (text) => {
      if (!chatId) throw new Error("chat_id 없음");
      return iris.send({
        type: "text",
        room: chatId,
        data: String(text),
      });
    }
  };

  return ctx;
}

//
// ======================= Bot 클래스 ======================= //
//

class Bot {
  /**
   * @param {string} irisUrl  예: "127.0.0.1"
   * @param {number} port     이 봇이 열 HTTP 서버 포트 (예: 8080)
   */
  constructor(irisUrl, port = 8080) {
    this.iris = new IrisAPI(`http://${irisUrl}:3000`);
    this.irisDB = createIrisDB(this.iris);

    this.port = Number(port);
    this.endpointPath = "/message";

    this.listeners = { message: [], error: [] };

    this.app = express();
    this.app.use(express.json());
    this.server = null;
  }

  onEvent(eventName, handler) {
    if (!this.listeners[eventName]) {
      throw new Error(`지원하지 않는 이벤트: ${eventName}`);
    }
    this.listeners[eventName].push(handler);
  }

  async _emit(eventName, payload) {
    const list = this.listeners[eventName] || [];
    for (const fn of list) {
      await Promise.resolve().then(() => fn(payload));
    }
  }

  start() {
    this.app.post(this.endpointPath, async (req, res) => {
      try {
        const ctx = await buildContext(req.body, this.irisDB, this.iris);
        await this._emit("message", ctx);
        res.json({ ok: true });
      } catch (err) {
        console.error("[Bot] /message 처리 오류:", err);
        await this._emit("error", { error: err });
        res.status(500).json({ ok: false, error: String(err) });
      }
    });

    this.server = this.app.listen(this.port, () => {
      console.log(
        `[Bot] HTTP 서버 실행 중: http://${this.irisUrl}:${this.port}${this.endpoint}`
      );
      console.log(
        `[Bot] Iris 서버(API) : http://${this.irisUrl}:${this.port}${this.endpoint}`
      );
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}

module.exports = {
  Bot,
};
