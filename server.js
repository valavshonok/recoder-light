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
    НАСТРОЙКИ БУФЕРА CHUNK
    --------------------------------------------------
*/

const CHUNK_BUFFER_SIZE = 4;

/*
    --------------------------------------------------
    ОЧИСТКА ИМЕНИ ФАЙЛА
    --------------------------------------------------
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
    ЗАПИСЬ CHUNK ИЗ БУФЕРА
    --------------------------------------------------

    Берём chunk с самым маленьким номером.

    Если он уже был записан или устарел —
    просто удаляем его из буфера.

    В файл записываем только chunk,
    который идёт следующим после lastChunk.
*/

function flushSmallestChunk(recording) {
  if (recording.chunkBuffer.size === 0) {
    return false;
  }

  // Получаем самый маленький номер chunk.
  const chunkNumbers = [...recording.chunkBuffer.keys()];
  const smallestChunkNumber = Math.min(...chunkNumbers);

  const chunk = recording.chunkBuffer.get(smallestChunkNumber);

  // Удаляем из буфера сразу.
  recording.chunkBuffer.delete(smallestChunkNumber);

  /*
        Если chunk уже был записан —
        просто пропускаем его.
    */
  if (smallestChunkNumber <= recording.lastChunk) {
    console.log(
      `Skipping old chunk ${smallestChunkNumber} -> ${recording.filename}`,
    );

    return true;
  }

  /*
        Записываем chunk в конец файла.
    */
  fs.appendFileSync(recording.filePath, chunk);

  recording.lastChunk = smallestChunkNumber;

  console.log(`Chunk ${smallestChunkNumber} -> ${recording.filename}`);

  return true;
}

/*
    --------------------------------------------------
    ОПУСТОШИТЬ БУФЕР
    --------------------------------------------------

    Используется при finish.

    Например:

    lastChunk = 10

    buffer:
    11
    12
    13

    Запишет:

    11
    12
    13
*/

function flushAllChunks(recording) {
  while (recording.chunkBuffer.size > 0) {
    const chunkNumbers = [...recording.chunkBuffer.keys()];
    const smallestChunkNumber = Math.min(...chunkNumbers);

    const chunk = recording.chunkBuffer.get(smallestChunkNumber);

    recording.chunkBuffer.delete(smallestChunkNumber);

    /*
            Старый chunk.
        */
    if (smallestChunkNumber <= recording.lastChunk) {
      console.log(
        `Skipping old chunk ${smallestChunkNumber} -> ${recording.filename}`,
      );

      continue;
    }

    /*
            Если обнаружилась дырка —
            мы не можем безопасно собрать видео.
        */
    if (smallestChunkNumber !== recording.lastChunk + 1) {
      console.error(
        `Missing chunk before ${smallestChunkNumber} -> ${recording.filename}`,
        {
          lastChunk: recording.lastChunk,
          received: smallestChunkNumber,
        },
      );

      // Возвращаем chunk обратно.
      recording.chunkBuffer.set(smallestChunkNumber, chunk);

      return false;
    }

    fs.appendFileSync(recording.filePath, chunk);

    recording.lastChunk = smallestChunkNumber;

    console.log(`Chunk ${smallestChunkNumber} -> ${recording.filename}`);
  }

  return true;
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
        */
    const id = crypto.randomUUID();

    /*
            Получаем имя файла.
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

      // Имя пользователя
      name,

      // Реальное имя файла
      filename,

      // Путь
      filePath,

      status: "recording",

      createdAt: new Date().toISOString(),

      /*
                Последний chunk,
                реально записанный в файл.
            */
      lastChunk: -1,

      /*
                Буфер chunks.

                key   = номер chunk
                value = Buffer
            */
      chunkBuffer: new Map(),
    });

    console.log(`Recording started: ${filename}`);

    res.json({
      success: true,
      id,
      name,
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
                --------------------------------------------------
                ЕСЛИ CHUNK УЖЕ ЗАПИСАН
                --------------------------------------------------

                Например:

                lastChunk = 10

                пришёл chunk 7

                Он нам уже не нужен.
            */

      if (chunkNumber <= recording.lastChunk) {
        return res.json({
          success: true,
          duplicate: true,
          skipped: true,
          chunkNumber,
        });
      }

      /*
                --------------------------------------------------
                ЕСЛИ CHUNK УЖЕ ЕСТЬ В БУФЕРЕ
                --------------------------------------------------
            */

      if (recording.chunkBuffer.has(chunkNumber)) {
        return res.json({
          success: true,
          duplicate: true,
          buffered: true,
          chunkNumber,
        });
      }

      /*
                --------------------------------------------------
                КЛАДЁМ CHUNK В БУФЕР
                --------------------------------------------------
            */

      recording.chunkBuffer.set(chunkNumber, req.body);

      console.log(
        `Chunk ${chunkNumber} buffered -> ${recording.filename}`,
        `(buffer: ${recording.chunkBuffer.size}/${CHUNK_BUFFER_SIZE})`,
      );

      /*
                --------------------------------------------------
                ЕСЛИ БУФЕР ДОСТИГ 4
                --------------------------------------------------

                Пытаемся записать самый маленький chunk.
            */

      if (recording.chunkBuffer.size >= CHUNK_BUFFER_SIZE) {
        flushSmallestChunk(recording);
      }

      /*
                ACK отправляем сразу.

                Клиенту не нужно ждать,
                пока chunk физически попадёт в файл.
            */
      return res.json({
        success: true,
        chunkNumber,
        buffered: true,
        bufferSize: recording.chunkBuffer.size,
        lastChunk: recording.lastChunk,
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

    /*
            --------------------------------------------------
            СНАЧАЛА ОПУСТОШАЕМ БУФЕР
            --------------------------------------------------
        */

    const flushed = flushAllChunks(recording);

    if (!flushed) {
      return res.status(409).json({
        error: "Невозможно завершить запись: отсутствует chunk",
        lastChunk: recording.lastChunk,
        bufferedChunks: [...recording.chunkBuffer.keys()].sort((a, b) => a - b),
      });
    }

    /*
            Теперь все полученные chunks записаны.
        */

    recording.status = "finished";

    recording.finishedAt = new Date().toISOString();

    const stats = fs.statSync(recording.filePath);

    recording.size = stats.size;

    console.log(`Recording finished: ${recording.filename}`);

    res.json({
      success: true,

      id: recording.id,

      name: recording.name,

      filename: recording.filename,

      size: recording.size,

      lastChunk: recording.lastChunk,
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

    lastChunk: recording.lastChunk,

    bufferedChunks: recording.chunkBuffer
      ? [...recording.chunkBuffer.keys()].sort((a, b) => a - b)
      : [],
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
