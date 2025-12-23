// bot.js
const { Bot } = require("./iris-client");

const bot = new Bot("127.0.0.1", 8080); // Iris 서버의 IP와 포트를 입력하세요.

/* =========================
 * 전체 이벤트 (디버그용)
 * ========================= */
bot.onEvent("all", async (ctx) => {
  console.log(
    `[ALL] ${ctx.channel?.name} | ${ctx.user?.name} | ${ctx.message?.content}`
  );
});

/* =========================
 * 메시지 이벤트
 * ========================= */
bot.onEvent("message", async (ctx) => {
  const text = ctx.message?.content;
  if (!text) return;

  if (text === "!핑") {
    await ctx.reply("퐁!");
  }
});

/* =========================
 * 입장 이벤트
 * ========================= */
bot.onEvent("join", async (ctx) => {
  await ctx.reply(`${ctx.user.name}님이 입장하셨습니다 👋`);
});

/* =========================
 * 퇴장 이벤트
 * ========================= */
bot.onEvent("leave", async (ctx) => {
  await ctx.reply(`${ctx.user.name}님이 퇴장하셨습니다.`);
});

/* =========================
 * 강퇴 이벤트
 * ========================= */
bot.onEvent("kick", async (ctx) => {
  await ctx.reply(`${ctx.user.name}님이 강퇴되었습니다.`);
});

/* =========================
 * 메시지 삭제
 * ========================= */
bot.onEvent("delete", async (ctx) => {
  await ctx.reply("메시지가 삭제되었습니다.");
});

/* =========================
 * 메시지 가리기
 * ========================= */
bot.onEvent("hide", async (ctx) => {
  await ctx.reply("메시지가 가려졌습니다.");
});

/* =========================
 * 에러 처리
 * ========================= */
bot.onEvent("error", async (e) => {
  console.error("[BOT ERROR]", e.error);
});

/* =========================
 * 봇 시작
 * ========================= */
bot.start();