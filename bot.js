const { Bot } = require("./iris-client.js");

// Iris 서버 URL, Bot HTTP 포트
const bot = new Bot("127.0.0.1", 8080); //<기기IP>:<PORT>

bot.onEvent("message", onMessage);

async function onMessage(event) {
  console.log("유저:", event.user?.name, "(", event.user?.id, ")");
  console.log("방:", event.channel?.name, "(", event.channel?.id, ")");
  console.log("원본 메시지:", event.message?.message);

  // 기본 핑퐁
  if (event.message.command === "!핑") {
    await event.send("퐁! (Project-Iris)");
    return;
  }

  if (text === "!내정보") {
    await ctx.reply(
      [
        `이름: ${ctx.user.name}`,
        `ID: ${ctx.user.id}`,
        `프로필타입: ${ctx.user.type}`,
        `이미지: ${ctx.user.profileImage || "없음"}`
      ].join("\n")
    );
  }

  if (event.message.command === "!이전") {
    const prev = await event.getPrevChat(event.message);
    await event.send(
      prev ? "[이전 채팅]\n" + prev.message : "이전 채팅이 없어요."
    );
    return;
  }

  if (event.message.command === "!다음") {
    const next = await event.getNextChat(event.message);
    await event.send(
      next ? "[다음 채팅]\n" + next.message : "다음 채팅이 없어요."
    );
    return;
  }
}

// 에러 로깅
bot.onEvent("error", ({ error, event }) => {
  console.error("[BOT ERROR]", error);
});

// 봇 시작
bot.start();
