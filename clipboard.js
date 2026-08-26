export async function copyPlainText(text) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  // Fallback сохраняет исходные переносы и копирует только value, без HTML.
  const area=document.createElement('textarea'); area.value=text; area.setAttribute('readonly',''); area.style.cssText='position:fixed;opacity:0;inset:0'; document.body.append(area); area.select(); area.setSelectionRange(0,area.value.length); const ok=document.execCommand('copy'); area.remove(); if(!ok) throw new Error('Clipboard fallback failed');
}
