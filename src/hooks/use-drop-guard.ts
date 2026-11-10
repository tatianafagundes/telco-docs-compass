import { useEffect } from "react";
import { toast } from "sonner";

/** Stops the browser from opening dropped files anywhere in the app. Drop zones call preventDefault themselves and mark the event handled. */
export function useDropGuard() {
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      if (!(e as DragEvent & { eradHandled?: boolean }).eradHandled) {
        toast("Open an order's Documents tab to add files");
      }
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, []);
}
