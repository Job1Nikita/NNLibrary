(function initCaptchaWidgets() {
  const widgets = document.querySelectorAll("[data-captcha-widget]");
  if (!widgets.length) return;

  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

  widgets.forEach((widget) => {
    const bgCanvas = widget.querySelector(".captcha-bg");
    const pieceCanvas = widget.querySelector(".captcha-piece");
    const slider = widget.querySelector(".captcha-slider");
    const refreshBtn = widget.querySelector(".captcha-refresh");
    const challengeInput = widget.querySelector(".captcha-challenge-id");
    const xInput = widget.querySelector(".captcha-x");
    const hint = widget.querySelector(".captcha-hint");

    if (
      !(bgCanvas instanceof HTMLCanvasElement) ||
      !(pieceCanvas instanceof HTMLCanvasElement) ||
      !(slider instanceof HTMLInputElement) ||
      !(refreshBtn instanceof HTMLButtonElement) ||
      !(challengeInput instanceof HTMLInputElement) ||
      !(xInput instanceof HTMLInputElement) ||
      !(hint instanceof HTMLElement)
    ) {
      return;
    }

    const bgCtx = bgCanvas.getContext("2d");
    const pieceCtx = pieceCanvas.getContext("2d");
    if (!bgCtx || !pieceCtx) {
      return;
    }

    const i18n = {
      loading: widget.dataset.i18nLoading || "Loading puzzle...",
      loadError: widget.dataset.i18nLoadError || "Failed to load captcha, please refresh",
      hint: widget.dataset.i18nHint || "Drag the piece into the cutout",
      notReady: widget.dataset.i18nNotReady || "Captcha is not ready, refresh it",
      notReadyRefresh: widget.dataset.i18nNotReadyRefresh || "Captcha is not ready, press refresh"
    };

    let targetY = 0;

    const movePiece = () => {
      const x = Number(slider.value || 0);
      pieceCanvas.style.transform = `translateX(${x}px)`;
      xInput.value = String(x);
    };

    const loadChallenge = async () => {
      slider.disabled = true;
      refreshBtn.disabled = true;
      hint.textContent = i18n.loading;

      try {
        const response = await fetch("/captcha/challenge", {
          credentials: "same-origin",
          cache: "no-store"
        });

        if (!response.ok) {
          throw new Error("captcha challenge failed");
        }

        const challenge = await response.json();
        const [bgImage, pieceImage] = await Promise.all([
          loadImage(challenge.backgroundImage),
          loadImage(challenge.pieceImage)
        ]);

        bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
        bgCtx.drawImage(bgImage, 0, 0, bgCanvas.width, bgCanvas.height);

        pieceCanvas.width = pieceImage.width;
        pieceCanvas.height = pieceImage.height;
        pieceCtx.clearRect(0, 0, pieceCanvas.width, pieceCanvas.height);
        pieceCtx.drawImage(pieceImage, 0, 0);

        targetY = challenge.targetY || 0;
        pieceCanvas.style.top = `${targetY}px`;

        slider.max = String(challenge.maxX || 248);
        slider.value = "0";
        challengeInput.value = challenge.challengeId;
        xInput.value = "0";

        movePiece();
        slider.disabled = false;
        refreshBtn.disabled = false;
        hint.textContent = i18n.hint;
      } catch (_error) {
        slider.disabled = true;
        refreshBtn.disabled = false;
        hint.textContent = i18n.loadError;
      }
    };

    slider.addEventListener("input", movePiece);
    refreshBtn.addEventListener("click", (event) => {
      event.preventDefault();
      loadChallenge();
    });

    const form = widget.closest("form");
    if (form) {
      form.addEventListener("submit", (event) => {
        if (!challengeInput.value) {
          event.preventDefault();
          hint.textContent = i18n.notReady;
          return;
        }

        if (slider.disabled) {
          event.preventDefault();
          hint.textContent = i18n.notReadyRefresh;
        }
      });
    }

    void loadChallenge();
  });
})();
