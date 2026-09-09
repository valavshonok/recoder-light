const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

const RECORDINGS_DIR = path.join(__dirname, "recordings");

// Создаём папку recordings,
// если её ещё нет.
fs.mkdirSync(RECORDINGS_DIR, {
  recursive: true,
});

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

/*
    Пока используем Map.

    В дальнейшем здесь будет БД,
    где будут храниться:

    id
    name
    filename
    status
    createdAt
    userId
*/
const recordings = new Map();

/*
    --------------------------------------------------
    ОЧИСТКА ИМЕНИ ФАЙЛА
    --------------------------------------------------

    Пользователь может написать:

    Лекция по Node.js

    Получим:

    Лекция по Node.js.webm

    Но нельзя позволять пользователю
    передавать ../ и подобные вещи.
*/
function sanitizeFileName(name) {
  let result = String(name || "").trim();

  // Убираем расширение .webm,
  // если пользователь его сам написал.
  result = result.replace(/\.webm$/i, "");

  // Заменяем опасные символы.
  result = result.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");

  // Убираем точки/пробелы в конце.
  result = result.replace(/[. ]+$/g, "");

  // Ограничиваем длину.
  result = result.substring(0, 150);

  // Если после очистки ничего не осталось.
  if (!result) {
    result = "recording";
  }

  return result;
}

/*
    --------------------------------------------------
    ПОЛУЧЕНИЕ СВОБОДНОГО ИМЕНИ
    --------------------------------------------------

    Например:

    lecture.webm
    lecture (1).webm
    lecture (2).webm
*/
function getUniqueFileName(name) {
  const safeName = sanitizeFileName(name);

  let number = 0;

  while (true) {
    let filename;

    if (number === 0) {
      filename = `${safeName}.webm`;
    } else {
      filename = `${safeName} (${number}).webm`;
    }

    const filePath = path.join(RECORDINGS_DIR, filename);

    /*
            Проверяем существование.
        */
    if (!fs.existsSync(filePath)) {
      return {
        filename,
        filePath,
      };
    }

    number++;
  }
}

/*
    --------------------------------------------------
    START RECORDING
    --------------------------------------------------
*/

app.post("/api/recordings/start", (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();

    if (!name) {
      return res.status(400).json({
        error: "Название записи обязательно",
      });
    }

    if (name.length > 200) {
      return res.status(400).json({
        error: "Название слишком длинное",
      });
    }

    /*
                Генерируем внутренний ID.

                Он НЕ используется как имя файла.
            */
    const id = crypto.randomUUID();

    /*
                Получаем:

                lecture.webm

                или:

                lecture (1).webm
            */
    const { filename, filePath } = getUniqueFileName(name);

    /*
                Создаём пустой файл.
            */
    fs.writeFileSync(filePath, "");

    /*
                Сохраняем информацию
                о текущей записи.
            */
    recordings.set(id, {
      id,

      // Имя, которое ввёл пользователь
      name,

      // Реальное имя файла
      filename,

      // Путь на сервере
      filePath,

      status: "recording",

      createdAt: new Date().toISOString(),

      lastChunk: -1,
    });

    console.log(`Recording started: ${filename}`);

    res.json({
      success: true,

      // Клиенту нужен только ID
      id,

      // Можно показать пользователю
      name,

      // Для информации
      filename,
    });
  } catch (error) {
    console.error("START ERROR:", error);

    res.status(500).json({
      error: "Не удалось создать запись",
    });
  }
});

/*
    --------------------------------------------------
    CHUNK
    --------------------------------------------------

    Получаем бинарный WebM chunk.
*/

app.post(
  "/api/recordings/:id/chunk",

  express.raw({
    type: "video/webm",
    limit: "100mb",
  }),

  (req, res) => {
    try {
      const { id } = req.params;

      const recording = recordings.get(id);

      if (!recording) {
        return res.status(404).json({
          error: "Запись не найдена",
        });
      }

      if (recording.status !== "recording") {
        return res.status(400).json({
          error: "Запись уже завершена",
        });
      }

      const chunkNumber = Number(req.headers["x-chunk-number"]);

      if (!Number.isInteger(chunkNumber) || chunkNumber < 0) {
        return res.status(400).json({
          error: "Некорректный номер chunk",
        });
      }

      if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({
          error: "Некорректные данные",
        });
      }

      /*
                Если браузер повторно прислал
                уже сохранённый chunk —
                второй раз его не записываем.
            */
      if (chunkNumber <= recording.lastChunk) {
        return res.json({
          success: true,
          duplicate: true,
          chunkNumber,
        });
      }

      /*
                Ждём chunks по порядку.

                Например:

                0
                1
                2
                3
            */
      if (chunkNumber !== recording.lastChunk + 1) {
        return res.status(409).json({
          error: "Chunk пришёл не по порядку",

          expected: recording.lastChunk + 1,

          received: chunkNumber,
        });
      }

      /*
                Дописываем chunk
                в нужный файл.
            */
      fs.appendFileSync(recording.filePath, req.body);

      recording.lastChunk = chunkNumber;

      console.log(`Chunk ${chunkNumber} -> ${recording.filename}`);

      /*
                ACK.
            */
      res.json({
        success: true,
        chunkNumber,
      });
    } catch (error) {
      console.error("CHUNK ERROR:", error);

      res.status(500).json({
        error: "Ошибка сохранения chunk",
      });
    }
  },
);

/*
    --------------------------------------------------
    FINISH
    --------------------------------------------------
*/

app.post("/api/recordings/:id/finish", (req, res) => {
  try {
    const { id } = req.params;

    const recording = recordings.get(id);

    if (!recording) {
      return res.status(404).json({
        error: "Запись не найдена",
      });
    }

    if (recording.status === "finished") {
      return res.json({
        success: true,
        filename: recording.filename,
      });
    }

    if (!fs.existsSync(recording.filePath)) {
      return res.status(500).json({
        error: "Файл записи не найден",
      });
    }

    recording.status = "finished";

    recording.finishedAt = new Date().toISOString();

    const stats = fs.statSync(recording.filePath);

    recording.size = stats.size;

    console.log(`Recording finished: ${recording.filename}`);

    /*
                ПОЗЖЕ ЗДЕСЬ БУДЕТ:

                uploadToYandexDisk(...)

                после успешной загрузки:

                fs.unlinkSync(recording.filePath)
            */

    res.json({
      success: true,

      id: recording.id,

      name: recording.name,

      filename: recording.filename,

      size: recording.size,
    });
  } catch (error) {
    console.error("FINISH ERROR:", error);

    res.status(500).json({
      error: "Не удалось завершить запись",
    });
  }
});

/*
    --------------------------------------------------
    INFORMATION
    --------------------------------------------------
*/

app.get("/api/recordings/:id", (req, res) => {
  const recording = recordings.get(req.params.id);

  if (!recording) {
    return res.status(404).json({
      error: "Запись не найдена",
    });
  }

  res.json({
    id: recording.id,
    name: recording.name,
    filename: recording.filename,
    status: recording.status,
    createdAt: recording.createdAt,
    finishedAt: recording.finishedAt || null,
    size: recording.size || 0,
  });
});

/*
    --------------------------------------------------
    SERVER
    --------------------------------------------------
*/

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on port ${PORT}`);
});
