// bot.ts
import { Bot, BotEvent, BotErrorEvent } from "./iris_client";

const bot = new Bot("127.0.0.1", 8080);

// message 이벤트
bot.onEvent("message", async (event: BotEvent) => {
  const text = String(event.message?.content || "").trim();

  console.log("유저:", event.user?.name, "(", event.user?.id, ")");
  console.log("방:", event.channel?.name, "(", event.channel?.id, ")");
  console.log("메시지:", text);

  if (!text) return;

  if (text === "!핑") {
    await event.send("퐁! (Project-Iris)");
    return;
  }

  if (text === "!내정보") {
    await event.send(
      [
        `이름: ${event.user?.name || "알수없음"}`,
        `ID: ${event.user?.id || "없음"}`,
        `프로필타입: ${event.user?.type || "없음"}`,
        `이미지: ${event.user?.profileImage || "없음"}`,
      ].join("\n")
    );
    return;
  }
});

// join 이벤트
bot.onEvent("join", async (event: BotEvent) => {
  const name = event.user?.name || "누군가";
  await event.send(`${name}님 환영합니다!`);
});

// leave 이벤트
bot.onEvent("leave", async (event: BotEvent) => {
  const name = event.user?.name || "누군가";
  await event.send(`${name}님이 나가셨어요.`);
});

// kick 이벤트
bot.onEvent("kick", async (event: BotEvent) => {
  const name = event.user?.name || "누군가";
  await event.send(`${name}님이 강퇴 처리되었어요.`);
});

// delete 이벤트
bot.onEvent("delete", async (event: BotEvent) => {
  await event.send("메시지가 삭제되었어요.");
});

// hide 이벤트
bot.onEvent("hide", async (event: BotEvent) => {
  await event.send("메시지가 가려졌어요.");
});

// error 이벤트
bot.onEvent("error", async (event: BotErrorEvent) => {
  console.error("[BOT ERROR]", event?.event || "", event?.error);
});

// 시작
bot.start();
