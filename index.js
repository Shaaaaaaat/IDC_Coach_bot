require("dotenv").config();
const { Bot, GrammyError, HttpError, InlineKeyboard } = require("grammy");
const { hydrate } = require("@grammyjs/hydrate");
const axios = require("axios");

const bot = new Bot(process.env.BOT_API_KEY);
bot.use(hydrate());

const AIRTABLE_API = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE = process.env.AIRTABLE_TABLE_ID;
const AIRTABLE_PLACES = process.env.AIRTABLE_PLACES_TABLE_ID;
const AIRTABLE_SMS = process.env.AIRTABLE_SMS_ID;
const AIRTABLE_PNL = process.env.AIRTABLE_PNL_ID;

const SECONDARY_CHAT = -1002203093713;

const airtableUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_TABLE}`;
const airtablePlacesUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_PLACES}`;
const airtableMessagesUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_SMS}`;
const airtablePnlUrl = `https://api.airtable.com/v0/${AIRTABLE_BASE}/${AIRTABLE_PNL}`;

const allowedUsers = [
  "Lokatororator",
  "Shaaaaaaat",
  "kapitanstar_coach",
  "RomanGribanov",
  "Gshakhnazarov",
  "dima_dubinin",
];

let userStates = {};

const BUTTONS_PER_PAGE = 7;

// Очередь сообщений
const messageQueue = [];
let isProcessingQueue = false;

