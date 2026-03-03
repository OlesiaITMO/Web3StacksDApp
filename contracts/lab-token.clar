;; Name
(define-constant token-name "Stonks")
(define-constant token-symbol "Sts")
;; Owner
(define-data-var contract-owner principal tx-sender)

;; fungible token
(define-fungible-token lab-token)

;; READ ONLY

(define-read-only (get-name)
  token-name
)
(define-read-only (get-symbol)
  token-symbol
)
(define-read-only (get-owner)
  (var-get contract-owner)
)

;; MINT (owner only)

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err u100))
    (ft-mint? lab-token amount recipient)
  )
)

;; TRANSFER

(define-public (transfer (amount uint) (recipient principal))
  (ft-transfer? lab-token amount tx-sender recipient)
)

;; BURN

(define-public (burn (amount uint))
  (ft-burn? lab-token amount tx-sender)
)