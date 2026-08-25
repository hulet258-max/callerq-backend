const SERVICE_URLS = [
  'https://robikcafe.et/verify',
];

const REQUEST_TIMEOUT_MS = 15_000;

async function postVerify(url, payload) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const contentType = response.headers.get('content-type') || '';
    const isJson = contentType.includes('application/json');
    const body = isJson ? await response.json() : await response.text();

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }

    return body;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Adapted from the supplied Deposit.js validation flow. Receipt identity comes
// from verified provider data or a valid Telebirr receipt code, never from an
// arbitrary client-provided transaction field.
export function extractReceiptCode(input) {
  if (!input) return null;
  const value = String(input).trim().toUpperCase();
  const url = value.match(/TRANSACTIONINFO\.ETHIOTELECOM\.ET\/RECEIPT\/([A-Z0-9]+)/);
  if (url) return url[1];
  const amharic = value.match(/ቁጥርዎ\s+([A-Z0-9]+)\s+ነው/);
  if (amharic) return amharic[1];
  return /^[A-Z0-9]{10}$/.test(value) ? value : null;
}

export function extractTransactionId(response) {
  for (const source of [response, response?.data, response?.result, response?.receipt]) {
    if (!source || typeof source !== 'object') continue;
    const value = source.transactionId || source.transaction_id || source.txId
      || source.tx_id || source.trxId || source.trx_id || source.reference || source.receiptId;
    if (value && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function extractAmount(response) {
  for (const source of [response, response?.data, response?.result, response?.receipt]) {
    if (!source || typeof source !== 'object') continue;
    const value = source.amount || source.paidAmount || source.verifiedAmount || source.totalAmount;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

export async function verifyPayment(userInput, expectedAmount) {
  const parsedExpectedAmount = Number(expectedAmount);
  const normalizedExpectedAmount = Number.isFinite(parsedExpectedAmount)
    && parsedExpectedAmount > 10
    ? parsedExpectedAmount
    : 11;
  const urlsToTry = [...SERVICE_URLS, ...SERVICE_URLS];

  for (const url of urlsToTry) {
    try {
      const data = await postVerify(url, {
        userInput,
        expectedAmount: normalizedExpectedAmount,
      });
      return data;
    } catch (error) {
      const status = error?.status;
      const responseBody = error?.body;
      const serviceMessage = typeof responseBody === 'string'
        ? responseBody
        : responseBody?.message;

      if (status >= 400 && status < 500) {
        console.error(`Receipt service validation error (${url}):`, serviceMessage || error.message);
        return {
          valid: false,
          message: serviceMessage || 'Invalid receipt data.',
          status,
        };
      }

      console.error(`Receipt service error (${url}):`, serviceMessage || error.message);
    }
  }

  return {
    valid: false,
    message: '❌ **Service Error**: Could not verify receipt at this time.',
  };
}
