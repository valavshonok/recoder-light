const filesTableBody = document.getElementById("filesTableBody");

const statusElement = document.getElementById("status");

const fileCountElement = document.getElementById("fileCount");

const storageUsageElement = document.getElementById("storageUsage");

const refreshButton = document.getElementById("refreshButton");

const deleteAllButton = document.getElementById("deleteAllButton");

const filterInput = document.getElementById("filterInput");

const sortSelect = document.getElementById("sortSelect");

/*
    --------------------------------------------------
    FILES
    --------------------------------------------------
*/

let allFiles = [];

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
    FORMAT SIZE
    --------------------------------------------------
*/

function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} Б`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} КБ`;
  }

  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} ГБ`;
}

/*
    --------------------------------------------------
    FORMAT DATE
    --------------------------------------------------
*/

function formatDate(dateString) {
  return new Date(dateString).toLocaleString("ru-RU");
}

/*
    --------------------------------------------------
    ESCAPE HTML
    --------------------------------------------------
*/

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/*
    --------------------------------------------------
    LOAD FILES
    --------------------------------------------------
*/

async function loadFiles() {
  try {
    setStatus("Загрузка списка файлов...");

    refreshButton.disabled = true;

    const response = await fetch(
      "/api/7fK29xQm8Lp4Vn2Za6RtYw3Hs9Ec/admin/files",
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    allFiles = data.files || [];

    renderFiles();

    setStatus("Список обновлён");
  } catch (error) {
    console.error(error);

    setStatus("Ошибка загрузки списка файлов");
  } finally {
    refreshButton.disabled = false;
  }
}

/*
    --------------------------------------------------
    FILTER + SORT
    --------------------------------------------------
*/

function getFilteredAndSortedFiles() {
  const filter = filterInput.value.trim().toLocaleLowerCase("ru-RU");

  const sortDirection = sortSelect.value;

  /*
      Фильтрация по названию.
  */
  let files = allFiles.filter((file) => {
    if (!filter) {
      return true;
    }

    return file.filename.toLocaleLowerCase("ru-RU").includes(filter);
  });

  /*
      Сортировка по названию.
  */
  files.sort((a, b) => {
    const nameA = a.filename;
    const nameB = b.filename;

    const result = nameA.localeCompare(nameB, "ru", {
      sensitivity: "base",
      numeric: true,
    });

    return sortDirection === "asc" ? result : -result;
  });

  return files;
}

/*
    --------------------------------------------------
    STORAGE USAGE
    --------------------------------------------------
*/

const MAX_STORAGE_BYTES = 30 * 1024 * 1024 * 1024;

function updateStorageUsage() {
  const totalBytes = allFiles.reduce((total, file) => {
    return total + Number(file.size || 0);
  }, 0);

  const usagePercent = (totalBytes / MAX_STORAGE_BYTES) * 100;

  const usedGB = totalBytes / 1024 / 1024 / 1024;

  const maxGB = MAX_STORAGE_BYTES / 1024 / 1024 / 1024;

  storageUsageElement.textContent = `Занято: ${usedGB.toFixed(2)} GB / ${maxGB} GB`;

  /*
      Сначала убираем старые классы.
  */
  storageUsageElement.classList.remove("warning", "danger");

  /*
      Меньше 10% свободного места
      = занято больше 90%.
  */
  if (usagePercent >= 90) {
    storageUsageElement.classList.add("danger");
  } else if (usagePercent >= 50) {
    /*
      Меньше половины свободного места
      = занято больше или равно 50%.
  */
    storageUsageElement.classList.add("warning");
  }
}

/*
    --------------------------------------------------
    RENDER
    --------------------------------------------------
*/

function renderFiles() {
  const files = getFilteredAndSortedFiles();
  updateStorageUsage();

  fileCountElement.textContent = `Показано: ${files.length} из ${allFiles.length}`;

  filesTableBody.innerHTML = "";

  if (files.length === 0) {
    filesTableBody.innerHTML = `
      <tr>
        <td colspan="4" class="empty">
          ${
            allFiles.length === 0
              ? "Файлов пока нет"
              : "По вашему фильтру ничего не найдено"
          }
        </td>
      </tr>
    `;

    return;
  }

  for (const file of files) {
    const row = document.createElement("tr");

    row.innerHTML = `
      <td class="filename">
        ${escapeHtml(file.filename)}
      </td>

      <td>
        ${formatSize(file.size)}
      </td>

      <td>
        ${formatDate(file.modifiedAt)}
      </td>

      <td class="actions">
        <a
          class="download"
          href="/api/7fK29xQm8Lp4Vn2Za6RtYw3Hs9Ec/admin/files/${encodeURIComponent(file.filename)}/download"
        >
          Скачать
        </a>

        <button
          class="delete-button danger"
          data-filename="${escapeHtml(file.filename)}"
        >
          Удалить
        </button>
      </td>
    `;

    filesTableBody.appendChild(row);
  }

  /*
      Обработчики удаления.
  */
  document.querySelectorAll(".delete-button").forEach((button) => {
    button.addEventListener("click", () => {
      deleteFile(button.dataset.filename);
    });
  });
}

/*
    --------------------------------------------------
    DELETE ONE FILE
    --------------------------------------------------
*/

async function deleteFile(filename) {
  const confirmed = confirm(`Удалить файл?\n\n${filename}`);

  if (!confirmed) {
    return;
  }

  try {
    setStatus(`Удаление: ${filename}...`);

    const response = await fetch(
      `/api/7fK29xQm8Lp4Vn2Za6RtYw3Hs9Ec/admin/files/${encodeURIComponent(filename)}`,
      {
        method: "DELETE",
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    /*
        Удаляем файл из локального списка.
    */
    allFiles = allFiles.filter((file) => file.filename !== filename);

    renderFiles();

    setStatus(`Файл удалён: ${filename}`);
  } catch (error) {
    console.error(error);

    setStatus(`Ошибка удаления: ${filename}`);
  }
}

/*
    --------------------------------------------------
    DELETE ALL
    --------------------------------------------------
*/

async function deleteAllFiles() {
  const confirmed = confirm(
    "Вы уверены, что хотите удалить ВСЕ записи?\n\n" +
      "Это действие нельзя отменить.",
  );

  if (!confirmed) {
    return;
  }

  const secondConfirmed = confirm(
    "Последнее подтверждение.\n\n" + "Удалить ВСЕ файлы записей?",
  );

  if (!secondConfirmed) {
    return;
  }

  try {
    setStatus("Удаляем все файлы...");

    deleteAllButton.disabled = true;

    const response = await fetch(
      "/api/7fK29xQm8Lp4Vn2Za6RtYw3Hs9Ec/admin/files",
      {
        method: "DELETE",
      },
    );

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }

    /*
        Очищаем локальный список.
    */
    allFiles = [];

    renderFiles();

    setStatus(`Удалено файлов: ${data.deleted}`);
  } catch (error) {
    console.error(error);

    setStatus("Ошибка удаления файлов");
  } finally {
    deleteAllButton.disabled = false;
  }
}

/*
    --------------------------------------------------
    EVENTS
    --------------------------------------------------
*/

refreshButton.addEventListener("click", loadFiles);

deleteAllButton.addEventListener("click", deleteAllFiles);

/*
    Фильтр применяется сразу
    при вводе текста.
*/
filterInput.addEventListener("input", renderFiles);

/*
    Изменение направления сортировки.
*/
sortSelect.addEventListener("change", renderFiles);

/*
    --------------------------------------------------
    START
    --------------------------------------------------
*/

loadFiles();
