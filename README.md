# CryptoCoffee x402 payment page

This intentionally small public repository hosts Benjamin-style CryptoCoffee
phone payment assets over browser-trusted GitHub Pages HTTPS. Session-specific
terms come from the kiosk query and are verified against the protected x402
resource's genuine `PAYMENT-REQUIRED` response before payment is enabled.

The page contains no private keys, operator credentials, environment files,
gateway code, machine code, runtime databases, or logs. Payment and the x402
proof each require a separate, explicit approval in MetaMask.

The private implementation and controlled demo launcher live in
`SyedMuhamadYasir/cryptocoffee-x402`.
