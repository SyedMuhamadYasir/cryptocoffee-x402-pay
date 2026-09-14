(function () {
  "use strict";

  var link = document.getElementById("mmLink");
  var help = document.getElementById("mmHandoffHelp");
  if (!link || !help) return;

  var handoffStartedAt = 0;
  var returnReported = false;
  var fallbackTimer = null;

  function providerPresent() {
    try {
      return typeof injectedProvider === "function" && Boolean(injectedProvider());
    } catch (error) {
      return false;
    }
  }

  function sameInvoiceAttempted() {
    try {
      return typeof handoffWasAttempted === "function" && handoffWasAttempted();
    } catch (error) {
      return false;
    }
  }

  function showOpening() {
    help.textContent = "Opening MetaMask...";
    help.hidden = false;
  }

  function showRetry() {
    if (!sameInvoiceAttempted() || providerPresent()) return;
    help.textContent = "MetaMask opened without the payment page. Tap Open in MetaMask again.";
    help.hidden = false;
    if (!returnReported && typeof reportHandoffEvent === "function") {
      returnReported = true;
      reportHandoffEvent("metamask_handoff_returned_without_provider", {
        provider_present: false,
      });
    }
  }

  function returnedToPage() {
    if (document.visibilityState !== "visible") return;
    if (handoffStartedAt && Date.now() - handoffStartedAt < 500) return;
    showRetry();
  }

  // Capture runs before the validated page's existing click handler. It only
  // presents handoff state; the existing handler remains authoritative for
  // exact-URL storage and first-attempt/retry telemetry.
  link.addEventListener("click", function () {
    handoffStartedAt = Date.now();
    returnReported = false;
    if (fallbackTimer) globalThis.clearTimeout(fallbackTimer);
    showOpening();
    fallbackTimer = globalThis.setTimeout(function () {
      if (document.visibilityState === "visible") showRetry();
    }, 1800);
  }, true);

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && fallbackTimer) {
      globalThis.clearTimeout(fallbackTimer);
      fallbackTimer = null;
      return;
    }
    returnedToPage();
  });
  window.addEventListener("pageshow", returnedToPage);
  window.addEventListener("focus", returnedToPage);
  window.addEventListener("DOMContentLoaded", function () {
    globalThis.setTimeout(returnedToPage, 0);
  });
})();
