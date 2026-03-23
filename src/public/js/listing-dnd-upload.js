(() => {
  function setInputFiles(input, files) {
    if (typeof DataTransfer !== "function") {
      throw new Error("DataTransfer is not supported");
    }

    const transfer = new DataTransfer();
    Array.from(files).forEach((file) => transfer.items.add(file));
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function isUploadInProgress(form) {
    const cancelBtn = form.querySelector("[data-upload-cancel]");
    return cancelBtn instanceof HTMLButtonElement && !cancelBtn.hidden;
  }

  function submitUpload(form) {
    const submitBtn = form.querySelector("[data-upload-submit]");
    if (submitBtn instanceof HTMLButtonElement && typeof form.requestSubmit === "function") {
      form.requestSubmit(submitBtn);
      return;
    }

    if (typeof form.requestSubmit === "function") {
      form.requestSubmit();
      return;
    }

    form.submit();
  }

  function initDropUpload(form) {
    const dropzone = form.querySelector("[data-upload-dropzone]");
    const input = form.querySelector(".file-control-input");

    if (!(dropzone instanceof HTMLElement) || !(input instanceof HTMLInputElement)) {
      return;
    }

    const unsupportedText = form.dataset.i18nDndUnsupported || "Drag and drop is not supported by this browser";
    const setFileErrorText =
      form.dataset.i18nDndSetFileError || "Failed to place file into form. Use the choose button.";

    if (typeof DataTransfer !== "function") {
      dropzone.textContent = unsupportedText;
      dropzone.setAttribute("aria-disabled", "true");
      return;
    }

    let dragDepth = 0;

    function activate() {
      dropzone.classList.add("is-dragover");
    }

    function deactivate() {
      dropzone.classList.remove("is-dragover");
    }

    function handleFiles(files) {
      if (!files || files.length === 0) {
        return;
      }

      if (isUploadInProgress(form)) {
        return;
      }

      try {
        setInputFiles(input, files);
      } catch {
        dropzone.textContent = setFileErrorText;
        return;
      }

      submitUpload(form);
    }

    dropzone.addEventListener("click", () => {
      if (isUploadInProgress(form)) {
        return;
      }
      input.click();
    });

    dropzone.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      if (isUploadInProgress(form)) {
        return;
      }
      input.click();
    });

    dropzone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      dragDepth += 1;
      activate();
    });

    dropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "copy";
      }
      activate();
    });

    dropzone.addEventListener("dragleave", (event) => {
      event.preventDefault();
      if (event.relatedTarget && dropzone.contains(event.relatedTarget)) {
        return;
      }

      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) {
        deactivate();
      }
    });

    dropzone.addEventListener("drop", (event) => {
      event.preventDefault();
      dragDepth = 0;
      deactivate();
      handleFiles(event.dataTransfer?.files || null);
    });
  }

  function bootstrap() {
    document.querySelectorAll("form[data-drop-upload]").forEach((form) => {
      if (form instanceof HTMLFormElement) {
        initDropUpload(form);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
