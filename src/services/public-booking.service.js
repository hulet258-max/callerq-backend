// Deliberate boundary for adding OTP-backed customer authorization later.
// Public controllers call this before returning phone-linked appointment data.
export async function authorizeCustomerLookup({ normalizedPhone }) {
  return { normalizedPhone };
}
