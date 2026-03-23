import { env } from "../config/env";
import { makeSignedCallback } from "../lib/hmac";
import { Markup, Telegram } from "telegraf";

const telegram = env.BOT_TOKEN ? new Telegram(env.BOT_TOKEN) : null;

export async function sendRegistrationAlert(userId: number, login: string, ip: string): Promise<void> {
  if (!telegram || !env.ADMIN_CHAT_ID) {
    return;
  }

  const approveData = makeSignedCallback("approve", userId, env.HMAC_SECRET);
  const rejectData = makeSignedCallback("reject", userId, env.HMAC_SECRET);

  await telegram.sendMessage(
    env.ADMIN_CHAT_ID,
    [
      "🆕 Новая регистрация",
      `ID: ${userId}`,
      `Логин: ${login}`,
      `IP: ${ip}`,
      "Проверьте и обработайте через меню бота."
    ].join("\n"),
    Markup.inlineKeyboard([
      [
        Markup.button.callback("✅ Зарегистрировать", approveData),
        Markup.button.callback("❌ Отмена", rejectData)
      ]
    ])
  );
}
