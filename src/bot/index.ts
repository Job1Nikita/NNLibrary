import { Markup, Telegraf } from "telegraf";
import { env } from "../config/env";
import { ensureSqliteWal, prisma } from "../db/prisma";
import { makeSignedCallback, verifySignedCallback } from "../lib/hmac";
import { publishNotice } from "../services/notice.service";
import {
  deleteUserAccount,
  getPortalStats,
  moderateUser
} from "../services/user-admin.service";

if (!env.BOT_TOKEN) {
  throw new Error("BOT_TOKEN is required to run telegram bot process");
}
if (!env.ADMIN_CHAT_ID) {
  throw new Error("ADMIN_CHAT_ID is required to run telegram bot process");
}

const bot = new Telegraf(env.BOT_TOKEN);

type PendingAction = "notice";

const BTN_STATS = "📊 Статистика";
const BTN_USERS = "👥 Пользователи";
const BTN_PENDING = "🕒 Ожидающие регистрации";
const BTN_APPROVE = "✅ Одобрить пользователя";
const BTN_BAN = "⛔ Забанить пользователя";
const BTN_UNBAN = "♻️ Разбанить пользователя";
const BTN_DELETE = "🗑️ Удалить пользователя";
const BTN_NOTICE = "📣 Уведомление на сайт";
const BTN_CANCEL = "❌ Отмена";

const pendingActions = new Map<string, PendingAction>();

function isAdminChat(chatId: number | undefined): boolean {
  return chatId !== undefined && String(chatId) === env.ADMIN_CHAT_ID;
}

function chatKey(chatId: number): string {
  return String(chatId);
}

function isMenuButtonText(text: string): boolean {
  return [
    BTN_STATS,
    BTN_USERS,
    BTN_PENDING,
    BTN_APPROVE,
    BTN_BAN,
    BTN_UNBAN,
    BTN_DELETE,
    BTN_NOTICE,
    BTN_CANCEL
  ].includes(text);
}

function formatStatus(status: string): string {
  if (status === "APPROVED") return "одобрен";
  if (status === "PENDING") return "ожидает";
  if (status === "BLOCKED") return "заблокирован";
  return status;
}

function formatRole(role: string): string {
  if (role === "ADMIN") return "админ";
  if (role === "USER") return "пользователь";
  return role;
}

function menuKeyboard() {
  const keyboard = Markup.keyboard([
    [BTN_STATS, BTN_USERS],
    [BTN_PENDING, BTN_APPROVE],
    [BTN_BAN, BTN_UNBAN],
    [BTN_DELETE, BTN_NOTICE],
    [BTN_CANCEL]
  ]).resize();

  return {
    ...keyboard,
    reply_markup: {
      ...keyboard.reply_markup,
      one_time_keyboard: false,
      is_persistent: true,
      input_field_placeholder: "Выберите действие"
    }
  };
}

async function sendMainMenu(chatId: number): Promise<void> {
  pendingActions.delete(chatKey(chatId));
  await bot.telegram.sendMessage(
    chatId,
    "Панель администратора Library. Выберите действие:",
    menuKeyboard()
  );
}

async function sendAdminMessage(chatId: number, text: string): Promise<void> {
  await bot.telegram.sendMessage(chatId, text, menuKeyboard());
}

async function sendStats(chatId: number): Promise<void> {
  const stats = await getPortalStats();
  const onlineList =
    stats.onlineUsers.length === 0
      ? "никого"
      : stats.onlineUsers
          .map((user) => `${user.login} (${formatRole(user.role)}, ${formatStatus(user.status)})`)
          .join(", ");

  await bot.telegram.sendMessage(
    chatId,
    [
      "📊 Статистика портала",
      `Регистраций всего: ${stats.usersTotal}`,
      `Ожидают одобрения: ${stats.pendingUsers}`,
      `Онлайн сейчас: ${stats.onlineUsers.length}`,
      `Кто онлайн: ${onlineList}`,
      `Посещения: ${stats.visitsTotal} (за 24ч: ${stats.visitsDay})`,
      `Скачивания: ${stats.downloadsTotal} (за 24ч: ${stats.downloadsDay})`
    ].join("\n"),
    menuKeyboard()
  );
}