const fetchDataFromAirtable = async (username, url) => {
  let records = [];
  let offset = null;

  do {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API}`,
      },
      params: {
        offset: offset,
        pageSize: 100,
      },
    });

    records = records.concat(response.data.records);
    offset = response.data.offset;
  } while (offset);

  const filteredRecords = records
    .filter(
      (record) => record.fields.Coach && record.fields.Coach.includes(username)
    )
    .map((record) => ({
      name: record.fields.FIO3,
      place: record.fields.Places,
      meaning: record.fields.Meanings,
    }));

  console.log("Fetched records:", filteredRecords);
  return filteredRecords;
};

const resetUserState = (userId) => {
  if (userStates[userId]) {
    console.log(`Сбрасываем состояние для пользователя ${userId}`);
    delete userStates[userId];
  }
};

const createKeyboard = (page, format, userId) => {
  const userState = userStates[userId];

  if (!userState || userState.buttonTexts.length === 0) {
    console.log("Данные для кнопок не загружены!");
    return { keyboard: new InlineKeyboard(), currentSelection: "Нет данных" };
  }

  const keyboard = new InlineKeyboard();
  const start = page * BUTTONS_PER_PAGE;
  const end = start + BUTTONS_PER_PAGE;
  const pageButtons = userState.buttonTexts.slice(start, end);

  if (page > 0 && end < userState.buttonTexts.length) {
    keyboard
      .text("⬅️ Назад", `prev_${page}`)
      .text("Еще люди ➡️", `next_${page}`)
      .row();
  } else if (page > 0) {
    keyboard.text("⬅️ Назад", `prev_${page}`).row();
  } else if (end < userState.buttonTexts.length) {
    keyboard.text("Еще люди ➡️", `next_${page}`).row();
  }

  pageButtons.forEach((text) => {
    let buttonText;
    if (format === "ds") {
      const count = userState.buttonCounters[text] || 0;
      buttonText = `(${count}) ${text}`;
      keyboard.text("➖", `minus_${text}`).text(buttonText, text).row();
    } else {
      buttonText = userState.buttonStates[text] ? `${text} ✅` : text;
      keyboard.text(buttonText, text).row();
    }
  });

  keyboard.text("⬅️ Вернуться", "back_to_location").text("ГОТОВО ✅", "done");

  console.log("Created keyboard for page", page, "with buttons:", pageButtons);

  let currentSelection = `*Введенные данные:*\n📅 Дата: ${
    userState.selectedDate || "---"
  }\n🤸 Тип тренировки: ${userState.selectedFormat || "---"}`;

  if (userState.selectedFormat !== "ds") {
    currentSelection += `\n📍 Место: ${userState.selectedLocation || "---"}`;
  }

  const selectedNames = Object.keys(userState.buttonStates).filter(
    (key) => userState.buttonStates[key]
  );
  const selectedCounts = Object.keys(userState.buttonCounters)
    .filter((key) => userState.buttonCounters[key] > 0)
    .map((key) => `${userState.buttonCounters[key]}x ${key}`);

  if (userState.selectedFormat === "ds") {
    currentSelection += `\n👥 Люди: ${selectedCounts.join(", ") || "---"}`;
  } else {
    currentSelection += `\n👥 Люди: ${selectedNames.join(", ") || "---"}`;
  }

  return { keyboard, currentSelection };
};

const createDateKeyboard = () => {
  const keyboard = new InlineKeyboard();

  const now = new Date();
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(now);
    date.setDate(now.getDate() - i);
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    dates.push(`${day}.${month}`);
  }

  keyboard.text(dates[0], dates[0]).row();
  for (let i = 4; i > 0; i--) {
    keyboard.text(dates[i], dates[i]);
  }
  keyboard.row();

  keyboard.text("🔄 Обновить даты", "refresh_dates").row();
  keyboard.text("💰 Посмотреть начисления", "view_pnl").row();

  return keyboard;
};

const createFormatKeyboard = () => {
  const keyboard = new InlineKeyboard()
    .text("ds", "ds")
    .row()
    .text("group", "group")
    .row()
    .text("personal", "personal")
    .row()
    .text("⬅️ Вернуться", "back_to_dates")
    .row();

  return keyboard;
};

const createLocationKeyboard = (locations) => {
  const keyboard = new InlineKeyboard();
  locations.forEach((location) => {
    keyboard
      .text(
        location.place.charAt(0).toUpperCase() + location.place.slice(1),
        `location_${location.meaning}`
      )
      .row();
  });
  keyboard.text("⬅️ Вернуться", "back_to_format").row();
  return keyboard;
};

const sendDataToAirtable = async (data) => {
  console.log("Данные перед отправкой в Airtable:", data);  // Лог данных
  try {
    await axios.post(
      airtableMessagesUrl,
      {
        records: [
          {
            fields: data,
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Данные успешно отправлены в Airtable");
  } catch (error) {
    // Логируем полную ошибку
    if (error.response) {
      console.error("Ошибка при отправке данных в Airtable:", JSON.stringify(error.response.data, null, 2));
    } else {
      console.error("Ошибка при отправке данных в Airtable:", error.message);
    }
  }
};

const sendMessageToAirtable = async (message) => {
  try {
    console.log("Sending message to Airtable:", message);
    await axios.post(
      airtableMessagesUrl,
      {
        records: [
          {
            fields: {
              Message: message,
            },
          },
        ],
      },
      {
        headers: {
          Authorization: `Bearer ${AIRTABLE_API}`,
          "Content-Type": "application/json",
        },
      }
    );
    console.log("Message sent to Airtable successfully");
  } catch (error) {
    console.error("Error sending message to Airtable:", error);
  }
};

const sendMessagesWithPause = async (messages) => {
  for (const message of messages) {
    await sendMessageToAirtable(message);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

const compareDates = (date1, date2) => {
  const [day1, month1] = date1.split(".");
  const [day2, month2] = date2.split(".");
  const d1 = new Date(2000, month1 - 1, day1);
  const d2 = new Date(2000, month2 - 1, day2);
  return d1 >= d2;
};

const fetchPnlDataFromAirtable = async (username, startDate) => {
  let records = [];
  let offset = null;

  console.log(`Fetching PNL data from Airtable with startDate: ${startDate}`);

  const filterFormula = `OR({Coach} = '${username}', {Second_coach} = '${username}')`;

  do {
    const response = await axios.get(airtablePnlUrl, {
      headers: {
        Authorization: `Bearer ${AIRTABLE_API}`,
      },
      params: {
        offset: offset,
        pageSize: 100,
        filterByFormula: filterFormula,
      },
    });

    records = records.concat(response.data.records);
    offset = response.data.offset;
  } while (offset);

  console.log("Filtered PNL records:", records);

  const filteredRecords = records
    .filter((record) => compareDates(record.fields.Data, startDate))
    .map((record) => ({
      date: record.fields.Data,
      coach: record.fields.Coach,
      secondCoach: record.fields.Second_coach,
      format: record.fields.Format,
      place: record.fields.Place,
      expense: record.fields.Expenses_coach || 0,
      secondExpense: record.fields.Expenses_second_coach || 0,
    }));

  filteredRecords.sort((a, b) => (compareDates(a.date, b.date) ? 1 : -1));

  console.log("Filtered and sorted PNL records:", filteredRecords);
  return filteredRecords;
};

const getLastEightMondays = () => {
  const dates = [];
  const now = new Date();

  let day = now.getDay();
  let diff = day === 1 ? 0 : day <= 1 ? 7 - Math.abs(day - 1) : day - 1;
  let lastMonday = new Date(now.setDate(now.getDate() - diff));

  for (let i = 0; i < 8; i++) {
    dates.unshift(new Date(lastMonday));
    lastMonday.setDate(lastMonday.getDate() - 7);
  }

  return dates.map((date) => {
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    return `${day}.${month}`;
  });
};

const createPnlDateKeyboard = () => {
  const keyboard = new InlineKeyboard();
  const dates = getLastEightMondays();

  for (let i = 0; i < dates.length; i += 4) {
    keyboard.text(dates[i], `pnl_date_${dates[i]}`);
    if (dates[i + 1]) keyboard.text(dates[i + 1], `pnl_date_${dates[i + 1]}`);
    if (dates[i + 2]) keyboard.text(dates[i + 2], `pnl_date_${dates[i + 2]}`);
    if (dates[i + 3]) keyboard.text(dates[i + 3], `pnl_date_${dates[i + 3]}`);
    keyboard.row();
  }

  keyboard.text("⬅️ Вернуться", "back_to_dates").row();

  return keyboard;
};

// Обработка очереди сообщений
const processQueue = async () => {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (messageQueue.length > 0) {
    const message = messageQueue.shift();
    await processMessage(message);
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  isProcessingQueue = false;
};

const processMessage = async (message) => {
  const { ctx, responseText, date, format, location, selectedCounts } = message;
  const userId = ctx.from.id;

  // Логируем перед отправкой данных
  console.log("Preparing to send data to Airtable");
  console.log("User ID:", userId);
  console.log("Date:", date);
  console.log("Format:", format);
  console.log("Location:", location);
  console.log("Selected counts:", selectedCounts);

  await sendDataToAirtable({
    Date: date,
    Format: format,
    Location: location,
    "Selected Buttons": selectedCounts.join(", "),
  });

  console.log("Data sent to Airtable successfully");
  if (format === "ds") {
    const maxCount = Math.max(
      ...Object.values(userStates[userId].buttonCounters)
    );
    const messages = [];

    for (let i = 1; i <= maxCount; i++) {
      const people = Object.keys(userStates[userId].buttonCounters).filter(
        (key) => userStates[userId].buttonCounters[key] >= i
      );
      if (people.length > 0) {
        messages.push(
          `${ctx.from.username} / ${date} / ${format} // ${people.join(", ")}`
        );
      }
    }

    messages.reverse();

    await sendMessagesWithPause(messages);
  } else {
    await sendMessageToAirtable(responseText);
  }
};

