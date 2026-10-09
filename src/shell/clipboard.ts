/** Copies text to the clipboard and confirms it with a short toast. */
export function copyText(text: string, success: string, failure: string) {
  const done = (ok: boolean) => showToast(ok ? success : failure);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(false));
  } else {
    done(false);
  }
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** A short, self-dismissing status message at the bottom of the screen. */
export function showToast(message: string) {
  let toast = document.getElementById("app-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "app-toast";
    toast.className = "app-toast";
    toast.setAttribute("role", "status");
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add("app-toast--visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast?.classList.remove("app-toast--visible"), 2000);
}
