/** Digits-only international number for https://wa.me/<phone>. */
export function normalizeWhatsAppPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;

  // International dialing prefix: 00… → drop 00
  if (digits.startsWith("00")) {
    digits = digits.slice(2);
  }

  // Local Israeli numbers: 05… → 9725…
  if (digits.startsWith("0")) {
    digits = `972${digits.slice(1)}`;
  }

  // Common paste: 9720… (country code + local leading 0) → 972…
  if (digits.startsWith("9720")) {
    digits = `972${digits.slice(4)}`;
  }

  // E.164: country code + subscriber, max 15 digits
  if (digits.length < 9 || digits.length > 15) return null;
  return digits;
}

export function toWhatsAppUrl(raw: string | null | undefined): string | null {
  const phone = normalizeWhatsAppPhone(raw);
  return phone ? `https://wa.me/${phone}` : null;
}
