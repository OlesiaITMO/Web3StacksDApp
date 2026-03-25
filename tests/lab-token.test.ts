import { Cl } from "@stacks/transactions";
import { describe, expect, it } from "vitest";

const accounts = simnet.getAccounts();
const deployer = accounts.get("deployer")!;
const wallet1 = "STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6";
const wallet2 = "ST3AM1A56AK2C1XAFJ4115ZSV26EB49BVQ10MGCS0";

function mintTo(recipient: string, amount: number | bigint) {
  return simnet.callPublicFn(
    "lab-token-2",
    "mint",
    [Cl.uint(amount), Cl.standardPrincipal(recipient)],
    deployer
  );
}

function getTokenBalance(account: string) {
  return simnet.callReadOnlyFn(
    "lab-token-2",
    "get-balance",
    [Cl.standardPrincipal(account)],
    account
  );
}

function getLiquidityBalance(account: string) {
  return simnet.callReadOnlyFn(
    "liquidity-pool",
    "get-liquidity-balance",
    [Cl.standardPrincipal(account)],
    account
  );
}

describe("lab-token-2", () => {
  it("stores metadata and supports mint / transfer / burn flows", () => {
    simnet.transferSTX(5_000_000n, wallet1, deployer);
    simnet.transferSTX(5_000_000n, wallet2, deployer);

    expect(simnet.blockHeight).toBeDefined();

    expect(simnet.callReadOnlyFn("lab-token-2", "get-name", [], deployer).result).toBeAscii("Stonks");
    expect(simnet.callReadOnlyFn("lab-token-2", "get-symbol", [], deployer).result).toBeAscii("STS");
    expect(simnet.callReadOnlyFn("lab-token-2", "get-decimals", [], deployer).result).toBeUint(6);
    expect(simnet.callReadOnlyFn("lab-token-2", "get-owner", [], deployer).result).toBePrincipal(
      deployer
    );

    expect(mintTo(wallet1, 2_000_000n).result).toBeOk(Cl.bool(true));
    expect(getTokenBalance(wallet1).result).toBeUint(2_000_000n);
    expect(simnet.callReadOnlyFn("lab-token-2", "get-total-supply", [], deployer).result).toBeUint(
      2_000_000n
    );

    const transfer = simnet.callPublicFn(
      "lab-token-2",
      "transfer",
      [
        Cl.uint(500_000n),
        Cl.standardPrincipal(wallet1),
        Cl.standardPrincipal(wallet2),
        Cl.none(),
      ],
      wallet1
    );
    expect(transfer.result).toBeOk(Cl.bool(true));
    expect(getTokenBalance(wallet1).result).toBeUint(1_500_000n);
    expect(getTokenBalance(wallet2).result).toBeUint(500_000n);

    const burn = simnet.callPublicFn("lab-token-2", "burn", [Cl.uint(200_000n)], wallet2);
    expect(burn.result).toBeOk(Cl.bool(true));
    expect(getTokenBalance(wallet2).result).toBeUint(300_000n);
    expect(simnet.callReadOnlyFn("lab-token-2", "get-total-supply", [], deployer).result).toBeUint(
      1_800_000n
    );
  });

  it("rejects minting by non-owner accounts", () => {
    simnet.transferSTX(5_000_000n, wallet1, deployer);

    const failedMint = simnet.callPublicFn(
      "lab-token-2",
      "mint",
      [Cl.uint(1_000n), Cl.standardPrincipal(wallet1)],
      wallet1
    );

    expect(failedMint.result).toBeErr(Cl.uint(100));
  });
});

