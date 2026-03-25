;; Simplified AMM pool for the lab token and STX.
;; The pool uses constant-product pricing without fees and mints LP tokens internally.

(define-constant err-invalid-amount (err u200))
(define-constant err-empty-pool (err u201))
(define-constant err-invalid-ratio (err u202))
(define-constant err-slippage (err u203))
(define-constant err-zero-output (err u204))

(define-fungible-token lp-token)

(define-data-var token-reserve uint u0)
(define-data-var stx-reserve uint u0)

(define-private (min-uint (left uint) (right uint))
  (if (< left right) left right)
)

(define-private (calculate-output (amount-in uint) (reserve-in uint) (reserve-out uint))
  (/ (* amount-in reserve-out) (+ reserve-in amount-in))
)

(define-read-only (get-token-reserve)
  (var-get token-reserve)
)

(define-read-only (get-stx-reserve)
  (var-get stx-reserve)
)

(define-read-only (get-lp-total-supply)
  (ft-get-supply lp-token)
)

(define-read-only (get-liquidity-balance (account principal))
  (ft-get-balance lp-token account)
)

(define-read-only (get-pool-state)
  {
    token-reserve: (var-get token-reserve),
    stx-reserve: (var-get stx-reserve),
    lp-total-supply: (ft-get-supply lp-token)
  }
)

(define-read-only (quote-add-liquidity (token-amount uint))
  (let (
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
      (lp-total-supply (ft-get-supply lp-token))
    )
    (if (or (is-eq token-amount u0) (is-eq lp-total-supply u0))
      {
        required-stx: token-amount,
        lp-to-mint: token-amount
      }
      {
        required-stx: (/ (* token-amount current-stx-reserve) current-token-reserve),
        lp-to-mint: (/ (* token-amount lp-total-supply) current-token-reserve)
      }
    )
  )
)

(define-read-only (quote-remove-liquidity (lp-amount uint))
  (let (
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
      (lp-total-supply (ft-get-supply lp-token))
    )
    (if (or (is-eq lp-amount u0) (is-eq lp-total-supply u0))
      {
        token-amount: u0,
        stx-amount: u0
      }
      {
        token-amount: (/ (* current-token-reserve lp-amount) lp-total-supply),
        stx-amount: (/ (* current-stx-reserve lp-amount) lp-total-supply)
      }
    )
  )
)

(define-read-only (quote-stx-for-token (stx-in uint))
  (let (
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
    )
    (if (or (is-eq stx-in u0) (is-eq current-token-reserve u0) (is-eq current-stx-reserve u0))
      u0
      (calculate-output stx-in current-stx-reserve current-token-reserve)
    )
  )
)

(define-read-only (quote-token-for-stx (token-in uint))
  (let (
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
    )
    (if (or (is-eq token-in u0) (is-eq current-token-reserve u0) (is-eq current-stx-reserve u0))
      u0
      (calculate-output token-in current-token-reserve current-stx-reserve)
    )
  )
)

(define-public (add-liquidity (token-amount uint) (stx-amount uint))
  (let (
      (user tx-sender)
      (pool (unwrap-panic (as-contract? () tx-sender)))
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
      (lp-total-supply (ft-get-supply lp-token))
    )
    (begin
      (asserts! (and (> token-amount u0) (> stx-amount u0)) err-invalid-amount)
      (if (> lp-total-supply u0)
        (asserts!
          (is-eq (* token-amount current-stx-reserve) (* stx-amount current-token-reserve))
          err-invalid-ratio
        )
        true
      )
      (let (
          (lp-to-mint
            (if (is-eq lp-total-supply u0)
              (min-uint token-amount stx-amount)
              (min-uint
                (/ (* token-amount lp-total-supply) current-token-reserve)
                (/ (* stx-amount lp-total-supply) current-stx-reserve)
              )
            )
          )
        )
        (begin
          (asserts! (> lp-to-mint u0) err-invalid-amount)
          (try! (contract-call? .lab-token-2 transfer token-amount user pool none))
          (try! (stx-transfer? stx-amount user pool))
          (try! (ft-mint? lp-token lp-to-mint user))
          (var-set token-reserve (+ current-token-reserve token-amount))
          (var-set stx-reserve (+ current-stx-reserve stx-amount))
          (ok {
            lp-minted: lp-to-mint,
            token-reserve: (+ current-token-reserve token-amount),
            stx-reserve: (+ current-stx-reserve stx-amount)
          })
        )
      )
    )
  )
)