async function sendUsers(chatId: number): Promise<void> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, login: true, status: true, role: true, createdAt: true }
  });

  if (users.length === 0) {
    await bot.telegram.sendMessage(chatId, "👥 Пользователи не найдены", menuKeyboard());
    return;
  }

  const lines = users.map(
    (user) =>
      `#${user.id} · ${user.login} · ${formatRole(user.role)} · ${formatStatus(user.status)} · ${user.createdAt.toISOString().slice(0, 10)}`
  );

  await bot.telegram.sendMessage(chatId, ["👥 Последние пользователи", ...lines].join("\n"), menuKeyboard());
}

async function requestNotice(chatId: number): Promise<void> {
  pendingActions.set(chatKey(chatId), "notice");
  await bot.telegram.sendMessage(chatId, `Отправьте текст уведомления одним сообщением (или '${BTN_CANCEL}').`, menuKeyboard());
}

async function sendApproveCandidates(chatId: number): Promise<void> {
  pendingActions.delete(chatKey(chatId));

  const pendingUsers = await prisma.user.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { id: true, login: true }
  });

  if (pendingUsers.length === 0) {
    await sendAdminMessage(chatId, "Нет пользователей для одобрения.");
    return;
  }

  const rows = pendingUsers.map((user) => [
    Markup.button.callback(
      `✅ ${user.login} (#${user.id})`,
      makeSignedCallback("approve", user.id, env.HMAC_SECRET)
    )
  ]);

  await bot.telegram.sendMessage(
    chatId,
    `✅ Одобрение регистраций: ${pendingUsers.length}\nВыберите пользователя:`,
    Markup.inlineKeyboard(rows)
  );
}

async function sendBanCandidates(chatId: number): Promise<void> {
  pendingActions.delete(chatKey(chatId));

  const users = await prisma.user.findMany({
    where: { role: "USER", status: { in: ["APPROVED", "PENDING"] } },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, login: true, status: true }
  });

  if (users.length === 0) {
    await sendAdminMessage(chatId, "Нет пользователей для блокировки.");
    return;
  }

  const rows = users.map((user) => [
    Markup.button.callback(
      `⛔ ${user.login} (#${user.id}, ${formatStatus(user.status)})`,
      makeSignedCallback("ban", user.id, env.HMAC_SECRET)
    )
  ]);

  await bot.telegram.sendMessage(
    chatId,
    "Выберите пользователя для блокировки:",
    Markup.inlineKeyboard(rows)
  );
}

async function sendUnbanCandidates(chatId: number): Promise<void> {
  pendingActions.delete(chatKey(chatId));

  const blockedUsers = await prisma.user.findMany({
    where: { status: "BLOCKED" },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, login: true, role: true }
  });

  if (blockedUsers.length === 0) {
    await sendAdminMessage(chatId, "Нет пользователей для разблокировки.");
    return;
  }

  const rows = blockedUsers.map((user) => [
    Markup.button.callback(
      `♻️ ${user.login} (#${user.id})`,
      makeSignedCallback("unban", user.id, env.HMAC_SECRET)
    )
  ]);

  await bot.telegram.sendMessage(
    chatId,
    "Выберите пользователя для разблокировки:",
    Markup.inlineKeyboard(rows)
  );
}

