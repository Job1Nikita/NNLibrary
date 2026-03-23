(() => {
  async function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(text);
      return;
    }

    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    input.style.position = "absolute";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    document.body.removeChild(input);
  }

  function showCopiedState(button) {
    const normalLabel = button.dataset.copyLabel || button.textContent || "Copy";
    const doneLabel = button.dataset.copyDone || "Copied";
    button.textContent = doneLabel;
    window.setTimeout(() => {
      button.textContent = normalLabel;
    }, 1200);
  }

  function setModalOpen(modal, open) {
    modal.hidden = !open;
    if (open) {
      document.body.classList.add("no-scroll");
    } else {
      document.body.classList.remove("no-scroll");
    }
  }

  function initModal(modal) {
    const modalId = modal.id;
    if (!modalId) {
      return;
    }

    document.querySelectorAll(`[data-checksum-help-open="${modalId}"]`).forEach((trigger) => {
      if (!(trigger instanceof HTMLElement)) {
        return;
      }

      trigger.addEventListener("click", () => {
        setModalOpen(modal, true);
      });
    });

    modal.querySelectorAll("[data-checksum-help-close]").forEach((closeBtn) => {
      if (!(closeBtn instanceof HTMLElement)) {
        return;
      }

      closeBtn.addEventListener("click", () => {
        setModalOpen(modal, false);
      });
    });

    modal.querySelectorAll("[data-copy-code]").forEach((copyBtn) => {
      if (!(copyBtn instanceof HTMLButtonElement)) {
        return;
      }

      copyBtn.addEventListener("click", async () => {
        const container = copyBtn.closest(".checksum-help-cmd");
        const codeNode = container ? container.querySelector("code") : null;
        if (!(codeNode instanceof HTMLElement)) {
          return;
        }

        const text = codeNode.innerText.trim();
        if (!text) {
          return;
        }

        try {
          await copyText(text);
          showCopiedState(copyBtn);
        } catch (_error) {
          // no-op
        }
      });
    });

    modal.querySelectorAll("[data-copy-text]").forEach((copyBtn) => {
      if (!(copyBtn instanceof HTMLButtonElement)) {
        return;
      }

      copyBtn.addEventListener("click", async () => {
        const text = copyBtn.dataset.copyText || "";
        if (!text) {
          return;
        }

        try {
          await copyText(text);
          showCopiedState(copyBtn);
        } catch (_error) {
          // no-op
        }
      });
    });
  }

  function bootstrap() {
    document.querySelectorAll(".checksum-help-modal").forEach((modal) => {
      if (modal instanceof HTMLElement) {
        initModal(modal);
      }
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") {
        return;
      }

      document.querySelectorAll(".checksum-help-modal").forEach((modal) => {
        if (modal instanceof HTMLElement && !modal.hidden) {
          setModalOpen(modal, false);
        }
      });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }
})();
