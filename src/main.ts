import "./styles.css";

import {
  Cl,
  ClarityType,
  Pc,
  cvToHex,
  fetchCallReadOnlyFunction,
  postConditionToHex,
  type ClarityValue,
} from "@stacks/transactions";

type Network = "testnet" | "mainnet";
type NoticeTone = "info" | "success" | "error";

type AppConfig = {
  network: Network;
  apiUrl: string;
  contractAddress: string;
  tokenContractName: string;
  poolContractName: string;
};

type AppState = {
  config: AppConfig;
  walletAddress: string | null;
  tokenName: string;
  tokenSymbol: string;
  tokenDecimals: number;
  tokenOwner: string;
  totalSupply: bigint;
  tokenReserve: bigint;
  stxReserve: bigint;
  lpTotalSupply: bigint;
  stxBalance: bigint | null;
  tokenBalance: bigint | null;
  lpBalance: bigint | null;
  lastTxId: string | null;
  busy: boolean;
};

const STORAGE_KEY = "stacks-liquidity-lab-config";
const WALLET_SESSION_KEY = "stacks-liquidity-lab-wallet-session";
const MICRO_UNITS = 1_000_000n;
const DEFAULT_NETWORK = (import.meta.env.VITE_STACKS_NETWORK as Network | undefined) ?? "testnet";
type ConnectModule = {
  connect: () => Promise<unknown>;
  disconnect: () => void;
  getLocalStorage: () => unknown;
  isConnected: () => boolean;
  request: (method: string, params?: unknown) => Promise<unknown>;
};

type InjectedProvider = {
  request: (method: string, params?: unknown) => Promise<unknown>;
};

declare global {
  interface Window {
    LeatherProvider?: InjectedProvider;
    StacksProvider?: InjectedProvider;
  }
}

const state: AppState = {
  config: loadConfig(),
  walletAddress: null,
  tokenName: "Token",
  tokenSymbol: "FT",
  tokenDecimals: 6,
  tokenOwner: "",
  totalSupply: 0n,
  tokenReserve: 0n,
  stxReserve: 0n,
  lpTotalSupply: 0n,
  stxBalance: null,
  tokenBalance: null,
  lpBalance: null,
  lastTxId: null,
  busy: false,
};

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) {
  throw new Error("Application root was not found.");
}

