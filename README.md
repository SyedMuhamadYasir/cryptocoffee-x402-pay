# CryptoCoffee x402 payment page

This intentionally small public repository hosts Benjamin's current brown
CryptoCoffee phone payment page with only the minimum static x402 additions,
over browser-trusted GitHub Pages HTTPS. Session-specific
terms come from the kiosk query and are verified against the protected x402
resource's genuine `PAYMENT-REQUIRED` response before payment is enabled.

Visual and wallet-interaction reference:
<https://benckj.github.io/cryptocoffee-pay/pay.html>.

The page contains no private keys, operator credentials, environment files,
gateway code, machine code, runtime databases, or logs. Payment and the x402
proof each require a separate, explicit approval in MetaMask.

The private implementation and controlled demo launcher live in
`SyedMuhamadYasir/cryptocoffee-x402`.
