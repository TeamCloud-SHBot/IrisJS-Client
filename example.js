// bot.js
const { Bot } = require("./iris-client");

const bot = new Bot("127.0.0.1", 8080); // Iris 서버의 IP와 포트를 입력하세요.


/* =========================
 * 메시지 이벤트
 * ========================= */
bot.onEvent("message", async (event) => {

  if (event.message?.content === "!핑") {
    await event.channel.send("퐁!");
  }

  if (event.message?.content.startsWith("ev.")) {
    try {
        const AsyncFunction = Object.getPrototypeOf(
          async function () {}
        ).constructor;

        const fn = new AsyncFunction(
          "event",
          "channel",
          `"use strict"; return ( ${event.message.content.replace("ev.", "")} );`
        );

        const result = await fn(event, event.channel);

        await event.channel.send(
          typeof result === "string"
            ? result
            : JSON.stringify(result, null, 2)
        );
      } catch (e) {
        await event.channel.send("❌ ERROR: " + (e?.message ?? String(e)));
      }
  }
});

/* =========================
 * 입장 이벤트
 * ========================= */
bot.onEvent("join", async (event) => {
  await event.channel.send(`${event.user?.name}님이 입장하셨습니다 👋`);
});

/* =========================
 * 퇴장 이벤트
 * ========================= */
bot.onEvent("leave", async (event) => {
  await event.channel.send(`${event.user?.name}님이 퇴장하셨습니다.`);
});

/* =========================
 * 강퇴 이벤트
 * ========================= */
bot.onEvent("kick", async (event) => {
  await event.channel.send(`${event.user?.name}님이 강퇴되었습니다.`);
});

/* =========================
 * 메시지 삭제
 * ========================= */
bot.onEvent("delete", async (event) => {
  await event.channel.send("메시지가 삭제되었습니다.");
});

/* =========================
 * 메시지 가리기
 * ========================= */
bot.onEvent("hide", async (event) => {
  await event.channel.send("메시지가 가려졌습니다.");
});

/* =========================
 * 에러 처리
 * ========================= */
bot.onEvent("error", async (event) => {
  console.error("[BOT ERROR]", event.error);
});

/* =========================
 * 봇 시작
 * ========================= */
bot.start();