app.innerHTML = `
  <main class="shell">
    <section class="hero">
      <span class="hero__kicker">Web3 Lab / Stacks / Variant 3</span>
      <div class="stack">
        <h1 class="hero__title">Liquidity pool dApp for the lab token</h1>
        <p class="hero__copy">
          Интерфейс объединяет базовые действия с токеном и дополнительную логику варианта 3:
          подключение кошелька, просмотр балансов, mint / transfer / burn, добавление и вывод
          ликвидности, а также два направления свопа между STX и токеном.
        </p>
      </div>
      <div class="hero__meta">
        <span class="hero-pill" id="hero-network">Сеть: -</span>
        <span class="hero-pill mono" id="hero-contract">Контракт: -</span>
        <span class="hero-pill" id="hero-wallet">Кошелёк: не подключен</span>
      </div>
    </section>

    <section class="section section-grid section-grid--double">
      <article class="panel panel--feature">
        <p class="panel__eyebrow">Конфигурация</p>
        <h2 class="panel__title">Подключение и адреса контрактов</h2>
        <p class="panel__subtitle">
          После деплоя в testnet достаточно подставить адрес деплойера и обновить данные прямо в UI.
        </p>
        <form class="form" id="config-form">
          <div class="form-grid">
            <div class="field">
              <label for="network">Сеть</label>
              <select id="network" name="network">
                <option value="testnet">testnet</option>
                <option value="mainnet">mainnet</option>
              </select>
            </div>
            <div class="field">
              <label for="api-url">Hiro API URL</label>
              <input id="api-url" name="api-url" type="text" />
            </div>
          </div>
          <div class="field">
            <label for="contract-address">Адрес деплойера контрактов</label>
            <input id="contract-address" name="contract-address" type="text" placeholder="STA..." />
          </div>
          <div class="form-grid">
            <div class="field">
              <label for="token-contract-name">Имя токен-контракта</label>
              <input id="token-contract-name" name="token-contract-name" type="text" />
            </div>
            <div class="field">
              <label for="pool-contract-name">Имя контракта пула</label>
              <input id="pool-contract-name" name="pool-contract-name" type="text" />
            </div>
          </div>
          <div class="actions">
            <button class="button button--primary" type="submit">Сохранить конфиг</button>
            <button class="button button--secondary" type="button" id="refresh-button">Обновить данные</button>
          </div>
        </form>
      </article>

      <article class="panel">
        <p class="panel__eyebrow">Кошелёк</p>
        <h2 class="panel__title">Сессия пользователя</h2>
        <p class="panel__subtitle">
          Адрес подтягивается сначала из локальной сессии, затем через доступные методы wallet
          provider, чтобы приложение корректно работало с разными Stacks-кошельками.
        </p>
        <div class="stack">
          <div class="status-line">
            <span class="status-badge" id="wallet-state" data-tone="warning">Не подключено</span>
            <span class="status-badge mono" id="wallet-address">Адрес не найден</span>
            <span class="status-badge" id="owner-badge">Owner-mode: off</span>
          </div>
          <div class="actions">
            <button class="button button--primary" id="connect-button" type="button">Подключить кошелёк</button>
            <button class="button button--ghost" id="disconnect-button" type="button">Отключить</button>
          </div>
          <div id="notice" class="notice" data-tone="info">
            Приложение ещё не отправляло транзакций. После первой операции здесь появится статус.
          </div>
        </div>
      </article>
    </section>

    <section class="section panel">
      <p class="panel__eyebrow">Сводка</p>
      <h2 class="panel__title">Ончейн-метрики dApp</h2>
      <p class="panel__subtitle">
        Все значения читаются с сети через read-only вызовы и Hiro API. Балансы кошелька
        отображаются только после подключения.
      </p>
      <div class="metrics">
        <div class="metric"><p class="metric__label">Общий supply токена</p><p class="metric__value" id="metric-total-supply">-</p><p class="metric__hint" id="metric-token-meta">-</p></div>
        <div class="metric"><p class="metric__label">Резерв токена в пуле</p><p class="metric__value" id="metric-token-reserve">-</p><p class="metric__hint">Актив внутри AMM</p></div>
        <div class="metric"><p class="metric__label">Резерв STX в пуле</p><p class="metric__value" id="metric-stx-reserve">-</p><p class="metric__hint">Нативный актив сети</p></div>
        <div class="metric"><p class="metric__label">Общий LP supply</p><p class="metric__value" id="metric-lp-supply">-</p><p class="metric__hint">Доли провайдеров ликвидности</p></div>
        <div class="metric"><p class="metric__label">Баланс STX кошелька</p><p class="metric__value" id="metric-wallet-stx">-</p><p class="metric__hint">Требуется подключение</p></div>
        <div class="metric"><p class="metric__label">Баланс токена</p><p class="metric__value" id="metric-wallet-token">-</p><p class="metric__hint">Требуется подключение</p></div>
        <div class="metric"><p class="metric__label">Баланс LP-токена</p><p class="metric__value" id="metric-wallet-lp">-</p><p class="metric__hint">Требуется подключение</p></div>
        <div class="metric"><p class="metric__label">Owner контракта</p><p class="metric__value mono" id="metric-owner">-</p><p class="metric__hint">Адрес владельца токена</p></div>
      </div>
    </section>

    <section class="section section-grid section-grid--double">
      <article class="panel">
        <p class="panel__eyebrow">Token dApp</p>
        <h2 class="panel__title">Базовые операции с токеном</h2>
        <p class="panel__subtitle">Баланс, перевод токена, а также mint и burn.</p>
        <div class="stack">
          <form class="form" id="mint-form">
            <div class="form-grid">
              <div class="field"><label for="mint-recipient">Получатель mint</label><input id="mint-recipient" type="text" placeholder="ST..." /></div>
              <div class="field"><label for="mint-amount">Количество токенов</label><input id="mint-amount" type="text" placeholder="10" /></div>
            </div>
            <div class="actions"><button class="button button--signal" id="mint-submit" type="submit">Mint (owner only)</button></div>
            <p class="helper" id="mint-helper">Форма доступна только владельцу контракта.</p>
          </form>

          <form class="form" id="transfer-form">
            <div class="form-grid">
              <div class="field"><label for="transfer-recipient">Получатель перевода</label><input id="transfer-recipient" type="text" placeholder="ST..." /></div>
              <div class="field"><label for="transfer-amount">Количество токенов</label><input id="transfer-amount" type="text" placeholder="2.5" /></div>
            </div>
            <div class="actions"><button class="button button--primary" type="submit">Перевести токены</button></div>
          </form>

          <form class="form" id="burn-form">
            <div class="field"><label for="burn-amount">Сколько сжечь</label><input id="burn-amount" type="text" placeholder="1" /></div>
            <div class="actions"><button class="button button--ghost" type="submit">Burn</button></div>
          </form>
        </div>
      </article>

      <article class="panel panel--feature">
        <p class="panel__eyebrow">Liquidity</p>
        <h2 class="panel__title">Пул ликвидности и свопы</h2>
        <p class="panel__subtitle">Пул построен по модели constant-product AMM без комиссии.</p>
        <div class="stack">
          <form class="form" id="add-liquidity-form">
            <div class="form-grid">
              <div class="field"><label for="liquidity-token-amount">Токены в пул</label><input id="liquidity-token-amount" type="text" placeholder="5" /></div>
              <div class="field"><label for="liquidity-stx-amount">STX в пул</label><input id="liquidity-stx-amount" type="text" placeholder="5" /></div>
            </div>
            <div class="quote mono" id="liquidity-quote">Квота добавления будет рассчитана после загрузки резервов.</div>
            <div class="actions"><button class="button button--primary" type="submit">Добавить ликвидность</button></div>
          </form>

          <form class="form" id="remove-liquidity-form">
            <div class="field"><label for="remove-liquidity-amount">LP к выводу</label><input id="remove-liquidity-amount" type="text" placeholder="1" /></div>
            <div class="quote mono" id="remove-liquidity-quote">Квота вывода появится после ввода количества LP-токенов.</div>
            <div class="actions"><button class="button button--ghost" type="submit">Вывести ликвидность</button></div>
          </form>

          <form class="form" id="swap-stx-form">
            <div class="form-grid">
              <div class="field"><label for="swap-stx-in">STX для обмена</label><input id="swap-stx-in" type="text" placeholder="1" /></div>
              <div class="field"><label for="swap-stx-min-out">Минимум токенов на выходе</label><input id="swap-stx-min-out" type="text" placeholder="0.9" /></div>
            </div>
            <div class="quote mono" id="swap-stx-quote">Курс STX → token будет рассчитан по текущим резервам.</div>
            <div class="actions"><button class="button button--primary" type="submit">Swap STX → token</button></div>
          </form>

          <form class="form" id="swap-token-form">
            <div class="form-grid">
              <div class="field"><label for="swap-token-in">Токены для обмена</label><input id="swap-token-in" type="text" placeholder="1" /></div>
              <div class="field"><label for="swap-token-min-out">Минимум STX на выходе</label><input id="swap-token-min-out" type="text" placeholder="0.9" /></div>
            </div>
            <div class="quote mono" id="swap-token-quote">Курс token → STX будет рассчитан по текущим резервам.</div>
            <div class="actions"><button class="button button--primary" type="submit">Swap token → STX</button></div>
          </form>
        </div>
      </article>
    </section>

    <section class="section section-grid section-grid--double">
      <article class="panel">
        <p class="panel__eyebrow">Deployment</p>
        <h2 class="panel__title">Что нужно сделать перед демонстрацией</h2>
        <ul class="list">
          <li>Развернуть оба контракта в testnet и подставить адрес деплойера в конфиг приложения.</li>
          <li>Выполнить mint токенов владельцем и создать первый пул ликвидности.</li>
          <li>Опубликовать статический фронтенд через GitHub Pages или Render.</li>
          <li>Добавить в README итоговые ссылки на explorer и публичный URL приложения.</li>
        </ul>
      </article>

      <article class="panel">
        <p class="panel__eyebrow">Explorer</p>
        <h2 class="panel__title">Последняя транзакция</h2>
        <div class="stack">
          <div class="code-block mono" id="last-tx-output">Транзакций ещё не было.</div>
          <div class="actions"><a class="button button--secondary" id="last-tx-link" href="#" target="_blank" rel="noreferrer">Открыть в Hiro Explorer</a></div>
        </div>
      </article>
    </section>
  </main>
`;

