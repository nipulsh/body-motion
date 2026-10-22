export function formatMirrorHandUnavailableMessage(handError: string): string {
  const detail = handError.trim().replace(/\.+$/, '');
  return `Hand control unavailable: ${detail}. Use touch or mouse.`;
}
