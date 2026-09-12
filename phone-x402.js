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
  };
});