bindEvents();
writeConfigToForm();
void refreshAll();

window.setInterval(() => {
  void refreshAll({ silent: true });
}, 30000);

async function getConnectModule(): Promise<ConnectModule> {
  return {
    connect: connectInjectedWallet,
    disconnect: disconnectInjectedWallet,
    getLocalStorage: getStoredWalletSession,
    isConnected: isWalletSessionActive,
    request: requestWithInjectedWallet,
  };
}

function loadConfig(): AppConfig {
  const fallback: AppConfig = {
    network: DEFAULT_NETWORK,
    apiUrl:
      import.meta.env.VITE_HIRO_API_URL ||
      (DEFAULT_NETWORK === "mainnet" ? "https://api.hiro.so" : "https://api.testnet.hiro.so"),
    contractAddress: import.meta.env.VITE_CONTRACT_ADDRESS || "",
    tokenContractName: import.meta.env.VITE_TOKEN_CONTRACT_NAME || "lab-token-2",
    poolContractName: import.meta.env.VITE_POOL_CONTRACT_NAME || "liquidity-pool",
  };

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<AppConfig>;
    return {
      network: saved.network === "mainnet" ? "mainnet" : fallback.network,
      apiUrl: saved.apiUrl || fallback.apiUrl,
      contractAddress: saved.contractAddress || fallback.contractAddress,
      tokenContractName: saved.tokenContractName || fallback.tokenContractName,
      poolContractName: saved.poolContractName || fallback.poolContractName,
    };
  } catch {
    return fallback;
  }
}

