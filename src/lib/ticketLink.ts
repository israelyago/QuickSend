const QUICKSEND_DEEP_LINK_PREFIX = "quicksend://receive";

function parseQuickSendReceiveUrl(rawInput: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(rawInput);
  } catch {
    return null;
  }

  if (parsed.protocol !== "quicksend:") {
    return null;
  }

  const isReceiveRoute =
    parsed.hostname === "receive" ||
    parsed.pathname === "/receive" ||
    parsed.pathname === "/receive/";
  if (!isReceiveRoute) {
    return null;
  }

  const ticket = parsed.searchParams.get("ticket")?.trim();
  if (!ticket || !ticket.startsWith("blob")) {
    return null;
  }

  return ticket;
}

export function buildReceiveLink(ticket: string): string {
  const normalized = ticket.trim();
  return `${QUICKSEND_DEEP_LINK_PREFIX}?ticket=${encodeURIComponent(normalized)}`;
}

export function resolveTicketInput(rawInput: string): string | null {
  const normalized = rawInput.trim();
  if (!normalized) {
    return null;
  }

  if (normalized.startsWith("blob")) {
    return normalized;
  }

  return parseQuickSendReceiveUrl(normalized);
}
