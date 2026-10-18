import { Platform, Share } from "react-native";
import { toast } from "@/ui/toast";

/** Copy on web/desktop; the share sheet on native (no extra native module needed). */
export async function copyText(text: string, what = "Copied") {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    toast.success(what);
    return;
  }
  await Share.share({ message: text });
}
