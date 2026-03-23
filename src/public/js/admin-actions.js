(() => {
  function q(id) {
    return document.getElementById(id);
  }

  function submitForm(formId, action, fields) {
    const form = q(formId);
    if (!(form instanceof HTMLFormElement)) {
      return;
    }

    form.action = action;
    for (const [key, value] of Object.entries(fields || {})) {
      const input = form.querySelector(`[name="${key}"]`);
      if (input instanceof HTMLInputElement) {
        input.value = value;
      }
    }

    form.submit();
  }

  function sanitizeRequired(value) {
    const trimmed = (value || "").trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function applyParams(template, params) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = params[key];
      if (value === null || value === undefined) {
        return "";
      }
      return String(value);
    });
  }

  function parseEntryFromDataset(dataset) {
    const id = dataset.id || "";
    const kind = dataset.entryTarget;

    if (!id || (kind !== "directory" && kind !== "file")) {
      return null;
    }

    return {
      kind,
      id,
      name: dataset.name || "",
      parentId: dataset.parentId || "",
      directoryId: dataset.directoryId || "",
      isFeatured: dataset.featured === "true"
    };
  }

  function parseEntryFromButton(button) {
    const action = button.dataset.action || "";
    const id = button.dataset.id || "";
    const name = button.dataset.name || "";

    if (!id) return null;

    if (action.endsWith("-dir")) {
      return {
        kind: "directory",
        id,
        name,
        parentId: button.dataset.parentId || "",
        directoryId: "",
        isFeatured: false
      };
    }

    if (action.endsWith("-file")) {
      return {
        kind: "file",
        id,
        name,
        parentId: "",
        directoryId: button.dataset.directoryId || "",
        isFeatured: false
      };
    }

    return null;
  }

  function parseDirectoriesData() {
    const script = q("move-directories-data");
    if (!(script instanceof HTMLScriptElement)) {
      return [];
    }

    try {
      const parsed = JSON.parse(script.textContent || "[]");
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((item) => item && typeof item.id === "number" && typeof item.name === "string")
        .map((item) => ({
          id: String(item.id),
          name: item.name,
          parentId: item.parentId == null ? null : String(item.parentId)
        }));
    } catch {
      return [];
    }
  }

  const directories = parseDirectoriesData();
  const i18nNode = q("admin-actions-i18n");
  const i18n = {
    dirPrefix:
      i18nNode instanceof HTMLElement ? i18nNode.dataset.dirPrefix || "Folder" : "Folder",
    filePrefix:
      i18nNode instanceof HTMLElement ? i18nNode.dataset.filePrefix || "File" : "File",
    noDirs:
      i18nNode instanceof HTMLElement ? i18nNode.dataset.noDirs || "No available directories" : "No available directories",
    entryDir:
      i18nNode instanceof HTMLElement ? i18nNode.dataset.entryDir || "folder" : "folder",
    entryFile:
      i18nNode instanceof HTMLElement ? i18nNode.dataset.entryFile || "file" : "file",
    promptDirRename:
      i18nNode instanceof HTMLElement ? i18nNode.dataset.promptDirRename || "New directory name:" : "New directory name:",
    promptFileRename:
      i18nNode instanceof HTMLElement ? i18nNode.dataset.promptFileRename || "New file name:" : "New file name:",
    confirmDirDelete:
      i18nNode instanceof HTMLElement
        ? i18nNode.dataset.confirmDirDelete || "Delete directory \"{{name}}\" and all nested items?"
        : "Delete directory \"{{name}}\" and all nested items?",
    confirmFileDelete:
      i18nNode instanceof HTMLElement
        ? i18nNode.dataset.confirmFileDelete || "Delete file \"{{name}}\" from DB and storage?"
        : "Delete file \"{{name}}\" from DB and storage?"
  };
  const uiLocale = document.documentElement.lang || "en";

  const childrenByParent = new Map();
  for (const dir of directories) {
    const key = dir.parentId ?? "root";
    if (!childrenByParent.has(key)) {
      childrenByParent.set(key, []);
    }
    childrenByParent.get(key).push(dir);
  }

  for (const children of childrenByParent.values()) {
    children.sort((a, b) => a.name.localeCompare(b.name, uiLocale));
  }

  function collectDescendants(rootId) {
    const ids = new Set([rootId]);
    const queue = [rootId];

    while (queue.length > 0) {
      const current = queue.shift();
      const children = childrenByParent.get(current) || [];
      for (const child of children) {
        if (!ids.has(child.id)) {
          ids.add(child.id);
          queue.push(child.id);
        }
      }
    }

    return ids;
  }

  function buildDirectoryTree(excludeIds) {
    const result = [];

    const walk = (parentId, depth) => {
      const key = parentId ?? "root";
      const children = childrenByParent.get(key) || [];

      for (const child of children) {
        if (excludeIds.has(child.id)) {
          continue;
        }

        result.push({
          id: child.id,
          name: child.name,
          depth
        });

        walk(child.id, depth + 1);
      }
    };

    walk(null, 0);
    return result;
  }

  const menu = q("entry-context-menu");
  const menuTitle = menu instanceof HTMLElement ? menu.querySelector("[data-menu-title]") : null;
  const menuToggleFeatured =
    menu instanceof HTMLElement ? menu.querySelector('[data-cm-action="toggle-featured"]') : null;
  let menuEntry = null;

  const moveModal = q("move-picker-modal");
  const moveEntryLabel = q("move-entry-label");
  const moveDirectoryList = q("move-directory-list");
  const moveRootButton = moveModal instanceof HTMLElement ? moveModal.querySelector("[data-move-root]") : null;
  const moveSubmitButton = moveModal instanceof HTMLElement ? moveModal.querySelector("[data-move-submit]") : null;
  const moveCancelButton = moveModal instanceof HTMLElement ? moveModal.querySelector("[data-move-cancel]") : null;

  const moveState = {
    entry: null,
    selectedTargetId: "",
    tree: []
  };

  function closeMenu() {
    if (!(menu instanceof HTMLElement)) {
      return;
    }

    menu.hidden = true;
    menuEntry = null;
  }

  function openMenu(x, y, entry) {
    if (!(menu instanceof HTMLElement)) {
      return;
    }

    menuEntry = entry;

    if (menuTitle instanceof HTMLElement) {
      const prefix = entry.kind === "directory" ? i18n.dirPrefix : i18n.filePrefix;
      menuTitle.textContent = `${prefix}: ${entry.name}`;
    }

    if (menuToggleFeatured instanceof HTMLButtonElement) {
      if (entry.kind === "file") {
        const defaultText = menuToggleFeatured.dataset.cmFeatureTextDefault || "Mark as current";
        const removeText = menuToggleFeatured.dataset.cmFeatureTextRemove || "Remove current mark";
        menuToggleFeatured.hidden = false;
        menuToggleFeatured.textContent = entry.isFeatured ? removeText : defaultText;
      } else {
        menuToggleFeatured.hidden = true;
      }
    }

    menu.hidden = false;

    const viewportPadding = 8;
    const width = menu.offsetWidth;
    const height = menu.offsetHeight;

    let left = x;
    let top = y;

    if (left + width + viewportPadding > window.innerWidth) {
      left = window.innerWidth - width - viewportPadding;
    }

    if (top + height + viewportPadding > window.innerHeight) {
      top = window.innerHeight - height - viewportPadding;
    }

    menu.style.left = `${Math.max(viewportPadding, left)}px`;
    menu.style.top = `${Math.max(viewportPadding, top)}px`;
  }

  function setMoveTarget(targetId) {
    moveState.selectedTargetId = targetId;

    if (moveRootButton instanceof HTMLElement) {
      moveRootButton.classList.toggle("selected", targetId === "");
    }

    if (!(moveDirectoryList instanceof HTMLElement)) {
      return;
    }

    moveDirectoryList.querySelectorAll(".move-dir-item").forEach((item) => {
      if (!(item instanceof HTMLElement)) {
        return;
      }

      item.classList.toggle("selected", (item.dataset.targetId || "") === targetId);
    });
  }

  function renderMoveTree() {
    if (!(moveDirectoryList instanceof HTMLElement)) {
      return;
    }

    moveDirectoryList.innerHTML = "";

    if (moveState.tree.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = i18n.noDirs;
      moveDirectoryList.appendChild(empty);
      return;
    }

    for (const node of moveState.tree) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "move-dir-item";
      button.dataset.targetId = node.id;
      button.style.paddingLeft = `${0.55 + node.depth * 0.95}rem`;

      const name = document.createElement("span");
      name.className = "move-dir-name";
      name.textContent = `${node.name} (#${node.id})`;
      button.appendChild(name);

      moveDirectoryList.appendChild(button);
    }

    setMoveTarget(moveState.selectedTargetId);
  }

  function closeMoveModal() {
    if (moveModal instanceof HTMLElement) {
      moveModal.hidden = true;
    }

    moveState.entry = null;
    moveState.selectedTargetId = "";
    moveState.tree = [];
  }

  function openMoveModal(entry) {
    if (!(moveModal instanceof HTMLElement)) {
      return;
    }

    moveState.entry = entry;

    const excludeIds = new Set();
    if (entry.kind === "directory") {
      const descendants = collectDescendants(entry.id);
      descendants.forEach((value) => excludeIds.add(value));
    }

    moveState.tree = buildDirectoryTree(excludeIds);

    const defaultTarget = entry.kind === "directory" ? (entry.parentId || "") : (entry.directoryId || "");
    const targetExists = defaultTarget === "" || moveState.tree.some((node) => node.id === defaultTarget);
    moveState.selectedTargetId = targetExists ? defaultTarget : "";

    if (moveEntryLabel instanceof HTMLElement) {
      const prefix = entry.kind === "directory" ? i18n.entryDir : i18n.entryFile;
      moveEntryLabel.textContent = `${prefix}: ${entry.name}`;
    }

    renderMoveTree();
    setMoveTarget(moveState.selectedTargetId);
    moveModal.hidden = false;
  }

  function submitMove() {
    const entry = moveState.entry;
    if (!entry) {
      return;
    }

    const targetId = moveState.selectedTargetId;
    closeMoveModal();

    if (entry.kind === "directory") {
      submitForm("admin-move-dir-form", `/admin/directories/${entry.id}/move`, { parentId: targetId });
      return;
    }

    submitForm("admin-move-file-form", `/admin/files/${entry.id}/move`, { directoryId: targetId });
  }

  function performAction(entry, action) {
    if (!entry || !entry.id) {
      return;
    }

    if (action === "toggle-featured" && entry.kind === "file") {
      submitForm("admin-feature-file-form", `/admin/files/${entry.id}/feature`, {
        isFeatured: entry.isFeatured ? "false" : "true"
      });
      return;
    }

    if (action === "move") {
      openMoveModal(entry);
      return;
    }

    if (entry.kind === "directory") {
      if (action === "rename") {
        const nextNameRaw = window.prompt(i18n.promptDirRename, entry.name || "");
        if (nextNameRaw === null) return;

        const nextName = sanitizeRequired(nextNameRaw);
        if (!nextName) return;

        submitForm("admin-rename-dir-form", `/admin/directories/${entry.id}/rename`, { name: nextName });
        return;
      }

      if (action === "delete") {
        const ok = window.confirm(applyParams(i18n.confirmDirDelete, { name: entry.name || "" }));
        if (!ok) return;

        submitForm("admin-delete-dir-form", `/admin/directories/${entry.id}/delete`, {});
      }

      return;
    }

    if (entry.kind === "file") {
      if (action === "rename") {
        const nextNameRaw = window.prompt(i18n.promptFileRename, entry.name || "");
        if (nextNameRaw === null) return;

        const nextName = sanitizeRequired(nextNameRaw);
        if (!nextName) return;

        submitForm("admin-rename-file-form", `/admin/files/${entry.id}/rename`, { name: nextName });
        return;
      }

      if (action === "delete") {
        const ok = window.confirm(applyParams(i18n.confirmFileDelete, { name: entry.name || "" }));
        if (!ok) return;

        submitForm("admin-delete-file-form", `/admin/files/${entry.id}/delete`, {});
      }
    }
  }

  document.addEventListener("contextmenu", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const entryElement = target.closest("[data-entry-target]");
    if (!(entryElement instanceof HTMLElement)) {
      return;
    }

    const entry = parseEntryFromDataset(entryElement.dataset);
    if (!entry) {
      return;
    }

    event.preventDefault();
    openMenu(event.clientX, event.clientY, entry);
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const menuItem = target.closest(".context-item");
    if (menuItem instanceof HTMLButtonElement && menuEntry) {
      const cmAction = menuItem.dataset.cmAction || "";
      const currentEntry = menuEntry;
      closeMenu();
      if (
        cmAction === "rename" ||
        cmAction === "move" ||
        cmAction === "delete" ||
        cmAction === "toggle-featured"
      ) {
        performAction(currentEntry, cmAction);
      }
      return;
    }

    if (target.closest("[data-move-close]") || target.closest("[data-move-cancel]")) {
      closeMoveModal();
      return;
    }

    const rootButton = target.closest("[data-move-root]");
    if (rootButton instanceof HTMLElement) {
      setMoveTarget("");
      return;
    }

    const moveItem = target.closest(".move-dir-item");
    if (moveItem instanceof HTMLElement) {
      setMoveTarget(moveItem.dataset.targetId || "");
      return;
    }

    if (target.closest("[data-move-submit]")) {
      submitMove();
      return;
    }

    const legacyBtn = target.closest(".admin-action-btn");
    if (legacyBtn instanceof HTMLButtonElement) {
      const entry = parseEntryFromButton(legacyBtn);
      if (!entry) return;

      const actionName = legacyBtn.dataset.action || "";
      if (actionName.startsWith("rename-")) performAction(entry, "rename");
      else if (actionName.startsWith("move-")) performAction(entry, "move");
      else if (actionName.startsWith("delete-")) performAction(entry, "delete");
      return;
    }

    if (menu instanceof HTMLElement && !menu.hidden && !target.closest("#entry-context-menu")) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMenu();
      closeMoveModal();
      return;
    }

    if (event.key === "Enter" && moveModal instanceof HTMLElement && !moveModal.hidden) {
      submitMove();
    }
  });

  window.addEventListener("resize", () => {
    closeMenu();
    closeMoveModal();
  });
  window.addEventListener("blur", () => {
    closeMenu();
  });
  window.addEventListener("scroll", closeMenu, true);
})();
