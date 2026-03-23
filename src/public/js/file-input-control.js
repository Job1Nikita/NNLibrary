(() => {
  function applyParams(template, params) {
    return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const value = params[key];
      if (value === null || value === undefined) {
        return "";
      }
      return String(value);
    });
  }

  function updateLabel(wrapper) {
    const input = wrapper.querySelector(".file-control-input");
    const label = wrapper.querySelector("[data-file-name]");

    if (!(input instanceof HTMLInputElement) || !(label instanceof HTMLElement)) {
      return;
    }

    const noneText = wrapper.dataset.i18nFileNone || "No files selected";
    const manyTemplate = wrapper.dataset.i18nFileMany || "{{count}} file(s), first: {{name}}";

    if (!input.files || input.files.length === 0) {
      label.textContent = noneText;
      label.title = noneText;
      return;
    }

    if (input.files.length === 1) {
      const fileName = input.files[0].name;
      label.textContent = fileName;
      label.title = fileName;
      return;
    }

    const firstFile = input.files[0].name;
    const count = input.files.length;
    label.textContent = applyParams(manyTemplate, { count, name: firstFile });
    label.title = Array.from(input.files)
      .map((file, index) => `${index + 1}. ${file.name}`)
      .join("\n");
  }

  document.addEventListener("DOMContentLoaded", () => {
    const wrappers = document.querySelectorAll("[data-file-control]");

    wrappers.forEach((wrapper) => {
      if (!(wrapper instanceof HTMLElement)) {
        return;
      }

      const input = wrapper.querySelector(".file-control-input");
      if (!(input instanceof HTMLInputElement)) {
        return;
      }

      updateLabel(wrapper);
      input.addEventListener("change", () => updateLabel(wrapper));
    });
  });
})();
