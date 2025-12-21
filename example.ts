// bot.ts
import { Bot, BotEvent, BotErrorEvent } from "./iris-client";

const bot = new Bot("127.30.1.30", 2907);

/* =========================
 * message 이벤트
 * ========================= */
bot.onEvent("message", async (event: BotEvent) => {

  if (event.message?.content === "!핑") {
    await event.send("퐁!");
    return;
  }
});

/* =========================
 * join 이벤트
 * ========================= */
bot.onEvent("join", async (event: BotEvent) => {
  await event.send("환영합니다!");
});

/* =========================
 * leave 이벤트
 * ========================= */
bot.onEvent("leave", async (event: BotEvent) => {
  await event.send("안녕히 가세요!");
});

/* =========================
 * kick 이벤트
 * ========================= */
bot.onEvent("kick", async (event: BotEvent) => {
  await event.send("강퇴 처리되었습니다.");
});

/* =========================
 * delete 이벤트
 * ========================= */
bot.onEvent("delete", async (event: BotEvent) => {
  await event.send("메시지가 삭제되었습니다.");
});

/* =========================
 * hide 이벤트
 * ========================= */
bot.onEvent("hide", async (event: BotEvent) => {
  await event.send("메시지가 가려졌습니다.");
});

/* =========================
 * error 이벤트
 * ========================= */
bot.onEvent("error", async (event: BotErrorEvent) => {
  console.error("[BOT ERROR]", event?.event, event?.error);
});

/* =========================
 * 봇 시작
 * ========================= */
bot.start();
