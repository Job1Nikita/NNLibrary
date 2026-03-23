(() => {
  function setState(button, state) {
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }
    button.dataset.state = state;
    window.setTimeout(() => {
      if (button.dataset.state === state) {
        delete button.dataset.state;
      }
    }, 900);
  }

  async function copyText(text) {
    if (!text) {
      return false;
    }

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "true");
      helper.style.position = "absolute";
      helper.style.left = "-9999px";
      document.body.appendChild(helper);
      helper.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(helper);
      return ok;
    }
  }

  document.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const button = target.closest("button.copy-btn");
    if (!(button instanceof HTMLButtonElement)) {
      return;
    }

    const payload = button.dataset.copy ?? "";
    const ok = await copyText(payload);
    setState(button, ok ? "ok" : "fail");
  });
})();
