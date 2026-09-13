(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CryptoCoffeePhoneX402 = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const EXTRA_KEYS = [
    "assetTransferMethod", "paymentFlow", "sessionId", "sessionIdBytes32",
    "machineId", "machineIdBytes32", "deadline", "contractAddress",
    "contractMethod", "confirmations", "proofMode",
  ];
  const CONTRACT_METHOD = "payForSession(bytes32,bytes32,uint256,uint64)";
  const PROTECTED_FETCH_TIMEOUT_MS = 30000;

  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }

  function lower(value) {
    return String(value || "").toLowerCase();
  }

  function stagedError(stage, userMessage, cause) {
    const error = new Error(userMessage);
    error.x402Stage = stage;
    error.userMessage = userMessage;
    error.cause = cause;
    return error;
  }

  function errorName(error) {
    return String((error && error.name) || "Error").slice(0, 80);
  }

  async function protectedFetch(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(function () { controller.abort(); }, timeoutMs);
    try {
      return await fetch(url, Object.assign({}, init, { signal: controller.signal }));
    } finally {
      globalThis.clearTimeout(timer);
    }
  }

  function decodeHeader(value) {
    requireValue(typeof value === "string" && value.length > 0, "missing x402 header");
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, function (char) { return char.charCodeAt(0); });
    const decoded = JSON.parse(new TextDecoder().decode(bytes));
    requireValue(decoded && typeof decoded === "object" && !Array.isArray(decoded), "x402 header is not an object");
    return decoded;
  }

  function encodeHeader(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = "";
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function validatePaymentRequired(paymentRequired, expected) {
    requireValue(paymentRequired.x402Version === 2, "x402Version mismatch");
    requireValue(paymentRequired.resource && paymentRequired.resource.url === expected.resourceUrl, "resource URL mismatch");
    requireValue(Array.isArray(paymentRequired.accepts) && paymentRequired.accepts.length === 1, "expected exactly one payment option");
    const accepted = paymentRequired.accepts[0];
    const extra = accepted.extra || {};
    requireValue(Object.keys(extra).sort().join("|") === EXTRA_KEYS.slice().sort().join("|"), "unexpected or missing x402 extra fields");
    requireValue(accepted.scheme === "exact", "scheme mismatch");
    requireValue(accepted.network === expected.network, "network mismatch");
    requireValue(Number(String(accepted.network).split(":")[1]) === Number(expected.chainId), "wallet chain ID mismatch");
    requireValue(accepted.asset === "native", "asset mismatch");
    requireValue(String(accepted.amount) === String(expected.amount), "amount mismatch");
    requireValue(BigInt(accepted.amount) <= BigInt(expected.maximumAmount), "amount exceeds human spending limit");
    requireValue(lower(accepted.payTo) === lower(expected.registry), "registry/payTo mismatch");
    requireValue(extra.assetTransferMethod === "txid", "asset transfer method mismatch");
    requireValue(extra.paymentFlow === "upfront", "payment flow mismatch");
    requireValue(extra.proofMode === "transaction-as-proof", "proof mode mismatch");
    requireValue(extra.sessionId === expected.sessionId, "session mismatch");
    requireValue(lower(extra.sessionIdBytes32) === lower(expected.sessionIdBytes32), "session bytes32 mismatch");
    requireValue(extra.machineId === expected.machineId, "machine mismatch");
    requireValue(lower(extra.machineIdBytes32) === lower(expected.machineIdBytes32), "machine bytes32 mismatch");
    requireValue(Number(extra.deadline) === Number(expected.deadline), "deadline mismatch");
    requireValue(lower(extra.contractAddress) === lower(expected.registry), "contract address mismatch");
    requireValue(extra.contractMethod === CONTRACT_METHOD, "contract method mismatch");
    requireValue(Number(extra.confirmations) === Number(expected.confirmations), "confirmation policy mismatch");
    requireValue(Number.isInteger(Number(accepted.maxTimeoutSeconds)) && Number(accepted.maxTimeoutSeconds) > 0, "invalid max timeout");
    return accepted;
  }

  function transactionFromRequirement(accepted) {
    const extra = accepted.extra;
    return {
      contractAddress: extra.contractAddress,
      sessionIdBytes32: extra.sessionIdBytes32,
      machineIdBytes32: extra.machineIdBytes32,
      amount: String(accepted.amount),
      deadline: String(extra.deadline),
      value: String(accepted.amount),
    };
  }

  function createPaymentPayload(paymentRequired, accepted, txRef) {
    return {
      x402Version: 2,
      payload: {
        type: "transaction-reference",
        txRef: txRef,
      },
      accepted: accepted,
      resource: paymentRequired.resource,
    };
  }

  function validatePaymentResponse(value, txRef, payer) {
    requireValue(value && value.success === true, "PAYMENT-RESPONSE did not report success");
    requireValue(lower(value.transaction) === lower(txRef), "PAYMENT-RESPONSE transaction mismatch");
    requireValue(lower(value.payer) === lower(payer), "PAYMENT-RESPONSE payer mismatch");
    return value;
  }

  function createHumanWalletFlow(options) {
    const params = options.params;
    const resourceUrl = params.get("x402Resource") || "";
    const network = params.get("x402Network") || "";
    const version = Number(params.get("x402Version") || "0");
    const sessionLabel = params.get("session") || "";
    const machineLabel = params.get("machineLabel") || "";
    const confirmations = Number(params.get("confirmations") || "0");
    let paymentRequired = null;
    let accepted = null;
    let transaction = null;
    let payer = null;
    const protectedFetchTimeoutMs = Number(options.protectedFetchTimeoutMs || PROTECTED_FETCH_TIMEOUT_MS);

    function expected() {
      const invoice = options.getInvoice();
      return {
        resourceUrl: resourceUrl,
        network: network,
        chainId: invoice.chainId,
        amount: String(invoice.amount),
        maximumAmount: "20000000000000000",
        registry: invoice.contract,
        sessionId: sessionLabel,
        sessionIdBytes32: invoice.sessionId,
        machineId: machineLabel,
        machineIdBytes32: invoice.machineId,
        deadline: invoice.deadline,
        confirmations: confirmations,
      };
    }

    async function report(event, details) {
      if (!resourceUrl) return false;
      const controller = new AbortController();
      const timer = globalThis.setTimeout(function () { controller.abort(); }, 1500);
      try {
        const endpoint = new URL("/x402/client-event/" + encodeURIComponent(sessionLabel), resourceUrl);
        const response = await fetch(endpoint.toString(), {
          method: "POST", cache: "no-store", credentials: "omit", signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(Object.assign({ event: event }, details || {})),
        });
        return response.ok;
      } catch (_) {
        return false; // Observational telemetry cannot govern payment.
      } finally {
        globalThis.clearTimeout(timer);
      }
    }

    async function verify() {
      if (!resourceUrl) return true;
      requireValue(version === 2 && sessionLabel && machineLabel && [1, 2].includes(confirmations), "incomplete human-wallet x402 invoice");
      options.showTerms("Checking payment terms...");
      options.setStatus("Reading the x402 payment request…");
      await report("phone_page_opened");
      let response;
      try {
        response = await protectedFetch(
          resourceUrl,
          { method: "GET", cache: "no-store", credentials: "omit" },
          protectedFetchTimeoutMs,
        );
      } catch (error) {
        throw stagedError(
          "payment_required_fetch",
          "The x402 payment request could not be loaded. Check the connection and try again.",
          error,
        );
      }
      const header = response.headers.get("PAYMENT-REQUIRED");
      requireValue(response.status === 402 && header, "server did not return HTTP 402 with PAYMENT-REQUIRED");
      paymentRequired = decodeHeader(header);
      accepted = validatePaymentRequired(paymentRequired, expected());
      options.applyTransactionTerms(transactionFromRequirement(accepted));
      options.showTerms("Payment terms verified");
      await report("terms_verified");
      options.setStatus("x402 payment terms verified.\nTap Pay with MetaMask when you are ready.", "ok");
      return true;
    }

    function transactionTerms() {
      requireValue(accepted, "x402 payment terms are not verified");
      requireValue(!transaction, "this page already submitted its one payment");
      return transactionFromRequirement(accepted);
    }

    async function transactionSubmitted(txRef, from) {
      transaction = txRef;
      payer = from;
      await report("transaction_submitted", { transaction: txRef, payer: from });
    }

    async function paymentIncluded(provider, receipt, txRef, from) {
      requireValue(lower(transaction) === lower(txRef) && lower(payer) === lower(from), "submitted transaction identity changed");
      while ((await provider.getBlockNumber()) - receipt.blockNumber < confirmations) {
        options.setStatus(
          "Payment is on-chain.\nWaiting for " + confirmations + " newer block" +
          (confirmations === 1 ? "" : "s") + " before finishing x402…\n" +
          options.shortHex(txRef)
        );
        await new Promise(function (resolve) { globalThis.setTimeout(resolve, 1000); });
      }
      options.setStatus("Payment confirmed. Finishing x402…\n" + options.shortHex(txRef), "ok");
      return finishPayment();
    }

    async function finishPayment() {
      requireValue(paymentRequired && accepted && transaction && payer, "payment transaction is not ready for x402 completion");
      const payload = createPaymentPayload(paymentRequired, accepted, transaction);
      await report("transaction_as_proof_prepared", { transaction: transaction });
      await report("transaction_reference_retry_started", { transaction: transaction });
      let response;
      try {
        response = await protectedFetch(
          resourceUrl,
          {
            method: "GET", cache: "no-store", credentials: "omit",
            headers: { "PAYMENT-SIGNATURE": encodeHeader(payload) },
          },
          protectedFetchTimeoutMs,
        );
        await report("transaction_reference_retry_fetch_succeeded", { success: true });
      } catch (error) {
        await report("transaction_reference_retry_fetch_failed", {
          success: false, error_stage: "transaction_reference_retry", error_name: errorName(error),
        });
        throw stagedError(
          "transaction_reference_retry",
          "The payment is confirmed, but x402 could not finish. Check the connection and retry finishing x402.",
          error,
        );
      }
      await report("transaction_reference_retry_http_received", { http_status: response.status });
      const responseHeader = response.headers.get("PAYMENT-RESPONSE");
      await report("transaction_reference_payment_response_checked", {
        http_status: response.status, payment_response_present: Boolean(responseHeader),
      });
      if (response.status !== 200) {
        throw stagedError(
          "transaction_reference_http",
          "The coffee server rejected the x402 completion (HTTP " + response.status + ").",
        );
      }
      if (!responseHeader) {
        throw stagedError(
          "payment_response",
          "The coffee server response was missing PAYMENT-RESPONSE.",
        );
      }
      try {
        validatePaymentResponse(decodeHeader(responseHeader), transaction, payer);
      } catch (error) {
        throw stagedError(
          "payment_response_validation",
          "The x402 payment response did not match this payment.",
          error,
        );
      }
      options.setStatus("Paid. Coffee authorized.\n" + options.shortHex(transaction), "ok");
      options.hideRetry();
    }

    return {
      enabled: Boolean(resourceUrl),
      isVerified: function () { return Boolean(accepted); },
      verify: verify,
      transactionTerms: transactionTerms,
      transactionSubmitted: transactionSubmitted,
      paymentIncluded: paymentIncluded,
      finishPayment: finishPayment,
      resetPayment: function () { transaction = null; payer = null; },
    };
  }

  return {
    CONTRACT_METHOD: CONTRACT_METHOD,
    PROTECTED_FETCH_TIMEOUT_MS: PROTECTED_FETCH_TIMEOUT_MS,
    decodeHeader: decodeHeader,
    encodeHeader: encodeHeader,
    validatePaymentRequired: validatePaymentRequired,
    transactionFromRequirement: transactionFromRequirement,
    createPaymentPayload: createPaymentPayload,
    validatePaymentResponse: validatePaymentResponse,
    createHumanWalletFlow: createHumanWalletFlow,
  };
});