async function sendDeleteCandidates(chatId: number): Promise<void> {
  pendingActions.delete(chatKey(chatId));

  const users = await prisma.user.findMany({
    where: { role: "USER" },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, login: true, status: true }
  });

  if (users.length === 0) {
    await sendAdminMessage(chatId, "Нет пользователей для удаления.");
    return;
  }

  const rows = users.map((user) => [
    Markup.button.callback(
      `🗑️ ${user.login} (#${user.id}, ${formatStatus(user.status)})`,
      makeSignedCallback("delete", user.id, env.HMAC_SECRET)
    )
  ]);

  await bot.telegram.sendMessage(
    chatId,
    "Выберите пользователя для удаления:",
    Markup.inlineKeyboard(rows)
  );
}

async function sendPendingCandidates(chatId: number): Promise<void> {
  pendingActions.delete(chatKey(chatId));

  const pendingUsers = await prisma.user.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: 30,
    select: { id: true, login: true }
  });

  if (pendingUsers.length === 0) {
    await sendAdminMessage(chatId, "Нет ожидающих регистраций.");
    return;
  }

  const rows = pendingUsers.map((user) => [
    Markup.button.callback(`✅ ${user.login}`, makeSignedCallback("approve", user.id, env.HMAC_SECRET)),
    Markup.button.callback(`❌ ${user.login}`, makeSignedCallback("reject", user.id, env.HMAC_SECRET))
  ]);

  await bot.telegram.sendMessage(
    chatId,
    `🕒 Ожидающие регистрации: ${pendingUsers.length}\nВыберите действие для пользователя:`,
    Markup.inlineKeyboard(rows)
  );
}

bot.start(async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) {
    if (ctx.chat?.id) {
      await bot.telegram.sendMessage(ctx.chat.id, "Access denied");
    }
    return;
  }

  await sendMainMenu(ctx.chat.id);
});

bot.command("menu", async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendMainMenu(ctx.chat.id);
});

bot.command("cancel", async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  pendingActions.delete(chatKey(ctx.chat.id));
  await sendAdminMessage(ctx.chat.id, "Действие отменено.");
});

bot.command("stats", async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendStats(ctx.chat.id);
});

bot.command("users", async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendUsers(ctx.chat.id);
});

bot.command("notice", async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;

  const raw = "text" in ctx.message ? ctx.message.text : "";
  const text = raw.replace(/^\/notice(@[a-zA-Z0-9_]+)?\s*/i, "").trim();

  if (!text) {
    await sendAdminMessage(ctx.chat.id, "Использование: /notice <текст уведомления>");
    return;
  }

  try {
    await publishNotice(text.slice(0, 500), null);
    pendingActions.delete(chatKey(ctx.chat.id));
    await sendAdminMessage(ctx.chat.id, "📣 Уведомление опубликовано через /notice.");
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error("Notice publish failed via command", error);
    await sendAdminMessage(ctx.chat.id, "Ошибка публикации уведомления через /notice.");
  }
});

bot.hears(BTN_STATS, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendStats(ctx.chat.id);
});

bot.hears(BTN_USERS, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendUsers(ctx.chat.id);
});

bot.hears(BTN_PENDING, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendPendingCandidates(ctx.chat.id);
});

bot.hears(BTN_APPROVE, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendApproveCandidates(ctx.chat.id);
});

bot.hears(BTN_BAN, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendBanCandidates(ctx.chat.id);
});

bot.hears(BTN_UNBAN, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendUnbanCandidates(ctx.chat.id);
});

bot.hears(BTN_DELETE, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await sendDeleteCandidates(ctx.chat.id);
});

bot.hears(BTN_NOTICE, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  await requestNotice(ctx.chat.id);
});

bot.hears(BTN_CANCEL, async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) return;
  pendingActions.delete(chatKey(ctx.chat.id));
  await sendAdminMessage(ctx.chat.id, "Действие отменено.");
});