function bindEvents() {
  getEl<HTMLFormElement>("config-form").addEventListener("submit", event => {
    event.preventDefault();
    state.config = readConfigFromForm();
    persistConfig();
    writeConfigToForm();
    setNotice("Конфигурация обновлена. Перечитываю ончейн-данные...", "success");
    void refreshAll();
  });

  getEl<HTMLButtonElement>("refresh-button").addEventListener("click", () => {
    void refreshAll();
  });

  getEl<HTMLButtonElement>("connect-button").addEventListener("click", () => {
    void withBusy(async () => {
      const connectModule = await getConnectModule();
      await connectModule.connect();
      await refreshAll();
      setNotice("Кошелёк подключён. Можно выполнять on-chain операции.", "success");
    });
  });

  getEl<HTMLButtonElement>("disconnect-button").addEventListener("click", () => {
    void withBusy(async () => {
      const connectModule = await getConnectModule();
      connectModule.disconnect();
      state.walletAddress = null;
      state.stxBalance = null;
      state.tokenBalance = null;
      state.lpBalance = null;
      render();
      setNotice("Сессия кошелька завершена.", "info");
    });
  });

  getEl<HTMLFormElement>("mint-form").addEventListener("submit", event => {
    event.preventDefault();
    void withBusy(async () => {
      const recipient = getInputValue("mint-recipient");
      const amount = parseAmountInput(getInputValue("mint-amount"));
      await executeContractCall(state.config.tokenContractName, "mint", [
        Cl.uint(amount),
        Cl.standardPrincipal(recipient),
      ]);
    });
  });

  getEl<HTMLFormElement>("transfer-form").addEventListener("submit", event => {
    event.preventDefault();
    void withBusy(async () => {
      const sender = requireWallet();
      const recipient = getInputValue("transfer-recipient");
      const amount = parseAmountInput(getInputValue("transfer-amount"));

      await executeContractCall(
        state.config.tokenContractName,
        "transfer",
        [Cl.uint(amount), Cl.standardPrincipal(sender), Cl.standardPrincipal(recipient), Cl.none()],
        {
          postConditionMode: "deny",
          postConditions: [
            Pc.principal(sender).willSendEq(amount).ft(
              contractId(state.config.contractAddress, state.config.tokenContractName),
              "lab-token-2"
            ),
          ],
        }
      );
    });
  });

  getEl<HTMLFormElement>("burn-form").addEventListener("submit", event => {
    event.preventDefault();
    void withBusy(async () => {
      const sender = requireWallet();
      const amount = parseAmountInput(getInputValue("burn-amount"));

      await executeContractCall(state.config.tokenContractName, "burn", [Cl.uint(amount)], {
        postConditionMode: "deny",
        postConditions: [
          Pc.principal(sender).willSendEq(amount).ft(
            contractId(state.config.contractAddress, state.config.tokenContractName),
            "lab-token-2"
          ),
        ],
      });
    });
  });

  getEl<HTMLFormElement>("add-liquidity-form").addEventListener("submit", event => {
    event.preventDefault();
    void withBusy(async () => {
      const sender = requireWallet();
      const tokenAmount = parseAmountInput(getInputValue("liquidity-token-amount"));
      const stxAmount = parseAmountInput(getInputValue("liquidity-stx-amount"));

      await executeContractCall(
        state.config.poolContractName,
        "add-liquidity",
        [Cl.uint(tokenAmount), Cl.uint(stxAmount)],
        {
          postConditionMode: "deny",
          postConditions: [
            Pc.principal(sender).willSendEq(tokenAmount).ft(
              contractId(state.config.contractAddress, state.config.tokenContractName),
              "lab-token-2"
            ),
            Pc.principal(sender).willSendEq(stxAmount).ustx(),
          ],
        }
      );
    });
  });

  getEl<HTMLFormElement>("remove-liquidity-form").addEventListener("submit", event => {
    event.preventDefault();
    void withBusy(async () => {
      const lpAmount = parseAmountInput(getInputValue("remove-liquidity-amount"));
      await executeContractCall(state.config.poolContractName, "remove-liquidity", [Cl.uint(lpAmount)]);
    });
  });

  getEl<HTMLFormElement>("swap-stx-form").addEventListener("submit", event => {
    event.preventDefault();
    void withBusy(async () => {
      const sender = requireWallet();
      const stxIn = parseAmountInput(getInputValue("swap-stx-in"));
      const minOut = parseAmountInput(getInputValue("swap-stx-min-out"));

      await executeContractCall(
        state.config.poolContractName,
        "swap-stx-for-token",
        [Cl.uint(stxIn), Cl.uint(minOut)],
        {
          postConditionMode: "deny",
          postConditions: [Pc.principal(sender).willSendEq(stxIn).ustx()],
        }
      );
    });
  });

  getEl<HTMLFormElement>("swap-token-form").addEventListener("submit", event => {
    event.preventDefault();
    void withBusy(async () => {
      const sender = requireWallet();
      const tokenIn = parseAmountInput(getInputValue("swap-token-in"));
      const minOut = parseAmountInput(getInputValue("swap-token-min-out"));

      await executeContractCall(
        state.config.poolContractName,
        "swap-token-for-stx",
        [Cl.uint(tokenIn), Cl.uint(minOut)],
        {
          postConditionMode: "deny",
          postConditions: [
            Pc.principal(sender).willSendEq(tokenIn).ft(
              contractId(state.config.contractAddress, state.config.tokenContractName),
              "lab-token-2"
            ),
          ],
        }
      );
    });
  });

  [
    "liquidity-token-amount",
    "liquidity-stx-amount",
    "remove-liquidity-amount",
    "swap-stx-in",
    "swap-token-in",
  ].forEach(id => {
    getEl<HTMLInputElement>(id).addEventListener("input", () => {
      updateQuotes();
    });
  });
}

