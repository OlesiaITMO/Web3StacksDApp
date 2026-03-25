;; Lab token used by the liquidity pool dApp.
(define-constant token-name "Stonks")
(define-constant token-symbol "STS")
(define-constant token-decimals u6)
(define-constant token-uri (some u"https://github.com"))

(define-constant err-owner-only (err u100))
(define-constant err-not-token-owner (err u101))

(define-data-var contract-owner principal tx-sender)

(define-fungible-token lab-token-2)

(define-read-only (get-name)
  token-name
)

(define-read-only (get-symbol)
  token-symbol
)

(define-read-only (get-decimals)
  token-decimals
)

(define-read-only (get-token-uri)
  token-uri
)

(define-read-only (get-owner)
  (var-get contract-owner)
)

(define-read-only (get-total-supply)
  (ft-get-supply lab-token-2)
)

(define-read-only (get-balance (account principal))
  (ft-get-balance lab-token-2 account)
)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) err-owner-only)
    (try! (ft-mint? lab-token-2 amount recipient))
    (ok true)
  )
)

(define-public (transfer
    (amount uint)
    (sender principal)
    (recipient principal)
    (memo (optional (buff 34)))
  )
  (begin
    (asserts!
      (or (is-eq tx-sender sender) (is-eq contract-caller sender))
      err-not-token-owner
    )
    (try! (ft-transfer? lab-token-2 amount sender recipient))
    (match memo
      memo-value (print memo-value)
      0x
    )
    (ok true)
  )
)

(define-public (burn (amount uint))
  (begin
    (try! (ft-burn? lab-token-2 amount tx-sender))
    (ok true)
  )
)
