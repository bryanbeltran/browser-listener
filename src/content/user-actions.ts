import type { UserAction } from "../shared/types.js";

function selectorFor(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls =
    el.classList?.length && el.classList.length < 4
      ? `.${Array.from(el.classList).slice(0, 3).join(".")}`
      : "";
  return `${tag}${id}${cls}`.slice(0, 120);
}

export function installUserActionCapture(
  sessionId: string,
  onAction: (action: UserAction) => void,
): () => void {
  const base = () => ({
    id: crypto.randomUUID(),
    sessionId,
    timestamp: Date.now(),
    url: location.href,
    frameUrl: location.href,
  });

  const onClick = (ev: MouseEvent) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    onAction({ ...base(), type: "click", target: selectorFor(t) });
  };

  const onSubmit = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLFormElement)) return;
    onAction({ ...base(), type: "submit", target: selectorFor(t) });
  };

  const onInput = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) return;
    onAction({
      ...base(),
      type: "input",
      target: selectorFor(t),
      valueSummary: t.type === "password" ? "[password]" : `[${t.value.length} chars]`,
    });
  };

  const onChange = (ev: Event) => {
    const t = ev.target;
    if (!(t instanceof Element)) return;
    onAction({ ...base(), type: "change", target: selectorFor(t) });
  };

  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onChange, true);

  return () => {
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("submit", onSubmit, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onChange, true);
  };
}