bot.on("text", async (ctx) => {
  if (!isAdminChat(ctx.chat?.id)) {
    return;
  }

  const text = ctx.message.text.trim();
  const key = chatKey(ctx.chat.id);
  const pending = pendingActions.get(key);

  if (pending === "notice") {
    if (!text) {
      await sendAdminMessage(ctx.chat.id, "Пустое сообщение. Введите текст уведомления или нажмите отмену.");
      return;
    }

    if (text === BTN_CANCEL) {
      pendingActions.delete(key);
      await sendAdminMessage(ctx.chat.id, "Публикация уведомления отменена.");
      return;
    }

    if (isMenuButtonText(text)) {
      await sendAdminMessage(
        ctx.chat.id,
        "Сейчас включен режим публикации. Отправьте обычный текст уведомления (не кнопку из меню)."
      );
      return;
    }

    try {
      await publishNotice(text.slice(0, 500), null);
      pendingActions.delete(key);
      await sendAdminMessage(ctx.chat.id, "📣 Уведомление опубликовано.");
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("Notice publish failed", error);
      await sendAdminMessage(ctx.chat.id, "Ошибка публикации уведомления. Попробуйте еще раз.");
    }
    return;
  }

  if (isMenuButtonText(text)) {
    return;
  }

  await sendAdminMessage(ctx.chat.id, "Выберите действие из меню ниже.");
});

bot.on("callback_query", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!isAdminChat(chatId)) {
    await ctx.answerCbQuery("Access denied");
    return;
  }

  const data = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const verified = verifySignedCallback(data, env.HMAC_SECRET);

  if (!verified.valid) {
    await ctx.answerCbQuery("Invalid signature", { show_alert: true });
    return;
  }

  try {
    let actionMessage = "";

    if (verified.action === "delete") {
      try {
        const deleted = await deleteUserAccount(verified.userId, null, `tg:${chatId}`);
        actionMessage = `🗑️ Пользователь ${deleted.login} удален из системы.`;
      } catch (error) {
        if (error instanceof Error && error.message === "CANNOT_DELETE_ADMIN") {
          await ctx.answerCbQuery("Нельзя удалить администратора", { show_alert: true });
          return;
        }
        if (error instanceof Error && error.message === "USER_NOT_FOUND") {
          await ctx.answerCbQuery("Пользователь уже удален", { show_alert: true });
          return;
        }
        throw error;
      }
    } else {
      const updated = await moderateUser(verified.userId, verified.action, null, `tg:${chatId}`);
      const actionText = {
        approve: `✅ Пользователь ${updated.login} добавлен в систему.`,
        reject: `❌ Регистрация пользователя ${updated.login} отменена.`,
        ban: `⛔ Пользователь ${updated.login} заблокирован.`,
        unban: `♻️ Пользователь ${updated.login} разблокирован.`
      } as const;
      actionMessage = actionText[verified.action];
    }

    await ctx.answerCbQuery("Выполнено");

    const messageText =
      ctx.callbackQuery.message && "text" in ctx.callbackQuery.message ? ctx.callbackQuery.message.text : "";
    const isBulkListMessage =
      messageText.startsWith("🕒 Ожидающие регистрации") ||
      messageText.startsWith("Выберите пользователя для разблокировки") ||
      messageText.startsWith("Выберите пользователя для блокировки") ||
      messageText.startsWith("Выберите пользователя для удаления") ||
      messageText.startsWith("✅ Одобрение регистраций");

    if (!isBulkListMessage) {
      await ctx.editMessageReplyMarkup({ inline_keyboard: [] }).catch(() => undefined);
    }

    await bot.telegram.sendMessage(chatId!, actionMessage, menuKeyboard());
  } catch (error) {
    await ctx.answerCbQuery("Action failed", { show_alert: true });
    // eslint-disable-next-line no-console
    console.error("Callback action failed", error);
  }
});

async function bootstrap(): Promise<void> {
  await ensureSqliteWal();
  await bot.launch({ dropPendingUpdates: true });
  // eslint-disable-next-line no-console
  console.log("Telegram bot started in long polling mode");
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error("Failed to start bot", error);
  process.exit(1);
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