describe("liquidity-pool", () => {
  it("supports adding liquidity, swapping in both directions, and withdrawing", () => {
    simnet.transferSTX(5_000_000n, wallet1, deployer);
    simnet.transferSTX(5_000_000n, wallet2, deployer);

    expect(mintTo(wallet1, 2_000_000n).result).toBeOk(Cl.bool(true));
    expect(mintTo(wallet2, 1_000_000n).result).toBeOk(Cl.bool(true));

    const initialLiquidity = simnet.callPublicFn(
      "liquidity-pool",
      "add-liquidity",
      [Cl.uint(1_000_000n), Cl.uint(1_000_000n)],
      wallet1
    );
    expect(
      initialLiquidity.result
    ).toBeOk(
      Cl.tuple({
        "lp-minted": Cl.uint(1_000_000n),
        "token-reserve": Cl.uint(1_000_000n),
        "stx-reserve": Cl.uint(1_000_000n),
      })
    );

    expect(getLiquidityBalance(wallet1).result).toBeUint(1_000_000n);
    expect(getTokenBalance(wallet1).result).toBeUint(1_000_000n);
    expect(simnet.callReadOnlyFn("liquidity-pool", "get-token-reserve", [], wallet1).result).toBeUint(
      1_000_000n
    );
    expect(simnet.callReadOnlyFn("liquidity-pool", "get-stx-reserve", [], wallet1).result).toBeUint(
      1_000_000n
    );

    const secondLiquidity = simnet.callPublicFn(
      "liquidity-pool",
      "add-liquidity",
      [Cl.uint(500_000n), Cl.uint(500_000n)],
      wallet2
    );
    expect(
      secondLiquidity.result
    ).toBeOk(
      Cl.tuple({
        "lp-minted": Cl.uint(500_000n),
        "token-reserve": Cl.uint(1_500_000n),
        "stx-reserve": Cl.uint(1_500_000n),
      })
    );
    expect(getLiquidityBalance(wallet2).result).toBeUint(500_000n);
    expect(simnet.callReadOnlyFn("liquidity-pool", "get-lp-total-supply", [], wallet1).result).toBeUint(
      1_500_000n
    );

    expect(
      simnet.callReadOnlyFn(
        "liquidity-pool",
        "quote-stx-for-token",
        [Cl.uint(100_000n)],
        wallet2
      ).result
    ).toBeUint(93_750n);

    const stxForToken = simnet.callPublicFn(
      "liquidity-pool",
      "swap-stx-for-token",
      [Cl.uint(100_000n), Cl.uint(90_000n)],
      wallet2
    );
    expect(
      stxForToken.result
    ).toBeOk(
      Cl.tuple({
        "token-out": Cl.uint(93_750n),
        "token-reserve": Cl.uint(1_406_250n),
        "stx-reserve": Cl.uint(1_600_000n),
      })
    );

    expect(
      simnet.callReadOnlyFn(
        "liquidity-pool",
        "quote-token-for-stx",
        [Cl.uint(50_000n)],
        wallet2
      ).result
    ).toBeUint(54_935n);

    const tokenForStx = simnet.callPublicFn(
      "liquidity-pool",
      "swap-token-for-stx",
      [Cl.uint(50_000n), Cl.uint(50_000n)],
      wallet2
    );
    expect(
      tokenForStx.result
    ).toBeOk(
      Cl.tuple({
        "stx-out": Cl.uint(54_935n),
        "token-reserve": Cl.uint(1_456_250n),
        "stx-reserve": Cl.uint(1_545_065n),
      })
    );

    const removeLiquidity = simnet.callPublicFn(
      "liquidity-pool",
      "remove-liquidity",
      [Cl.uint(250_000n)],
      wallet1
    );
    expect(
      removeLiquidity.result
    ).toBeOk(
      Cl.tuple({
        "token-out": Cl.uint(242_708n),
        "stx-out": Cl.uint(257_510n),
        "token-reserve": Cl.uint(1_213_542n),
        "stx-reserve": Cl.uint(1_287_555n),
      })
    );

    expect(getLiquidityBalance(wallet1).result).toBeUint(750_000n);
    expect(simnet.callReadOnlyFn("liquidity-pool", "get-token-reserve", [], wallet1).result).toBeUint(
      1_213_542n
    );
    expect(simnet.callReadOnlyFn("liquidity-pool", "get-stx-reserve", [], wallet1).result).toBeUint(
      1_287_555n
    );
  });

  it("rejects a liquidity deposit with the wrong reserve ratio", () => {
    simnet.transferSTX(5_000_000n, wallet1, deployer);
    simnet.transferSTX(5_000_000n, wallet2, deployer);

    expect(mintTo(wallet1, 1_000_000n).result).toBeOk(Cl.bool(true));
    expect(mintTo(wallet2, 500_000n).result).toBeOk(Cl.bool(true));

    expect(
      simnet.callPublicFn(
        "liquidity-pool",
        "add-liquidity",
        [Cl.uint(500_000n), Cl.uint(500_000n)],
        wallet1
      ).result
    ).toBeOk(Cl.tuple({
      "lp-minted": Cl.uint(500_000n),
      "token-reserve": Cl.uint(500_000n),
      "stx-reserve": Cl.uint(500_000n),
    }));

    const invalidDeposit = simnet.callPublicFn(
      "liquidity-pool",
      "add-liquidity",
      [Cl.uint(100_000n), Cl.uint(50_000n)],
      wallet2
    );

    expect(invalidDeposit.result).toBeErr(Cl.uint(202));
  });
});
