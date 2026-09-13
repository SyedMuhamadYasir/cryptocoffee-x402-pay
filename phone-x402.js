(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CryptoCoffeePhoneX402 = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const EXTRA_KEYS = [
    "assetTransferMethod", "paymentFlow", "sessionId", "sessionIdBytes32",
    "machineId", "machineIdBytes32", "deadline", "contractAddress",
    "contractMethod", "confirmations",
  ];
  const CONTRACT_METHOD = "payForSession(bytes32,bytes32,uint256,uint64)";

  function requireValue(condition, message) {
    if (!condition) throw new Error(message);
  }

  function lower(value) {
    return String(value || "").toLowerCase();
  }

  function stagedError(stage, userMessage, cause) {
    const error = new Error(userMessage);
    error.proofStage = stage;
    error.userMessage = userMessage;
    error.cause = cause;
    return error;
  }

  function errorName(error) {
    return String((error && error.name) || "Error").slice(0, 80);
  }

  async function signatureHash(signature) {
    const bytes = new TextEncoder().encode(String(signature));
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return "sha256:" + Array.from(new Uint8Array(digest), function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
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

  function createPaymentPayload(paymentRequired, accepted, txRef, payer) {
    return {
      x402Version: 2,
      payload: {
        type: "payment-proof",
        alg: "ES256K",
        format: "eip712",
        txRef: txRef,
        from: payer,
        signature: "0x",
      },
      accepted: accepted,
      resource: paymentRequired.resource,
    };
  }

  const PROOF_TYPES = {
    Resource: [
      { name: "url", type: "string" },
      { name: "description", type: "string" },
      { name: "mimeType", type: "string" },
    ],
    Accepted: [
      { name: "scheme", type: "string" },
      { name: "assetTransferMethod", type: "string" },
      { name: "paymentFlow", type: "string" },
      { name: "network", type: "string" },
      { name: "amount", type: "string" },
      { name: "asset", type: "string" },
      { name: "payTo", type: "address" },
      { name: "maxTimeoutSeconds", type: "uint256" },
      { name: "sessionId", type: "string" },
      { name: "sessionIdBytes32", type: "bytes32" },
      { name: "machineId", type: "string" },
      { name: "machineIdBytes32", type: "bytes32" },
      { name: "deadline", type: "uint64" },
      { name: "contractAddress", type: "address" },
      { name: "contractMethod", type: "string" },
      { name: "confirmations", type: "uint256" },
    ],
    PaymentProof: [
      { name: "txRef", type: "string" },
      { name: "from", type: "address" },
      { name: "resource", type: "Resource" },
      { name: "accepted", type: "Accepted" },
    ],
  };

  function buildPaymentProofTypedData(paymentPayload, includeDomainType) {
    const accepted = paymentPayload.accepted;
    const extra = accepted.extra;
    const types = Object.assign({}, PROOF_TYPES);
    if (includeDomainType) {
      types.EIP712Domain = [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ];
    }
    return {
      types: types,
      primaryType: "PaymentProof",
      domain: {
        name: "x402 Payment Proof",
        version: "1",
        chainId: Number(String(accepted.network).split(":")[1]),
      },
      message: {
        txRef: paymentPayload.payload.txRef,
        from: paymentPayload.payload.from,
        resource: {
          url: (paymentPayload.resource || {}).url || "",
          description: (paymentPayload.resource || {}).description || "",
          mimeType: (paymentPayload.resource || {}).mimeType || "",
        },
        accepted: {
          scheme: accepted.scheme,
          assetTransferMethod: extra.assetTransferMethod,
          paymentFlow: extra.paymentFlow,
          network: accepted.network,
          amount: String(accepted.amount),
          asset: accepted.asset,
          payTo: accepted.payTo,
          maxTimeoutSeconds: Number(accepted.maxTimeoutSeconds),
          sessionId: extra.sessionId,
          sessionIdBytes32: extra.sessionIdBytes32,
          machineId: extra.machineId,
          machineIdBytes32: extra.machineIdBytes32,
          deadline: Number(extra.deadline),
          contractAddress: extra.contractAddress,
          contractMethod: extra.contractMethod,
          confirmations: Number(extra.confirmations),
        },
      },
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
      const response = await fetch(resourceUrl, { method: "GET", cache: "no-store", credentials: "omit" });
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
      options.setStatus("Payment confirmed. Sign the x402 payment proof to finish.\n" + options.shortHex(txRef), "ok");
      options.showProof();
    }

    async function signProof(ethereum) {
      requireValue(paymentRequired && accepted && transaction && payer, "payment transaction is not ready for x402 proof");
      await report("proof_button_clicked", { transaction: transaction });
      if (!ethereum) {
        await report("proof_accounts_failed", {
          success: false, error_stage: "wallet_provider", error_name: "ProviderUnavailable",
        });
        throw stagedError(
          "wallet_provider",
          "MetaMask is not connected. Open this page inside MetaMask and try again.",
        );
      }
      let accounts;
      try {
        accounts = await ethereum.request({ method: "eth_accounts" });
        const payerMatches = Boolean(accounts.length && lower(accounts[0]) === lower(payer));
        await report("proof_accounts_succeeded", {
          success: true, account_count: accounts.length, payer_matches: payerMatches,
        });
        if (!payerMatches) {
          throw stagedError(
            "wallet_account_check",
            "The selected MetaMask account does not match the account that paid.",
          );
        }
      } catch (error) {
        if (error && error.proofStage) throw error;
        await report("proof_accounts_failed", {
          success: false, error_stage: "wallet_account_check", error_name: errorName(error),
        });
        throw stagedError(
          "wallet_account_check",
          "MetaMask could not confirm the account that made the payment.",
          error,
        );
      }
      const payload = createPaymentPayload(paymentRequired, accepted, transaction, payer);
      const typed = buildPaymentProofTypedData(payload, true);
      options.setStatus("Confirm the x402 payment proof in MetaMask…\nThis binds your payment to this exact coffee request.");
      await report("proof_typed_data_requested", { transaction: transaction });
      let signature;
      let digest;
      try {
        signature = await ethereum.request({
          method: "eth_signTypedData_v4", params: [payer, JSON.stringify(typed)],
        });
        requireValue(typeof signature === "string" && signature.length > 0, "MetaMask returned no proof signature");
      } catch (error) {
        await report("proof_signature_failed", {
          success: false, signature_present: false,
          error_stage: "typed_data_signature", error_name: errorName(error),
        });
        throw stagedError(
          "typed_data_signature",
          "MetaMask did not return the x402 payment proof signature.",
          error,
        );
      }
      try {
        digest = await signatureHash(signature);
      } catch (_) {
        digest = null; // Presence remains observable if hashing is unavailable.
      }
      await report("proof_signature_returned", {
        success: true, signature_present: true, signature_sha256: digest,
      });
      payload.payload.signature = signature;
      await report("proof_retry_started", {
        transaction: transaction, signature_present: true, signature_sha256: digest,
      });
      let response;
      try {
        response = await fetch(resourceUrl, {
          method: "GET", cache: "no-store", credentials: "omit",
          headers: { "PAYMENT-SIGNATURE": encodeHeader(payload) },
        });
        await report("proof_retry_fetch_succeeded", { success: true });
      } catch (error) {
        await report("proof_retry_fetch_failed", {
          success: false, error_stage: "signed_retry_fetch", error_name: errorName(error),
        });
        throw stagedError(
          "signed_retry_fetch",
          "The signed x402 request could not reach the coffee server. Check the connection and try again.",
          error,
        );
      }
      await report("proof_retry_http_received", { http_status: response.status });
      const responseHeader = response.headers.get("PAYMENT-RESPONSE");
      await report("proof_payment_response_checked", {
        http_status: response.status, payment_response_present: Boolean(responseHeader),
      });
      if (response.status !== 200) {
        throw stagedError(
          "signed_retry_http",
          "The coffee server rejected the signed x402 request (HTTP " + response.status + ").",
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
      options.hideProof();
    }

    return {
      enabled: Boolean(resourceUrl),
      isVerified: function () { return Boolean(accepted); },
      verify: verify,
      transactionTerms: transactionTerms,
      transactionSubmitted: transactionSubmitted,
      paymentIncluded: paymentIncluded,
      signProof: signProof,
      resetPayment: function () { transaction = null; payer = null; },
    };
  }

  return {
    CONTRACT_METHOD: CONTRACT_METHOD,
    PROOF_TYPES: PROOF_TYPES,
    decodeHeader: decodeHeader,
    encodeHeader: encodeHeader,
    validatePaymentRequired: validatePaymentRequired,
    transactionFromRequirement: transactionFromRequirement,
    createPaymentPayload: createPaymentPayload,
    buildPaymentProofTypedData: buildPaymentProofTypedData,
    validatePaymentResponse: validatePaymentResponse,
    createHumanWalletFlow: createHumanWalletFlow,
  };
});