(define-public (remove-liquidity (lp-amount uint))
  (let (
      (user tx-sender)
      (pool (unwrap-panic (as-contract? () tx-sender)))
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
      (lp-total-supply (ft-get-supply lp-token))
    )
    (begin
      (asserts! (> lp-amount u0) err-invalid-amount)
      (asserts! (> lp-total-supply u0) err-empty-pool)
      (let (
          (token-out (/ (* current-token-reserve lp-amount) lp-total-supply))
          (stx-out (/ (* current-stx-reserve lp-amount) lp-total-supply))
        )
        (begin
          (asserts! (and (> token-out u0) (> stx-out u0)) err-zero-output)
          (try! (ft-burn? lp-token lp-amount user))
          (try! (contract-call? .lab-token-2 transfer token-out pool user none))
          (try! (as-contract? ((with-stx stx-out)) (try! (stx-transfer? stx-out tx-sender user))))
          (var-set token-reserve (- current-token-reserve token-out))
          (var-set stx-reserve (- current-stx-reserve stx-out))
          (ok {
            token-out: token-out,
            stx-out: stx-out,
            token-reserve: (- current-token-reserve token-out),
            stx-reserve: (- current-stx-reserve stx-out)
          })
        )
      )
    )
  )
)

(define-public (swap-stx-for-token (stx-in uint) (min-token-out uint))
  (let (
      (user tx-sender)
      (pool (unwrap-panic (as-contract? () tx-sender)))
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
    )
    (begin
      (asserts! (> stx-in u0) err-invalid-amount)
      (asserts! (and (> current-token-reserve u0) (> current-stx-reserve u0)) err-empty-pool)
      (let ((token-out (calculate-output stx-in current-stx-reserve current-token-reserve)))
        (begin
          (asserts! (> token-out u0) err-zero-output)
          (asserts! (>= token-out min-token-out) err-slippage)
          (try! (stx-transfer? stx-in user pool))
          (try! (contract-call? .lab-token-2 transfer token-out pool user none))
          (var-set token-reserve (- current-token-reserve token-out))
          (var-set stx-reserve (+ current-stx-reserve stx-in))
          (ok {
            token-out: token-out,
            token-reserve: (- current-token-reserve token-out),
            stx-reserve: (+ current-stx-reserve stx-in)
          })
        )
      )
    )
  )
)

(define-public (swap-token-for-stx (token-in uint) (min-stx-out uint))
  (let (
      (user tx-sender)
      (pool (unwrap-panic (as-contract? () tx-sender)))
      (current-token-reserve (var-get token-reserve))
      (current-stx-reserve (var-get stx-reserve))
    )
    (begin
      (asserts! (> token-in u0) err-invalid-amount)
      (asserts! (and (> current-token-reserve u0) (> current-stx-reserve u0)) err-empty-pool)
      (let ((stx-out (calculate-output token-in current-token-reserve current-stx-reserve)))
        (begin
          (asserts! (> stx-out u0) err-zero-output)
          (asserts! (>= stx-out min-stx-out) err-slippage)
          (try! (contract-call? .lab-token-2 transfer token-in user pool none))
          (try! (as-contract? ((with-stx stx-out)) (try! (stx-transfer? stx-out tx-sender user))))
          (var-set token-reserve (+ current-token-reserve token-in))
          (var-set stx-reserve (- current-stx-reserve stx-out))
          (ok {
            stx-out: stx-out,
            token-reserve: (+ current-token-reserve token-in),
            stx-reserve: (- current-stx-reserve stx-out)
          })
        )
      )
    )
  )
)