async function withBusy(task: () => Promise<void>) {
  if (state.busy) return;
  state.busy = true;
  render();
  try {
    await task();
  } catch (error) {
    setNotice(readError(error), "error");
  } finally {
    state.busy = false;
    render();
  }
}

async function refreshAll(options: { silent?: boolean } = {}) {
  try {
    await syncWallet();
    await fetchTokenAndPoolData();
    if (state.walletAddress) {
      await fetchWalletData(state.walletAddress);
    } else {
      state.stxBalance = null;
      state.tokenBalance = null;
      state.lpBalance = null;
    }
    updateQuotes();
    render();
    if (!options.silent) {
      setNotice("Ончейн-данные обновлены.", "info");
    }
  } catch (error) {
    render();
    if (!options.silent) {
      setNotice(readError(error), "error");
    }
  }
}

async function syncWallet() {
  const connectModule = await getConnectModule();

  if (!connectModule.isConnected()) {
    state.walletAddress = null;
    return;
  }

  const localAddress = extractAddressFromPayload(connectModule.getLocalStorage());
  if (localAddress) {
    state.walletAddress = localAddress;
    return;
  }

  try {
    const accountsResponse = await connectModule.request("stx_getAccounts");
    const address = extractAddressFromPayload(accountsResponse);
    if (address) {
      state.walletAddress = address;
      return;
    }
  } catch {
    // fall through
  }

  try {
    const addressesResponse = await connectModule.request("stx_getAddresses");
    state.walletAddress = extractAddressFromPayload(addressesResponse);
  } catch {
    state.walletAddress = null;
  }
}

async function fetchTokenAndPoolData() {
  assertConfigured();

  const [tokenName, tokenSymbol, tokenOwner, totalSupply, tokenReserve, stxReserve, lpTotalSupply] =
    await Promise.all([
      readOnlyValue(state.config.tokenContractName, "get-name"),
      readOnlyValue(state.config.tokenContractName, "get-symbol"),
      readOnlyValue(state.config.tokenContractName, "get-owner"),
      readOnlyValue(state.config.tokenContractName, "get-total-supply"),
      readOnlyValue(state.config.poolContractName, "get-token-reserve"),
      readOnlyValue(state.config.poolContractName, "get-stx-reserve"),
      readOnlyValue(state.config.poolContractName, "get-lp-total-supply"),
    ]);

  state.tokenName = String(tokenName);
  state.tokenSymbol = String(tokenSymbol);
  state.tokenOwner = String(tokenOwner);
  state.totalSupply = ensureBigInt(totalSupply);
  state.tokenReserve = ensureBigInt(tokenReserve);
  state.stxReserve = ensureBigInt(stxReserve);
  state.lpTotalSupply = ensureBigInt(lpTotalSupply);
}

async function fetchWalletData(address: string) {
  const [tokenBalance, lpBalance, stxBalance] = await Promise.all([
    readOnlyValue(state.config.tokenContractName, "get-balance", [Cl.standardPrincipal(address)]),
    readOnlyValue(state.config.poolContractName, "get-liquidity-balance", [Cl.standardPrincipal(address)]),
    fetchStxBalance(address),
  ]);

  state.tokenBalance = ensureBigInt(tokenBalance);
  state.lpBalance = ensureBigInt(lpBalance);
  state.stxBalance = stxBalance;
}

