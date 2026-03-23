(() => {
  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / 1024 ** exponent;
    const precision = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${value.toFixed(precision)} ${units[exponent]}`;
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

  function formatDuration(seconds, lessThanSecondText) {
    if (!Number.isFinite(seconds) || seconds <= 0) return lessThanSecondText;
    const total = Math.round(seconds);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    if (mins <= 0) return `${secs} s`;
    return `${mins}m ${secs}s`;
  }

  function setControlsDisabled(form, disabled) {
    form.querySelectorAll("input, select, textarea, button").forEach((element) => {
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLSelectElement) &&
        !(element instanceof HTMLTextAreaElement) &&
        !(element instanceof HTMLButtonElement)
      ) {
        return;
      }
      if (element instanceof HTMLButtonElement && element.hasAttribute("data-upload-cancel")) {
        element.disabled = false;
        return;
      }
      element.disabled = disabled;
    });
  }

  function initUploadProgress(form) {
    const ui = form.querySelector("[data-upload-progress-ui]");
    const percentEl = form.querySelector("[data-progress-percent]");
    const metaEl = form.querySelector("[data-progress-meta]");
    const barEl = form.querySelector("[data-progress-bar]");
    const trackEl = form.querySelector(".upload-progress-track");
    const cancelBtn = form.querySelector("[data-upload-cancel]");

    if (
      !(ui instanceof HTMLElement) ||
      !(percentEl instanceof HTMLElement) ||
      !(metaEl instanceof HTMLElement) ||
      !(barEl instanceof HTMLElement)
    ) {
      return;
    }

    const i18n = {
      preparing: form.dataset.i18nUploadPreparing || "Preparing...",
      preparingSend: form.dataset.i18nUploadPreparingSend || "Preparing request...",
      uploading: form.dataset.i18nUploadUploading || "{{loaded}} / {{total}} • {{speed}}/s • left {{eta}}",
      uploadingUnknown: form.dataset.i18nUploadUploadingUnknown || "{{loaded}} sent • {{speed}}/s",
      uploadedWaiting: form.dataset.i18nUploadUploadedWaiting || "Data uploaded, waiting for server processing...",
      doneRedirect: form.dataset.i18nUploadDoneRedirect || "Done. Redirecting...",
      networkError: form.dataset.i18nUploadNetworkError || "Network error during upload",
      timeout: form.dataset.i18nUploadTimeout || "Server response timeout exceeded",
      serverError: form.dataset.i18nUploadServerError || "Server error: HTTP {{code}}",
      lessThanSecond: form.dataset.i18nUploadLessThanSecond || "< 1 sec"
    };

    let activeRequest = null;

    function setCancelVisible(visible) {
      if (cancelBtn instanceof HTMLButtonElement) {
        cancelBtn.hidden = !visible;
      }
    }

    function setProgress(percent, meta) {
      const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
      percentEl.textContent = `${safePercent}%`;
      metaEl.textContent = meta;
      barEl.style.width = `${safePercent}%`;
      if (trackEl instanceof HTMLElement) {
        trackEl.setAttribute("aria-valuenow", String(safePercent));
      }
    }

    function resetUi() {
      ui.hidden = true;
      setCancelVisible(false);
      setProgress(0, i18n.preparing);
    }

    form.addEventListener("submit", (event) => {
      if (activeRequest) {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      const data = new FormData(form);
      const xhr = new XMLHttpRequest();
      activeRequest = xhr;

      const startedAt = performance.now();
      ui.hidden = false;
      setCancelVisible(true);
      setProgress(0, i18n.preparingSend);
      setControlsDisabled(form, true);

      xhr.upload.addEventListener("progress", (progressEvent) => {
        const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, 0.001);
        const loaded = progressEvent.loaded;
        const speed = loaded / elapsedSeconds;

        if (progressEvent.lengthComputable && progressEvent.total > 0) {
          const total = progressEvent.total;
          const percent = (loaded / total) * 100;
          const remaining = Math.max(total - loaded, 0);
          const eta = speed > 0 ? remaining / speed : Number.POSITIVE_INFINITY;

          setProgress(
            percent,
            applyParams(i18n.uploading, {
              loaded: formatBytes(loaded),
              total: formatBytes(total),
              speed: formatBytes(speed),
              eta: formatDuration(eta, i18n.lessThanSecond)
            })
          );
          return;
        }

        setProgress(
          0,
          applyParams(i18n.uploadingUnknown, {
            loaded: formatBytes(loaded),
            speed: formatBytes(speed)
          })
        );
      });

      xhr.upload.addEventListener("load", () => {
        setProgress(100, i18n.uploadedWaiting);
      });

      xhr.addEventListener("error", () => {
        activeRequest = null;
        setControlsDisabled(form, false);
        setCancelVisible(false);
        setProgress(0, i18n.networkError);
      });

      xhr.addEventListener("timeout", () => {
        activeRequest = null;
        setControlsDisabled(form, false);
        setCancelVisible(false);
        setProgress(0, i18n.timeout);
      });

      xhr.addEventListener("abort", () => {
        activeRequest = null;
        setControlsDisabled(form, false);
        resetUi();
      });

      xhr.addEventListener("load", () => {
        activeRequest = null;

        if (xhr.status >= 200 && xhr.status < 400) {
          setProgress(100, i18n.doneRedirect);
          const targetUrl = xhr.responseURL || form.getAttribute("action") || "/admin";
          window.location.assign(targetUrl);
          return;
        }

        setControlsDisabled(form, false);
        setCancelVisible(false);
        setProgress(0, applyParams(i18n.serverError, { code: xhr.status }));
      });

      xhr.open((form.method || "POST").toUpperCase(), form.action, true);
      xhr.send(data);
    });

    if (cancelBtn instanceof HTMLButtonElement) {
      cancelBtn.addEventListener("click", () => {
        if (activeRequest) {
          activeRequest.abort();
        }
      });
    }

    resetUi();
  }

  function bootstrap() {
    document.querySelectorAll("form[data-upload-progress]").forEach((form) => {
      if (form instanceof HTMLFormElement) {
        initUploadProgress(form);
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
