import QRCode from "qrcode";

/**
 * The code as path data the page draws itself, so no generated markup is
 * ever injected. Level M survives a scuffed or glare-washed screen and keeps
 * the modules large: a six-digit number is version 1, 21 modules across.
 * No server or database in here, so a window can draw a badge before it is
 * saved (New Visitor's preview).
 */
export function qrPath(text: string): { size: number; path: string } {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
  let path = "";
  for (let y = 0; y < modules.size; y++) {
    for (let x = 0; x < modules.size; x++) {
      if (modules.get(y, x)) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size: modules.size, path };
}