const initBot = async () => {
  bot.command("start", async (ctx) => {
    const username = ctx.from.username;
    const userId = ctx.from.id;

    if (!allowedUsers.includes(username)) {
      await ctx.reply("Отказ в доступе к боту");
      return;
    }

    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }

    const currentSelection = `*Введенные данные:*\n📅 Дата: ${userStates[userId].selectedDate}\n🤸 Тип тренировки: ${userStates[userId].selectedFormat}\n📍 Место: ${userStates[userId].selectedLocation}\n👥 Люди: ---`;

    await ctx.reply(currentSelection + "\n\nВыберите дату:", {
      reply_markup: createDateKeyboard(),
      parse_mode: "Markdown",
    });
  });

  const sendDateSelection = async (ctx) => {
    const userId = ctx.from.id;
    const currentSelection = `*Введенные данные:*\n📅 Дата: ${userStates[userId].selectedDate}\n🤸 Тип тренировки: ${userStates[userId].selectedFormat}\n📍 Место: ${userStates[userId].selectedLocation}\n👥 Люди: ---`;

    await ctx.reply(currentSelection + "\n\nВыберите дату:", {
      reply_markup: createDateKeyboard(),
      parse_mode: "Markdown",
    });
  };

  bot.callbackQuery(/^\d{2}\.\d{2}$/, async (ctx) => {
    const userId = ctx.from.id;

    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const date = ctx.match[0];

    userStates[userId].selectedDate = date;

    console.log(`User ${userId} selected date: ${date}`);

    const currentSelection = `*Введенные данные:*\n📅 Дата: ${userStates[userId].selectedDate}\n🤸 Тип тренировки: ${userStates[userId].selectedFormat}\n📍 Место: ${userStates[userId].selectedLocation}\n👥 Люди: ---`;

    await ctx.editMessageText(currentSelection + "\n\nВыберите формат:", {
      reply_markup: createFormatKeyboard(),
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery(/^(ds|group|personal)$/, async (ctx) => {
    const userId = ctx.from.id;

    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const format = ctx.match[0];

    userStates[userId].selectedFormat = format;

    console.log(`User ${userId} selected format: ${format}`);

    const currentSelection = `*Введенные данные:*\n📅 Дата: ${userStates[userId].selectedDate}\n🤸 Тип тренировки: ${userStates[userId].selectedFormat}\n📍 Место: ${userStates[userId].selectedLocation}\n👥 Люди: ---`;

    if (format === "ds") {
      userStates[userId].buttonTexts = (
        await fetchDataFromAirtable(ctx.from.username, airtableUrl)
      ).map((record) => record.name);
      console.log("Button texts from Airtable:", userStates[userId].buttonTexts);

      userStates[userId].buttonTexts.sort((a, b) => a.localeCompare(b));

      // Если здесь нет данных, значит произошла ошибка при подгрузке данных
      if (userStates[userId].buttonTexts.length === 0) {
        console.log("Клиенты не загружены!");
      }

      userStates[userId].buttonStates = userStates[userId].buttonTexts.reduce(
        (acc, text) => {
          acc[text] = false;
          return acc;
        },
        {}
      );

      userStates[userId].buttonCounters = userStates[userId].buttonTexts.reduce(
        (acc, text) => {
          acc[text] = 0;
          return acc;
        },
        {}
      );

      console.log("Initial button states:", userStates[userId].buttonStates);
      console.log(
        "Initial button counters:",
        userStates[userId].buttonCounters
      );

      userStates[userId].currentPage = 0;
      const { keyboard, currentSelection } = createKeyboard(0, format, userId);
      await ctx.editMessageText(currentSelection + "\n\nВыберите людей:", {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
      ctx.answerCallbackQuery();
    } else {
      const locations = await fetchDataFromAirtable(
        ctx.from.username,
        airtablePlacesUrl
      );
      await ctx.editMessageText(currentSelection + "\n\nВыберите локацию:", {
        reply_markup: createLocationKeyboard(locations),
        parse_mode: "Markdown",
      });
    }
    ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^location_(.+)$/, async (ctx) => {
    const userId = ctx.from.id;

    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const location = ctx.match[1];

    userStates[userId].selectedLocation = location;

    console.log(`User ${userId} selected location: ${location}`);

    userStates[userId].buttonTexts = (
      await fetchDataFromAirtable(ctx.from.username, airtableUrl)
    ).map((record) => record.name);
    console.log("Button texts from Airtable:", userStates[userId].buttonTexts);

    userStates[userId].buttonTexts.sort((a, b) => a.localeCompare(b));

    userStates[userId].buttonStates = userStates[userId].buttonTexts.reduce(
      (acc, text) => {
        acc[text] = false;
        return acc;
      },
      {}
    );

    console.log("Initial button states:", userStates[userId].buttonStates);

    userStates[userId].currentPage = 0;
    const { keyboard, currentSelection } = createKeyboard(
      0,
      userStates[userId].selectedFormat,
      userId
    );
    await ctx.editMessageText(currentSelection + "\n\nВыберите людей:", {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
  });

  bot.callbackQuery(
    /^((?!done|prev_|next_|back_to_|minus_|refresh_dates|view_pnl|pnl_date_|detailed_breakdown).)+$/,
    async (ctx) => {
      const userId = ctx.from.id;
      // Инициализация состояния пользователя, если оно отсутствует
      if (!userStates[userId]) {
        userStates[userId] = {
          buttonTexts: [],
          buttonStates: {},
          buttonCounters: {},
          currentPage: 0,
          selectedDate: "---",
          selectedFormat: "---",
          selectedLocation: "---",
          pnlDataCache: {},
        };
      }
      const text = ctx.match[0];
      console.log(`Button pressed by user ${userId}:`, text);

      if (userStates[userId].selectedFormat === "ds") {
        userStates[userId].buttonCounters[text] =
          (userStates[userId].buttonCounters[text] || 0) + 1;
        console.log(
          `Button counter increased for user ${userId}:`,
          userStates[userId].buttonCounters
        );
      } else {
        if (userStates[userId].buttonTexts.includes(text)) {
          userStates[userId].buttonStates[text] =
            !userStates[userId].buttonStates[text];
          console.log(
            `Button state changed for user ${userId}:`,
            userStates[userId].buttonStates
          );
        } else {
          console.log(`Button ${text} is not in the buttonTexts array`);
        }
      }

      const page = userStates[userId].currentPage || 0;
      const { keyboard, currentSelection } = createKeyboard(
        page,
        userStates[userId].selectedFormat,
        userId
      );
      await ctx.editMessageText(currentSelection + "\n\nВыберите людей:", {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
      ctx.answerCallbackQuery();
    }
  );

  bot.callbackQuery(/^minus_(.+)$/, async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const text = ctx.match[1];
    console.log(`Minus button pressed by user ${userId}:`, text);

    if (userStates[userId].buttonCounters[text] > 0) {
      userStates[userId].buttonCounters[text] -= 1;
      console.log(
        `Button counter decreased for user ${userId}:`,
        userStates[userId].buttonCounters
      );
    }

    const page = userStates[userId].currentPage || 0;
    const { keyboard, currentSelection } = createKeyboard(
      page,
      userStates[userId].selectedFormat,
      userId
    );
    await ctx.editMessageText(currentSelection + "\n\nВыберите людей:", {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
    ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/prev_(\d+)/, async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const page = parseInt(ctx.match[1], 10) - 1;
    userStates[userId].currentPage = page;
    console.log(`User ${userId} navigated to previous page ${page}`);
    const { keyboard, currentSelection } = createKeyboard(
      page,
      userStates[userId].selectedFormat,
      userId
    );
    await ctx.editMessageText(currentSelection + "\n\nВыберите людей:", {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
    ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/next_(\d+)/, async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const page = parseInt(ctx.match[1], 10) + 1;
    userStates[userId].currentPage = page;
    console.log(`User ${userId} navigated to next page ${page}`);
    const { keyboard, currentSelection } = createKeyboard(
      page,
      userStates[userId].selectedFormat,
      userId
    );
    await ctx.editMessageText(currentSelection + "\n\nВыберите людей:", {
      reply_markup: keyboard,
      parse_mode: "Markdown",
    });
    ctx.answerCallbackQuery();
  });

  bot.callbackQuery("done", async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const username = ctx.from.username;
    console.log("Done button pressed");

    const selectedButtons = Object.keys(userStates[userId].buttonStates).filter(
      (key) => userStates[userId].buttonStates[key]
    );
    const selectedCounts = Object.keys(userStates[userId].buttonCounters)
      .filter((key) => userStates[userId].buttonCounters[key] > 0)
      .map((key) => `${userStates[userId].buttonCounters[key]}x ${key}`);

    const date = userStates[userId].selectedDate;
    const format = userStates[userId].selectedFormat;
    const location = userStates[userId].selectedLocation;

    console.log(`Selected date for user ${userId}:`, date);
    console.log(`Selected format for user ${userId}:`, format);
    console.log(`Selected location for user ${userId}:`, location);
    console.log(`Selected buttons for user ${userId}:`, selectedButtons);
    console.log(`Selected counts for user ${userId}:`, selectedCounts);

    let responseText = "";
    if (format === "ds") {
      responseText = `${username} / ${date} / ${format} // ${selectedCounts.join(
        ", "
      )}`;
    } else {
      responseText = `${username} / ${date} / ${format} / ${location} / ${selectedButtons.join(
        ", "
      )}`;
    }

    console.log("Response text:", responseText);

    try {
      await ctx.editMessageText(responseText.trim(), {
        reply_markup: undefined,
      });
    } catch (err) {
      console.error("Error sending message:", err);
    }

    // Отправляем сообщение в сторонний чат
    try {
      await bot.api.sendMessage(SECONDARY_CHAT, responseText.trim());
      console.log("Message sent to secondary chat");
    } catch (err) {
      console.error("Error sending message to secondary chat:", err);
    }

    // Добавляем сообщение в очередь
    messageQueue.push({
      ctx,
      responseText,
      date,
      format,
      location,
      selectedCounts,
    });
    processQueue();

    // Сбрасываем состояние пользователя
    resetUserState(userId);

    // Инициализация состояния пользователя после сброса
    userStates[userId] = {
      buttonTexts: [],
      buttonStates: {},
      buttonCounters: {},
      currentPage: 0,
      selectedDate: "---",
      selectedFormat: "---",
      selectedLocation: "---",
      pnlDataCache: {},
    };

    try {
      await ctx.answerCallbackQuery("Ваш выбор был сохранен");
    } catch (err) {
      console.error("Error answering callback query:", err);
    }

    await sendDateSelection(ctx);
  });

  bot.callbackQuery("back_to_start", async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const currentSelection = `*Введенные данные:*\n📅 Дата: ${
      userStates[userId].selectedDate || "---"
    }\n🤸 Тип тренировки: ${
      userStates[userId].selectedFormat || "---"
    }\n📍 Место: ${userStates[userId].selectedLocation || "---"}\n👥 Люди: ---`;

    try {
      await ctx.editMessageText(currentSelection + "\n\nВыберите дату:", {
        reply_markup: createDateKeyboard(),
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Error editing message:", err);
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Error answering callback query:", err);
    }
  });

  bot.callbackQuery("back_to_dates", async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const currentSelection = `*Введенные данные:*\n📅 Дата: ${
      userStates[userId].selectedDate || "---"
    }\n🤸 Тип тренировки: ${
      userStates[userId].selectedFormat || "---"
    }\n📍 Место: ${userStates[userId].selectedLocation || "---"}\n👥 Люди: ---`;

    try {
      await ctx.editMessageText(currentSelection + "\n\nВыберите дату:", {
        reply_markup: createDateKeyboard(),
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Error editing message:", err);
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Error answering callback query:", err);
    }
  });

  bot.callbackQuery("back_to_format", async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const currentSelection = `*Введенные данные:*\n📅 Дата: ${
      userStates[userId].selectedDate || "---"
    }\n🤸 Тип тренировки: ${
      userStates[userId].selectedFormat || "---"
    }\n📍 Место: ${userStates[userId].selectedLocation || "---"}\n👥 Люди: ---`;

    try {
      await ctx.editMessageText(currentSelection + "\n\nВыберите формат:", {
        reply_markup: createFormatKeyboard(),
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Error editing message:", err);
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Error answering callback query:", err);
    }
  });

  bot.callbackQuery("back_to_location", async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const format = userStates[userId].selectedFormat;

    if (format === "ds") {
      const currentSelection = `*Введенные данные:*\n📅 Дата: ${
        userStates[userId].selectedDate || "---"
      }\n🤸 Тип тренировки: ${
        userStates[userId].selectedFormat || "---"
      }\n📍 Место: ${
        userStates[userId].selectedLocation || "---"
      }\n👥 Люди: ---`;

      try {
        await ctx.editMessageText(currentSelection + "\n\nВыберите формат:", {
          reply_markup: createFormatKeyboard(),
          parse_mode: "Markdown",
        });
      } catch (err) {
        console.error("Error editing message:", err);
      }
    } else {
      const locations = await fetchDataFromAirtable(
        ctx.from.username,
        airtablePlacesUrl
      );

      const currentSelection = `*Введенные данные:*\n📅 Дата: ${
        userStates[userId].selectedDate || "---"
      }\n🤸 Тип тренировки: ${
        userStates[userId].selectedFormat || "---"
      }\n📍 Место: ${
        userStates[userId].selectedLocation || "---"
      }\n👥 Люди: ---`;

      try {
        await ctx.editMessageText(currentSelection + "\n\nВыберите локацию:", {
          reply_markup: createLocationKeyboard(locations),
          parse_mode: "Markdown",
        });
      } catch (err) {
        console.error("Error editing message:", err);
      }
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Error answering callback query:", err);
    }
  });

  bot.callbackQuery("refresh_dates", async (ctx) => {
    await ctx.answerCallbackQuery();

    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    userStates[userId].selectedDate = "---";
    userStates[userId].selectedFormat = "---";
    userStates[userId].selectedLocation = "---";

    const currentSelection = `*Введенные данные:*\n📅 Дата: ${userStates[userId].selectedDate}\n🤸 Тип тренировки: ${userStates[userId].selectedFormat}\n📍 Место: ${userStates[userId].selectedLocation}\n👥 Люди: ---`;

    try {
      await ctx.editMessageText(currentSelection + "\n\nВыберите дату:", {
        reply_markup: createDateKeyboard(),
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Error editing message:", err);
    }
  });

  bot.callbackQuery("view_pnl", async (ctx) => {
    try {
      await ctx.editMessageText("Выберите дату, с которой начать просмотр:", {
        reply_markup: createPnlDateKeyboard(),
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Error editing message:", err);
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Error answering callback query:", err);
    }
  });

  bot.callbackQuery(/^pnl_date_(\d{2}\.\d{2})$/, async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const date = ctx.match[1];
    const username = ctx.from.username;

    console.log(`User ${userId} selected PNL date: ${date}`);

    userStates[userId].pnlDataCache = await fetchPnlDataFromAirtable(
      username,
      date
    );

    const totalRevenue = userStates[userId].pnlDataCache.reduce(
      (acc, record) =>
        acc +
        (record.coach === username ? record.expense : record.secondExpense),
      0
    );

    const keyboard = new InlineKeyboard()
      .text(`Детальная разбивка (${totalRevenue} ₽)`, "detailed_breakdown")
      .row()
      .text("↩️ Вернуться в главное меню", "back_to_start")
      .row();

    try {
      await ctx.editMessageText(
        `Общий заработок с ${date}: ${totalRevenue} ₽`,
        {
          reply_markup: keyboard,
          parse_mode: "Markdown",
        }
      );
    } catch (err) {
      console.error("Error editing message:", err);
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Error answering callback query:", err);
    }
  });

  bot.callbackQuery("detailed_breakdown", async (ctx) => {
    const userId = ctx.from.id;
    // Инициализация состояния пользователя, если оно отсутствует
    if (!userStates[userId]) {
      userStates[userId] = {
        buttonTexts: [],
        buttonStates: {},
        buttonCounters: {},
        currentPage: 0,
        selectedDate: "---",
        selectedFormat: "---",
        selectedLocation: "---",
        pnlDataCache: {},
      };
    }
    const username = ctx.from.username;
    const pnlData = userStates[userId].pnlDataCache;

    const pnlText = pnlData
      .filter((record) => record.coach === username)
      .map((record) => {
        const locationText =
          record.format !== "ds" ? `, Локация: ${record.place}` : "";
        return `Дата: ${record.date}, Формат: ${record.format}${locationText}, Сумма: ${record.expense} ₽`;
      })
      .join("\n");

    const mentorText = pnlData
      .filter(
        (record) => record.secondExpense > 0 && record.secondCoach === username
      )
      .map((record) => {
        const locationText =
          record.format !== "ds" ? `, Локация: ${record.place}` : "";
        return `Дата: ${record.date}, Тренер: ${record.coach}, Формат: ${record.format}${locationText}, Сумма: ${record.secondExpense} ₽`;
      })
      .join("\n");

    let messageText = `Ваши начисления как тренера:\n${
      pnlText || "Нет данных"
    }`;

    if (mentorText) {
      messageText += `\n\nВаши начисления как ментора:\n${mentorText}`;
    }

    const keyboard = new InlineKeyboard()
      .text("↩️ Вернуться в главное меню", "back_to_start")
      .row();

    try {
      await ctx.editMessageText(messageText, {
        reply_markup: keyboard,
        parse_mode: "Markdown",
      });
    } catch (err) {
      console.error("Error editing message:", err);
    }

    try {
      await ctx.answerCallbackQuery();
    } catch (err) {
      console.error("Error answering callback query:", err);
    }
  });

  bot.catch((err) => {
    const ctx = err.ctx;
    console.error(`Error while handling update ${ctx.update.update_id}:`, err);

    if (err instanceof GrammyError) {
      console.error("Error in request:", err.description);
    } else if (err instanceof HttpError) {
      console.error("Could not contact Telegram:", err);
    } else {
      console.error("Unknown error:", err);
    }
  });

  bot.start();
};

initBot();