async function fetchStxBalance(address: string): Promise<bigint> {
  const response = await fetch(`${state.config.apiUrl}/extended/v1/address/${address}/balances`);
  if (!response.ok) {
    throw new Error(`Не удалось получить STX-баланс: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { stx?: { balance?: string } };
  return BigInt(payload.stx?.balance ?? "0");
}

async function readOnlyValue(
  contractName: string,
  functionName: string,
  functionArgs: ClarityValue[] = []
): Promise<unknown> {
  const senderAddress = state.walletAddress || state.config.contractAddress;
  const result = await fetchCallReadOnlyFunction({
    contractAddress: state.config.contractAddress,
    contractName,
    functionName,
    functionArgs,
    senderAddress,
    network: state.config.network,
  });

  return clarityToJs(result);
}

async function executeContractCall(
  contractName: string,
  functionName: string,
  functionArgs: ClarityValue[],
  options: {
    postConditions?: unknown[];
    postConditionMode?: "allow" | "deny";
  } = {}
) {
  assertConfigured();
  requireWallet();
  const connectModule = await getConnectModule();

  const response = (await connectModule.request("stx_callContract", {
    contract: contractId(state.config.contractAddress, contractName),
    functionName,
    functionArgs,
    network: state.config.network,
    postConditions: options.postConditions ?? [],
    postConditionMode: options.postConditionMode ?? "allow",
    sponsored: false,
  })) as { txid?: string; txId?: string };

  state.lastTxId = response.txId ?? response.txid ?? null;
  render();

  setNotice(
    state.lastTxId ? `Транзакция отправлена: ${state.lastTxId}` : "Транзакция отправлена в сеть.",
    "success"
  );

  await refreshAll({ silent: true });
}

function getInjectedProvider(): InjectedProvider {
  const provider = window.LeatherProvider ?? window.StacksProvider;
  if (!provider || typeof provider.request !== "function") {
    throw new Error("Stacks-кошелёк не найден. Установите Leather и откройте приложение в браузере с этим расширением.");
  }
  return provider;
}

async function connectInjectedWallet() {
  const provider = getInjectedProvider();

  let payload: unknown;
  try {
    payload = await provider.request("stx_getAccounts");
  } catch {
    payload = await provider.request("stx_getAddresses");
  }

  window.localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(payload));
  return payload;
}

function disconnectInjectedWallet() {
  window.localStorage.removeItem(WALLET_SESSION_KEY);
}

function getStoredWalletSession(): unknown {
  const raw = window.localStorage.getItem(WALLET_SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isWalletSessionActive(): boolean {
  return Boolean(getStoredWalletSession());
}

async function requestWithInjectedWallet(method: string, params?: unknown): Promise<unknown> {
  const provider = getInjectedProvider();
  const normalizedParams = normalizeWalletRequestParams(method, params);
  const response = await provider.request(method, normalizedParams);

  if (method === "stx_getAccounts" || method === "stx_getAddresses") {
    window.localStorage.setItem(WALLET_SESSION_KEY, JSON.stringify(response));
  }

  return response;
}

function normalizeWalletRequestParams(method: string, params: unknown): unknown {
  if (!params || typeof params !== "object") return params;

  if (method !== "stx_callContract") return params;

  const call = params as {
    functionArgs?: ClarityValue[];
    postConditions?: unknown[];
    postConditionMode?: "allow" | "deny";
    [key: string]: unknown;
  };

  return {
    ...call,
    functionArgs: (call.functionArgs ?? []).map(arg => cvToHex(arg)),
    postConditions: (call.postConditions ?? []).map(postCondition =>
      postConditionToHex(postCondition as Parameters<typeof postConditionToHex>[0])
    ),
    postConditionMode: call.postConditionMode ?? "allow",
  };
}

function updateQuotes() {
  const liquidityTokenAmount = safeParseInput("liquidity-token-amount");
  const liquidityStxAmount = safeParseInput("liquidity-stx-amount");
  const removeLiquidityAmount = safeParseInput("remove-liquidity-amount");
  const swapStxIn = safeParseInput("swap-stx-in");
  const swapTokenIn = safeParseInput("swap-token-in");

  if (state.tokenReserve === 0n || state.stxReserve === 0n || state.lpTotalSupply === 0n) {
    setText(
      "liquidity-quote",
      `Пул пока пуст. Для первой ликвидности можно задать произвольное соотношение. Сейчас введено: token=${formatAmount(liquidityTokenAmount)} / stx=${formatAmount(liquidityStxAmount)}.`
    );
  } else {
    const requiredStx = (liquidityTokenAmount * state.stxReserve) / state.tokenReserve;
    const lpToMint = (liquidityTokenAmount * state.lpTotalSupply) / state.tokenReserve;
    setText(
      "liquidity-quote",
      `Для сохранения текущего ratio нужно примерно ${formatAmount(requiredStx)} STX. Ожидаемый выпуск LP: ${formatAmount(lpToMint)}.`
    );
  }

  if (state.lpTotalSupply === 0n || removeLiquidityAmount === 0n) {
    setText("remove-liquidity-quote", "Введите количество LP-токенов, чтобы увидеть прогноз вывода.");
  } else {
    const tokenOut = (state.tokenReserve * removeLiquidityAmount) / state.lpTotalSupply;
    const stxOut = (state.stxReserve * removeLiquidityAmount) / state.lpTotalSupply;
    setText(
      "remove-liquidity-quote",
      `Ориентировочный вывод: ${formatAmount(tokenOut)} ${state.tokenSymbol} и ${formatAmount(stxOut)} STX.`
    );
  }

  if (state.tokenReserve === 0n || state.stxReserve === 0n || swapStxIn === 0n) {
    setText("swap-stx-quote", "Курс STX → token будет рассчитан по текущим резервам.");
  } else {
    setText(
      "swap-stx-quote",
      `Приблизительный output без комиссии: ${formatAmount(quoteOut(swapStxIn, state.stxReserve, state.tokenReserve))} ${state.tokenSymbol}.`
    );
  }

  if (state.tokenReserve === 0n || state.stxReserve === 0n || swapTokenIn === 0n) {
    setText("swap-token-quote", "Курс token → STX будет рассчитан по текущим резервам.");
  } else {
    setText(
      "swap-token-quote",
      `Приблизительный output без комиссии: ${formatAmount(quoteOut(swapTokenIn, state.tokenReserve, state.stxReserve))} STX.`
    );
  }
}

function render() {
  setText("hero-network", `Сеть: ${state.config.network}`);
  setText(
    "hero-contract",
    state.config.contractAddress
      ? contractId(state.config.contractAddress, state.config.poolContractName)
      : "Контракты: адрес не задан"
  );
  setText(
    "hero-wallet",
    state.walletAddress ? `Кошелёк: ${shortAddress(state.walletAddress)}` : "Кошелёк: не подключен"
  );

  const connected = Boolean(state.walletAddress);
  setBadge("wallet-state", connected ? "Подключено" : "Не подключено", connected ? "success" : "warning");
  setText("wallet-address", state.walletAddress || "Адрес не найден");

  const ownerMode = connected && state.walletAddress === state.tokenOwner;
  setBadge("owner-badge", ownerMode ? "Owner-mode: on" : "Owner-mode: off", ownerMode ? "success" : "warning");

  getEl<HTMLButtonElement>("mint-submit").disabled = !ownerMode || state.busy;
  setText(
    "mint-helper",
    ownerMode
      ? "Текущий кошелёк совпадает с owner контракта. Функция mint доступна."
      : "Чтобы чеканить токены, подключите кошелёк владельца контракта."
  );

  setText("metric-total-supply", `${formatAmount(state.totalSupply)} ${state.tokenSymbol}`);
  setText("metric-token-meta", `${state.tokenName} / ${state.tokenSymbol} / decimals=${state.tokenDecimals}`);
  setText("metric-token-reserve", `${formatAmount(state.tokenReserve)} ${state.tokenSymbol}`);
  setText("metric-stx-reserve", `${formatAmount(state.stxReserve)} STX`);
  setText("metric-lp-supply", formatAmount(state.lpTotalSupply));
  setText("metric-wallet-stx", state.stxBalance === null ? "—" : `${formatAmount(state.stxBalance)} STX`);
  setText("metric-wallet-token", state.tokenBalance === null ? "—" : `${formatAmount(state.tokenBalance)} ${state.tokenSymbol}`);
  setText("metric-wallet-lp", state.lpBalance === null ? "—" : formatAmount(state.lpBalance));
  setText("metric-owner", state.tokenOwner || "—");

  const lastTxBlock = getEl<HTMLDivElement>("last-tx-output");
  const lastTxLink = getEl<HTMLAnchorElement>("last-tx-link");
  if (state.lastTxId) {
    lastTxBlock.textContent = state.lastTxId;
    lastTxLink.href = txExplorerUrl(state.lastTxId);
    lastTxLink.style.pointerEvents = "auto";
    lastTxLink.style.opacity = "1";
  } else {
    lastTxBlock.textContent = "Транзакций ещё не было.";
    lastTxLink.href = "#";
    lastTxLink.style.pointerEvents = "none";
    lastTxLink.style.opacity = "0.5";
  }

  ["connect-button", "disconnect-button", "refresh-button"].forEach(id => {
    getEl<HTMLButtonElement>(id).disabled = state.busy;
  });
}

function persistConfig() {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.config));
}

function writeConfigToForm() {
  getEl<HTMLSelectElement>("network").value = state.config.network;
  getEl<HTMLInputElement>("api-url").value = state.config.apiUrl;
  getEl<HTMLInputElement>("contract-address").value = state.config.contractAddress;
  getEl<HTMLInputElement>("token-contract-name").value = state.config.tokenContractName;
  getEl<HTMLInputElement>("pool-contract-name").value = state.config.poolContractName;
}

function readConfigFromForm(): AppConfig {
  const network = getEl<HTMLSelectElement>("network").value === "mainnet" ? "mainnet" : "testnet";
  const apiUrl = getInputValue("api-url") || defaultApiUrl(network);

  return {
    network,
    apiUrl,
    contractAddress: getInputValue("contract-address"),
    tokenContractName: getInputValue("token-contract-name") || "lab-token-2",
    poolContractName: getInputValue("pool-contract-name") || "liquidity-pool",
  };
}

function setNotice(message: string, tone: NoticeTone) {
  const notice = getEl<HTMLDivElement>("notice");
  notice.dataset.tone = tone;
  notice.textContent = message;
}

function setText(id: string, text: string) {
  getEl<HTMLElement>(id).textContent = text;
}

function setBadge(id: string, text: string, tone: "success" | "warning" | "danger") {
  const node = getEl<HTMLElement>(id);
  node.dataset.tone = tone;
  node.textContent = text;
}

function getEl<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Element #${id} was not found.`);
  }
  return element as T;
}

