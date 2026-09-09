let recorder = null;
let stream = null;

let recordingId = null;
let recordingName = null;

let nextChunkNumber = 0;

let isRecording = false;
let isStopping = false;

const CHUNK_INTERVAL = 5000;

const startButton = document.getElementById("startButton");

const stopButton = document.getElementById("stopButton");

const recordingNameInput = document.getElementById("recordingName");

const statusElement = document.getElementById("status");

/*
    --------------------------------------------------
    STATUS
    --------------------------------------------------
*/

function setStatus(text) {
  statusElement.textContent = text;
}

/*
    --------------------------------------------------
    START
    --------------------------------------------------
*/

async function startRecording() {
  if (isRecording) {
    return;
  }

  const name = recordingNameInput.value.trim();

  if (!name) {
    alert("Введите название записи");

    recordingNameInput.focus();

    return;
  }

  try {
    /*
            Запрашиваем только экран.

            Камера:
            НЕТ

            Микрофон:
            НЕТ
        */
    setStatus("Выберите экран для записи...");

    stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: false,
    });

    /*
            Создаём запись
            на сервере.
        */
    setStatus("Создаём запись...");

    const response = await fetch("/api/recordings/start", {
      method: "POST",

      headers: {
        "Content-Type": "application/json",
      },

      body: JSON.stringify({
        name,
      }),
    });

    if (!response.ok) {
      throw new Error("Не удалось создать запись");
    }

    const data = await response.json();

    recordingId = data.id;

    recordingName = data.name;

    nextChunkNumber = 0;

    console.log("Recording ID:", recordingId);

    console.log("Filename:", data.filename);

    /*
            Создаём MediaRecorder.
        */
    recorder = new MediaRecorder(stream, {
      mimeType: "video/webm",
    });

    /*
            ------------------------------------------------
            CHUNK
            ------------------------------------------------
        */

    recorder.addEventListener("dataavailable", async (event) => {
      if (!event.data || event.data.size === 0) {
        return;
      }

      const chunkNumber = nextChunkNumber++;

      await uploadChunk(event.data, chunkNumber);
    });

    /*
            Когда запись полностью остановлена.
        */
    recorder.addEventListener("stop", async () => {
      await finishRecording();
    });

    /*
            Пользователь может нажать
            "Stop sharing" в браузере.
        */
    const videoTrack = stream.getVideoTracks()[0];

    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        if (isRecording && !isStopping) {
          stopRecording();
        }
      });
    }

    /*
            Запускаем запись.

            Примерно каждые 5 секунд
            будет приходить chunk.
        */
    recorder.start(CHUNK_INTERVAL);

    isRecording = true;
    isStopping = false;

    startButton.disabled = true;
    stopButton.disabled = false;

    recordingNameInput.disabled = true;

    setStatus(`Идёт запись: ${recordingName}`);
  } catch (error) {
    console.error(error);

    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    stream = null;
    recorder = null;
    recordingId = null;

    isRecording = false;
    isStopping = false;

    setStatus("Запись не запущена");
  }
}

/*
    --------------------------------------------------
    UPLOAD CHUNK
    --------------------------------------------------
*/

async function uploadChunk(blob, chunkNumber) {
  if (!recordingId) {
    return;
  }

  try {
    setStatus(`Идёт запись. Отправка chunk ${chunkNumber}...`);

    const response = await fetch(`/api/recordings/${recordingId}/chunk`, {
      method: "POST",

      headers: {
        "Content-Type": "video/webm",

        "X-Chunk-Number": String(chunkNumber),
      },

      body: blob,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    await response.json();

    setStatus(`Идёт запись: ${recordingName}`);
  } catch (error) {
    console.error(`Ошибка chunk ${chunkNumber}:`, error);

    setStatus(`Ошибка отправки chunk ${chunkNumber}`);
  }
}

/*
    --------------------------------------------------
    STOP
    --------------------------------------------------
*/

function stopRecording() {
  if (!recorder || !isRecording || isStopping) {
    return;
  }

  isStopping = true;

  setStatus("Останавливаем запись...");

  /*
        stop() вызовет последний
        dataavailable.
    */
  recorder.stop();

  /*
        Останавливаем screen capture.
    */
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/*
    --------------------------------------------------
    FINISH
    --------------------------------------------------
*/

async function finishRecording() {
  if (!recordingId) {
    return;
  }

  const id = recordingId;

  try {
    /*
            Даём последнему chunk
            немного времени на отправку.

            Для текущего простого MVP
            этого достаточно при нормальной сети.
        */
    await new Promise((resolve) => setTimeout(resolve, 300));

    setStatus("Завершаем запись...");

    const response = await fetch(`/api/recordings/${id}/finish`, {
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    console.log("Finished:", data);

    setStatus(`Готово: ${data.filename}`);
  } catch (error) {
    console.error(error);

    setStatus("Ошибка завершения записи");
  } finally {
    recorder = null;
    stream = null;
    recordingId = null;
    recordingName = null;

    nextChunkNumber = 0;

    isRecording = false;
    isStopping = false;

    startButton.disabled = false;
    stopButton.disabled = true;

    recordingNameInput.disabled = false;
  }
}

/*
    --------------------------------------------------
    BEFORE UNLOAD
    --------------------------------------------------
*/

window.addEventListener("beforeunload", (event) => {
  if (!isRecording) {
    return;
  }

  event.preventDefault();
  event.returnValue = "";
});

/*
    --------------------------------------------------
    BUTTONS
    --------------------------------------------------
*/

startButton.addEventListener("click", startRecording);

stopButton.addEventListener("click", stopRecording);
