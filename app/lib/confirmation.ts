export function confirmAction(title: string, message: string, confirmLabel = "Confirm", destructive = false) {
  return new Promise<boolean>((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "m-auto w-full max-w-md rounded-xl border border-stone-200 bg-white p-5 text-slate-800 shadow-2xl backdrop:bg-slate-950/60";
    const heading = document.createElement("h2"); heading.className = "m-0 text-lg"; heading.textContent = title;
    const description = document.createElement("p"); description.className = "font-sans text-sm text-slate-600"; description.textContent = message;
    const actions = document.createElement("div"); actions.className = "mt-5 flex justify-end gap-3";
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "rounded-md bg-slate-800 px-4 py-2.5 font-sans text-xs font-semibold text-white"; cancel.textContent = "Cancel";
    const confirm = document.createElement("button"); confirm.type = "button"; confirm.className = `rounded-md px-4 py-2.5 font-sans text-xs font-semibold text-white ${destructive ? "bg-red-700" : "bg-amber-700"}`; confirm.textContent = confirmLabel;
    let settled = false;
    const finish = (value: boolean) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); resolve(value); };
    cancel.addEventListener("click", () => finish(false)); confirm.addEventListener("click", () => finish(true)); dialog.addEventListener("cancel", () => finish(false));
    dialog.appendChild(heading); dialog.appendChild(description); dialog.appendChild(actions); actions.appendChild(cancel); actions.appendChild(confirm); document.body.appendChild(dialog); dialog.showModal(); cancel.focus();
  });
}