function getInputValue(id: string): string {
  return getEl<HTMLInputElement>(id).value.trim();
}

function requireWallet(): string {
  if (!state.walletAddress) {
    throw new Error("Сначала подключите кошелёк.");
  }
  return state.walletAddress;
}

function assertConfigured() {
  if (!state.config.contractAddress) {
    throw new Error("Укажите адрес деплойера контрактов в конфигурации приложения.");
  }
}

function parseAmountInput(raw: string): bigint {
  const normalized = raw.replace(",", ".").trim();
  if (!normalized) {
    throw new Error("Введите числовое значение.");
  }
  if (!/^\d+(\.\d{0,6})?$/.test(normalized)) {
    throw new Error("Допускаются только положительные числа с точностью до 6 знаков после точки.");
  }

  const [whole, fraction = ""] = normalized.split(".");
  const wholePart = BigInt(whole || "0");
  const fractionPart = BigInt((fraction + "000000").slice(0, 6));
  return wholePart * MICRO_UNITS + fractionPart;
}

function safeParseInput(id: string): bigint {
  try {
    const value = getInputValue(id);
    if (!value) return 0n;
    return parseAmountInput(value);
  } catch {
    return 0n;
  }
}

function formatAmount(value: bigint, decimals = 6): string {
  const negative = value < 0n;
  const absolute = negative ? value * -1n : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = absolute % base;
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole.toString()}${fractionText ? `.${fractionText}` : ""}`;
}

function shortAddress(address: string): string {
  if (address.length < 14) return address;
  return `${address.slice(0, 6)}…${address.slice(-6)}`;
}

function defaultApiUrl(network: Network): string {
  return network === "mainnet" ? "https://api.hiro.so" : "https://api.testnet.hiro.so";
}

function contractId(address: string, name: string): string {
  return `${address}.${name}`;
}

function txExplorerUrl(txid: string): string {
  return `https://explorer.hiro.so/txid/${txid}?chain=${state.config.network}`;
}

function quoteOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
  if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;
  return (amountIn * reserveOut) / (reserveIn + amountIn);
}

function ensureBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  throw new Error("Ожидалось uint/int значение из Clarity.");
}

function clarityToJs(value: ClarityValue): unknown {
  switch (value.type) {
    case ClarityType.BoolTrue:
      return true;
    case ClarityType.BoolFalse:
      return false;
    case ClarityType.UInt:
    case ClarityType.Int:
      return value.value;
    case ClarityType.StringASCII:
    case ClarityType.StringUTF8:
    case ClarityType.PrincipalStandard:
    case ClarityType.PrincipalContract:
      return value.value;
    case ClarityType.OptionalNone:
      return null;
    case ClarityType.OptionalSome:
      return clarityToJs(value.value);
    case ClarityType.Buffer:
      return `0x${value.value}`;
    case ClarityType.List:
      return value.value.map(item => clarityToJs(item));
    case ClarityType.Tuple:
      return Object.fromEntries(
        Object.entries(value.value).map(([key, entry]) => [key, clarityToJs(entry)])
      );
    case ClarityType.ResponseOk:
      return { success: true, value: clarityToJs(value.value) };
    case ClarityType.ResponseErr:
      return { success: false, value: clarityToJs(value.value) };
    default:
      return value;
  }
}

function readError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Произошла неизвестная ошибка.";
}

function extractAddressFromPayload(payload: unknown): string | null {
  return findStacksAddress(payload);
}

function findStacksAddress(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return /^S[PTMN][A-Z0-9]{38,41}$/.test(normalized) ? normalized : null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStacksAddress(item);
      if (found) return found;
    }
    return null;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Record<string, unknown>;

  const priorityKeys = [
    "address",
    "stxAddress",
    "stacksAddress",
    "testnet",
    "mainnet",
    "addresses",
    "accounts",
    "result",
  ];

  for (const key of priorityKeys) {
    if (key in record) {
      const found = findStacksAddress(record[key]);
      if (found) return found;
    }
  }

  for (const nestedValue of Object.values(record)) {
    const found = findStacksAddress(nestedValue);
    if (found) return found;
  }

  return null;
}
