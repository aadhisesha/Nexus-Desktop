import { invoke } from "@tauri-apps/api/core";

export async function openFile(filePath: string): Promise<void> {
  const isTauri = typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);
  if (isTauri) {
    try {
      await invoke("open_file", { path: filePath });
    } catch (err) {
      console.error("Failed to open file:", err);
    }
  } else {
    window.open(`file://${filePath}`, "_blank");
  }
}

export async function revealInFolder(filePath: string): Promise<void> {
  const isTauri = typeof window !== "undefined" && ("__TAURI__" in window || "__TAURI_INTERNALS__" in window);
  if (isTauri) {
    try {
      await invoke("reveal_in_folder", { path: filePath });
    } catch (err) {
      console.error("Failed to reveal in folder:", err);
    }
  }
}
