(function initializeStonerEnhancements(globalScope) {
  "use strict";

  const catalog =
    globalScope.StonerHuntCatalog ??
    (typeof require === "function"
      ? require("./stoner-hunt-catalog.js")
      : null);
  const PANEL_SELECTOR = "#stonegy-auto-hunt";
  const GLOOTH_BAG_ITEM_ID = 824;
  const GLOOTH_BAG_NAME = "Glooth Bag";
  const POSITION_COLUMNS = Object.freeze([-4, -3, -2, -1, 0, 1, 2, 3, 4]);
  const SELECTABLE_POSITION_X = Object.freeze([-4, -3, -2, 2, 3, 4]);
  const POSITION_UI_CLASSES = Object.freeze({
    toggle: "stoner-position-toggle",
    label: "stoner-position-toggle-label",
    status: "stoner-position-status",
    grid: "stoner-position-grid stoner-static-position-grid",
    choice: "stoner-position-choice",
    selected: "stoner-position-selected",
    blocked: "stoner-position-blocked",
  });
  const POSITION_UI_SELECTORS = Object.freeze({
    toggle: ".stoner-position-toggle",
    label: ".stoner-position-toggle-label",
    status: ".stoner-position-status",
    grid: ".stoner-position-grid",
  });

  function sanitizeCreatureLimits(source) {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(source).flatMap(([huntId, limit]) => {
        const hunt = catalog?.getById(huntId);
        const resolved = catalog?.resolveCreatureLimit(hunt, limit);
        return hunt && Number.isInteger(resolved)
          ? [[String(hunt.id), resolved]]
          : [];
      }),
    );
  }

  function huntPatch(config, huntOrId, requestedLimit) {
    const hunt =
      typeof huntOrId === "object"
        ? huntOrId
        : catalog?.getById(huntOrId);
    if (!hunt) return null;
    const limits = sanitizeCreatureLimits(config?.huntCreatureLimits);
    const configuredForThisHunt =
      Number(config?.huntId) === hunt.id ||
      catalog?.findByTitle(config?.huntName)?.id === hunt.id;
    const limit = catalog.resolveCreatureLimit(
      hunt,
      requestedLimit ??
        limits[String(hunt.id)] ??
        (configuredForThisHunt ? config?.lure : null),
    );
    if (Number.isInteger(limit)) limits[String(hunt.id)] = limit;
    const recentHunts = [
      hunt.title,
      ...(Array.isArray(config?.recentHunts) ? config.recentHunts : []),
    ]
      .map((name) => String(name || "").trim())
      .filter(
        (name, index, names) =>
          name && names.findIndex((candidate) => candidate === name) === index,
      )
      .slice(0, 12);
    return {
      huntId: hunt.id,
      huntName: hunt.title,
      huntCreatureLimits: limits,
      lure: limit,
      recentHunts,
    };
  }

  function positionGridDescriptors() {
    return [-1, 0, 1].flatMap((y) =>
      POSITION_COLUMNS.map((x) => ({
        x,
        y,
        coordinate: `${x},${y}`,
        selectable: SELECTABLE_POSITION_X.includes(x),
      })),
    );
  }

  function isConfiguredPosition(position) {
    return Boolean(
      position &&
        Number.isInteger(Number(position.x)) &&
        Number.isInteger(Number(position.y)) &&
        SELECTABLE_POSITION_X.includes(Number(position.x)) &&
        [-1, 0, 1].includes(Number(position.y)),
    );
  }

  const testApi = {
    GLOOTH_BAG_ITEM_ID,
    POSITION_UI_CLASSES,
    POSITION_UI_SELECTORS,
    huntPatch,
    isConfiguredPosition,
    positionGridDescriptors,
    sanitizeCreatureLimits,
  };
  if (typeof module !== "undefined") module.exports = testApi;
  if (
    !catalog ||
    typeof document === "undefined" ||
    typeof window === "undefined"
  ) {
    return;
  }

  let activeRoot = null;
  let lastPanelSignature = "";
  let openingGloothBags = false;
  let huntPresent = false;
  let huntEnteredAt = 0;
  let gloothStatus = "desativado";
  let lastGloothError = "";
  let lastGloothErrorAt = 0;
  let lastStartHuntAssistAt = 0;
  let initialHuntStartActive = false;
  let initialHuntStartAt = 0;
  let lastHuntCardAssistAt = 0;
  let initialHuntWarningSent = false;

  function bridge() {
    return globalScope.__STONER_LOCAL_API__ ?? null;
  }

  function currentConfig() {
    try {
      return bridge()?.getConfig?.() ?? {};
    } catch {
      return {};
    }
  }

  function updateConfig(patch, notification = "") {
    const api = bridge();
    if (!api?.updateConfig) return currentConfig();
    const updated = api.updateConfig(patch);
    if (notification) api.notify?.(notification);
    window.setTimeout(() => syncPanel(true), 0);
    return updated;
  }

  function isVisible(element) {
    if (!element || typeof element.getClientRects !== "function") return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0
    );
  }

  function normalizedText(element) {
    return String(element?.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function installStyles() {
    if (document.getElementById("stoner-local-enhancements-style")) return;
    const style = document.createElement("style");
    style.id = "stoner-local-enhancements-style";
    style.textContent = `
      #stonegy-auto-hunt .stoner-hunt-dd {
        min-width: 100%;
        max-width: 100%;
        max-height: 290px;
        overflow: hidden;
      }
      #stonegy-auto-hunt .stoner-hunt-search {
        position: sticky;
        top: 0;
        z-index: 1;
        margin: 0;
        border: 0;
        border-bottom: 1px solid #3c3c41;
        border-radius: 0;
        padding: 7px 8px;
      }
      #stonegy-auto-hunt .stoner-hunt-list {
        max-height: 248px;
        overflow-y: auto;
      }
      #stonegy-auto-hunt .stoner-hunt-option[data-selected="true"] {
        color: #5fbf7f;
        background: #202a24;
      }
      #stonegy-auto-hunt .stoner-creature-field {
        margin-top: 7px;
        padding: 7px;
        border: 1px solid #34363b;
        border-radius: 4px;
        background: #101216;
      }
      #stonegy-auto-hunt .stoner-creature-field label {
        margin: 0 0 4px;
        color: #b3ab93;
        font-size: 11px;
      }
      #stonegy-auto-hunt .stoner-hunt-details {
        display: block;
        margin-top: 4px;
        color: #777160;
        font-size: 9px;
        line-height: 1.35;
      }
      #stonegy-auto-hunt .stoner-glooth-row {
        flex-wrap: wrap;
      }
      #stonegy-auto-hunt .stoner-glooth-status {
        width: 100%;
        margin-left: 20px;
        color: #777160;
        font-size: 9px;
      }
      #stonegy-auto-hunt .stoner-native-position-control,
      #stonegy-auto-hunt .sah-pos-toggle,
      #stonegy-auto-hunt .sah-pos-status,
      #stonegy-auto-hunt .sah-pos-grid {
        display: none !important;
      }
      #stonegy-auto-hunt .stoner-position-toggle {
        display: flex;
        width: 100%;
        height: 32px;
        min-height: 32px;
        max-height: 32px;
        align-items: center;
        justify-content: center;
        gap: 7px;
        border: 1px solid #9b7610;
        border-radius: 3px;
        padding: 4px 8px;
        overflow: hidden;
        background: #1b1d20;
        color: #d5c9a8;
        font: inherit;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        cursor: pointer;
      }
      #stonegy-auto-hunt .stoner-position-toggle svg {
        display: block;
        width: 16px !important;
        min-width: 16px;
        height: 16px !important;
        max-height: 16px;
        flex: 0 0 16px;
      }
      #stonegy-auto-hunt .stoner-position-toggle-label {
        line-height: 1;
        white-space: nowrap;
      }
      #stonegy-auto-hunt .stoner-position-toggle:hover {
        border-color: #c89b3c;
        background: #24262a;
      }
      #stonegy-auto-hunt .stoner-position-status {
        margin: 6px 4px 8px;
        color: #777160;
        font-size: 9px;
        line-height: 1.35;
        text-align: center;
      }
      #stonegy-auto-hunt .stoner-position-grid {
        display: grid;
        grid-template-columns: repeat(9, minmax(16px, 1fr));
        gap: 3px;
      }
      #stonegy-auto-hunt .stoner-position-pin {
        color: #e0952e;
        font-size: 12px;
        line-height: 1;
      }
      #stonegy-auto-hunt .stoner-position-choice {
        position: relative;
        width: 100%;
        min-width: 0;
        margin: 0;
        padding: 0;
        aspect-ratio: 1 / 1;
        border: 1px solid #9b8400;
        border-radius: 3px;
        background: #262300;
        color: #d8bf17;
        font-size: 8px;
        font-weight: normal;
        cursor: pointer;
      }
      #stonegy-auto-hunt .stoner-position-choice:hover {
        border-color: #d5b900;
        background: #353000;
      }
      #stonegy-auto-hunt .stoner-position-choice.stoner-position-selected {
        color: #4fd6c4;
        border-color: #4fd6c4;
        background: #174743;
        box-shadow: 0 0 7px rgba(79, 214, 196, .65);
      }
      #stonegy-auto-hunt .stoner-position-blocked {
        display: flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 1 / 1;
        border-radius: 3px;
        background: rgba(70, 70, 70, .22);
        border: 1px solid rgba(95, 95, 95, .25);
        color: #4fd6c4;
        font-size: 8px;
      }

      /* AltGrid native theme. Kept at the end so it safely overrides the
         extension palette without changing any bot behavior or selectors. */
      #stonegy-auto-hunt {
        --ag-stoner-bg: #0d1117;
        --ag-stoner-surface: #151a22;
        --ag-stoner-raised: #1a202a;
        --ag-stoner-hover: #202733;
        --ag-stoner-border: #2a3340;
        --ag-stoner-green: #23c95b;
        --ag-stoner-green-hover: #2cdc67;
        --ag-stoner-green-soft: rgba(35, 201, 91, .12);
        --ag-stoner-text: #f3f5f7;
        --ag-stoner-secondary: #bac2cf;
        --ag-stoner-muted: #909aaa;
        box-sizing: border-box !important;
        max-width: min(440px, calc(100vw - 24px)) !important;
        max-height: calc(100vh - 24px) !important;
        overflow: hidden !important;
        border: 1px solid rgba(35, 201, 91, .35) !important;
        border-radius: 14px !important;
        background:
          radial-gradient(circle at 75% 0%, rgba(35, 201, 91, .1), transparent 34%),
          linear-gradient(150deg, #111820, var(--ag-stoner-bg) 58%) !important;
        box-shadow: 0 24px 70px rgba(0, 0, 0, .55), 0 0 28px rgba(35, 201, 91, .08) !important;
        color: var(--ag-stoner-text) !important;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        font-synthesis: none;
      }
      #stonegy-auto-hunt,
      #stonegy-auto-hunt * {
        box-sizing: border-box;
        scrollbar-color: rgba(35, 201, 91, .42) transparent;
        scrollbar-width: thin;
      }
      #stonegy-auto-hunt *::-webkit-scrollbar {
        width: 7px;
        height: 7px;
      }
      #stonegy-auto-hunt *::-webkit-scrollbar-thumb {
        border: 2px solid transparent;
        border-radius: 999px;
        background: rgba(35, 201, 91, .42);
        background-clip: padding-box;
      }
      #stonegy-auto-hunt .sah-head {
        min-height: 52px !important;
        border-bottom: 1px solid var(--ag-stoner-border) !important;
        background: rgba(13, 17, 23, .94) !important;
        color: var(--ag-stoner-text) !important;
        backdrop-filter: blur(14px);
      }
      #stonegy-auto-hunt .sah-head-logo {
        border-radius: 8px !important;
        filter: drop-shadow(0 0 9px rgba(35, 201, 91, .28));
      }
      #stonegy-auto-hunt .sah-head-title {
        color: var(--ag-stoner-text) !important;
        font-size: 14px !important;
        font-weight: 800 !important;
        letter-spacing: -.02em !important;
      }
      #stonegy-auto-hunt .sah-head-title::after {
        display: inline-flex;
        margin-left: 7px;
        border: 1px solid rgba(35, 201, 91, .3);
        border-radius: 999px;
        padding: 2px 6px;
        content: "STONEGY";
        background: var(--ag-stoner-green-soft);
        color: var(--ag-stoner-green-hover);
        font-size: 8px;
        font-weight: 900;
        letter-spacing: .08em;
        vertical-align: middle;
      }
      #stonegy-auto-hunt .sah-body {
        max-height: calc(100vh - 78px) !important;
        overflow-x: hidden !important;
        overflow-y: auto !important;
        background: transparent !important;
        color: var(--ag-stoner-secondary) !important;
      }
      #stonegy-auto-hunt .sah-tabs {
        gap: 4px !important;
        border-bottom: 1px solid var(--ag-stoner-border) !important;
        padding: 6px !important;
        background: rgba(21, 26, 34, .82) !important;
      }
      #stonegy-auto-hunt .sah-tab-btn,
      #stonegy-auto-hunt .sah-sidebar-btn {
        border: 1px solid transparent !important;
        border-radius: 8px !important;
        background: transparent !important;
        color: var(--ag-stoner-muted) !important;
        font-weight: 700 !important;
        transition: background .16s ease, border-color .16s ease, color .16s ease !important;
      }
      #stonegy-auto-hunt .sah-tab-btn:hover,
      #stonegy-auto-hunt .sah-sidebar-btn:hover {
        border-color: var(--ag-stoner-border) !important;
        background: var(--ag-stoner-hover) !important;
        color: var(--ag-stoner-text) !important;
      }
      #stonegy-auto-hunt .sah-tab-btn.active,
      #stonegy-auto-hunt .sah-tab-btn[aria-selected="true"],
      #stonegy-auto-hunt .sah-sidebar-btn.active {
        border-color: rgba(35, 201, 91, .3) !important;
        background: var(--ag-stoner-green-soft) !important;
        color: var(--ag-stoner-green-hover) !important;
      }
      #stonegy-auto-hunt .sah-tab-content,
      #stonegy-auto-hunt .sah-prof-card,
      #stonegy-auto-hunt .sah-lure-box,
      #stonegy-auto-hunt .sah-timer-panel,
      #stonegy-auto-hunt .sah-protect-section,
      #stonegy-auto-hunt .sah-log,
      #stonegy-auto-hunt .sah-chat-convs,
      #stonegy-auto-hunt .sah-pm {
        border-color: var(--ag-stoner-border) !important;
        background: rgba(21, 26, 34, .92) !important;
        color: var(--ag-stoner-secondary) !important;
      }
      #stonegy-auto-hunt .sah-section-title,
      #stonegy-auto-hunt .sah-timer-title,
      #stonegy-auto-hunt .sah-protect-title,
      #stonegy-auto-hunt .sah-prof-name,
      #stonegy-auto-hunt label {
        color: var(--ag-stoner-text) !important;
      }
      #stonegy-auto-hunt .sah-sub,
      #stonegy-auto-hunt .sah-status,
      #stonegy-auto-hunt .sah-timer-hint,
      #stonegy-auto-hunt .sah-chat-hint,
      #stonegy-auto-hunt .sah-autolist-hint,
      #stonegy-auto-hunt .sah-autosave-hint,
      #stonegy-auto-hunt .sah-return-hint,
      #stonegy-auto-hunt .sah-reqfull-hint,
      #stonegy-auto-hunt .stoner-hunt-details,
      #stonegy-auto-hunt .stoner-glooth-status {
        color: var(--ag-stoner-muted) !important;
      }
      #stonegy-auto-hunt input,
      #stonegy-auto-hunt select,
      #stonegy-auto-hunt textarea,
      #stonegy-auto-hunt .stoner-hunt-dd,
      #stonegy-auto-hunt .sah-prof-dd {
        border: 1px solid var(--ag-stoner-border) !important;
        border-radius: 8px !important;
        outline: none !important;
        background: #0f141b !important;
        color: var(--ag-stoner-text) !important;
        font: inherit !important;
      }
      #stonegy-auto-hunt input:focus,
      #stonegy-auto-hunt select:focus,
      #stonegy-auto-hunt textarea:focus {
        border-color: var(--ag-stoner-green) !important;
        box-shadow: 0 0 0 3px rgba(35, 201, 91, .12) !important;
      }
      #stonegy-auto-hunt button,
      #stonegy-auto-hunt .sah-timer-btn,
      #stonegy-auto-hunt .stoner-position-toggle {
        border-color: var(--ag-stoner-border) !important;
        border-radius: 8px !important;
        background: var(--ag-stoner-raised) !important;
        color: var(--ag-stoner-secondary) !important;
        font-family: inherit !important;
      }
      #stonegy-auto-hunt button:hover,
      #stonegy-auto-hunt .sah-timer-btn:hover,
      #stonegy-auto-hunt .stoner-position-toggle:hover {
        border-color: rgba(35, 201, 91, .48) !important;
        background: var(--ag-stoner-hover) !important;
        color: var(--ag-stoner-text) !important;
      }
      #stonegy-auto-hunt .sah-save,
      #stonegy-auto-hunt .sah-timer-apply,
      #stonegy-auto-hunt .sah-loot-test,
      #stonegy-auto-hunt .sah-chat-save,
      #stonegy-auto-hunt .sah-running,
      #stonegy-auto-hunt .sah-lock-on {
        border-color: var(--ag-stoner-green) !important;
        background: linear-gradient(135deg, var(--ag-stoner-green-hover), var(--ag-stoner-green)) !important;
        color: #07110b !important;
        font-weight: 800 !important;
        box-shadow: 0 8px 20px rgba(35, 201, 91, .18) !important;
      }
      #stonegy-auto-hunt .sah-switch-slider {
        border-color: var(--ag-stoner-border) !important;
        background: #28313d !important;
      }
      #stonegy-auto-hunt input:checked + .sah-switch-slider,
      #stonegy-auto-hunt .sah-toggle:checked + .sah-switch-slider {
        border-color: var(--ag-stoner-green) !important;
        background: var(--ag-stoner-green) !important;
      }
      #stonegy-auto-hunt .sah-prof-del,
      #stonegy-auto-hunt .sah-protect-x,
      #stonegy-auto-hunt .sah-prot-x,
      #stonegy-auto-hunt .sah-pos-clear,
      #stonegy-auto-hunt .sah-lure-clear {
        color: #f06a74 !important;
      }
      #stonegy-auto-hunt .stoner-hunt-option[data-selected="true"],
      #stonegy-auto-hunt .stoner-position-choice.stoner-position-selected,
      #stonegy-auto-hunt .sah-chat-conv-item.active {
        border-color: rgba(35, 201, 91, .45) !important;
        background: var(--ag-stoner-green-soft) !important;
        color: var(--ag-stoner-green-hover) !important;
        box-shadow: 0 0 10px rgba(35, 201, 91, .12) !important;
      }
      #stonegy-auto-hunt-fab {
        border: 1px solid rgba(35, 201, 91, .55) !important;
        border-radius: 14px !important;
        background: linear-gradient(145deg, #1a202a, #10161d) !important;
        color: #f3f5f7 !important;
        box-shadow: 0 14px 36px rgba(0, 0, 0, .46), 0 0 22px rgba(35, 201, 91, .2) !important;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      #stonegy-auto-hunt-fab:hover {
        border-color: var(--ag-stoner-green-hover, #2cdc67) !important;
        transform: translateY(-1px);
        box-shadow: 0 16px 40px rgba(0, 0, 0, .5), 0 0 28px rgba(35, 201, 91, .3) !important;
      }
      .sah-notify-body {
        border: 1px solid rgba(35, 201, 91, .35) !important;
        border-radius: 12px !important;
        background: #151a22 !important;
        color: #bac2cf !important;
        box-shadow: 0 18px 45px rgba(0, 0, 0, .48) !important;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
      }
      .sah-notify-title {
        color: #f3f5f7 !important;
      }
    `;
    document.documentElement.append(style);
  }

  function selectedHunt(config = currentConfig()) {
    return (
      catalog.getById(config.huntId) ??
      catalog.findByTitle(config.huntName) ??
      null
    );
  }

  function chooseHunt(hunt, requestedLimit) {
    const patch = huntPatch(currentConfig(), hunt, requestedLimit);
    if (!patch) return;
    updateConfig(
      patch,
      `Hunt "${hunt.title}" configurada com até ${patch.lure} criaturas.`,
    );
    closeHuntDropdown();
  }

  function closeHuntDropdown() {
    activeRoot
      ?.querySelector(".sah-hunt-dd")
      ?.classList.remove("open");
  }

  function renderHuntDropdown(filterText = "") {
    if (!activeRoot) return;
    const dropdown = activeRoot.querySelector(".sah-hunt-dd");
    if (!dropdown) return;
    const current = selectedHunt();
    const expected = String(filterText || "")
      .trim()
      .toLocaleLowerCase("pt-BR");
    const hunts = [...catalog.HUNTS]
      .filter((hunt) => {
        if (!expected) return true;
        const haystack =
          `${hunt.title} ${hunt.id} ${hunt.levelMin ?? ""} ${hunt.recommendedLevel}`.toLocaleLowerCase(
            "pt-BR",
          );
        return haystack.includes(expected);
      })
      .sort(
        (left, right) =>
          (left.levelMin ?? left.recommendedLevel) -
            (right.levelMin ?? right.recommendedLevel) ||
          left.recommendedLevel - right.recommendedLevel ||
          left.id - right.id,
      );

    dropdown.replaceChildren();
    dropdown.classList.add("stoner-hunt-dd");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "stoner-hunt-search";
    search.placeholder = "Buscar hunt, nível ou ID";
    search.value = filterText;
    search.addEventListener("click", (event) => event.stopPropagation());
    search.addEventListener("input", () => {
      renderHuntDropdown(search.value);
      const nextSearch = dropdown.querySelector(".stoner-hunt-search");
      nextSearch?.focus();
      nextSearch?.setSelectionRange(
        nextSearch.value.length,
        nextSearch.value.length,
      );
    });
    dropdown.append(search);

    const list = document.createElement("div");
    list.className = "stoner-hunt-list";
    if (hunts.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sah-hunt-dd-empty";
      empty.textContent = "Nenhuma hunt encontrada";
      list.append(empty);
    }
    hunts.forEach((hunt) => {
      const duplicateTitle =
        catalog.HUNTS.filter(
          (candidate) => candidate.title === hunt.title,
        ).length > 1;
      const option = document.createElement("div");
      option.className = "sah-hunt-dd-item stoner-hunt-option";
      option.dataset.selected = String(current?.id === hunt.id);
      option.title = `${hunt.title} · recomendado ${hunt.recommendedLevel}`;
      option.textContent = `${hunt.title}${duplicateTitle ? ` (ID ${hunt.id})` : ""} · lvl ${
        hunt.levelMin ?? "—"
      }`;
      option.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        chooseHunt(hunt);
      });
      list.append(option);
    });
    dropdown.append(list);
  }

  function renderCreatureField(config = currentConfig()) {
    if (!activeRoot) return;
    const field = activeRoot.querySelector(".stoner-creature-field");
    const select = activeRoot.querySelector(".stoner-creature-select");
    const details = activeRoot.querySelector(".stoner-hunt-details");
    if (!field || !select || !details) return;
    const hunt = selectedHunt(config);
    field.style.display = hunt ? "" : "none";
    if (!hunt) return;
    const options = catalog.creatureOptions(hunt);
    const limits = sanitizeCreatureLimits(config.huntCreatureLimits);
    const selected = catalog.resolveCreatureLimit(
      hunt,
      limits[String(hunt.id)] ?? config.lure,
    );
    select.replaceChildren();
    options.forEach((maximum) => {
      const option = document.createElement("option");
      option.value = String(maximum);
      option.textContent = `${maximum} ${
        maximum === 1 ? "criatura" : "criaturas"
      }`;
      select.append(option);
    });
    select.value = String(selected ?? "");
    select.disabled = options.length <= 1;
    const access = hunt.premium ? "Premium" : "não-Premium";
    const unlock = hunt.unlockedByDefault ? "" : " · requer desbloqueio";
    const fixed = options.length <= 1 ? " · quantidade fixa" : "";
    details.textContent = `Nível mín. ${hunt.levelMin ?? "—"} · rec. ${
      hunt.recommendedLevel
    } · ${access}${unlock}${fixed}`;
  }

  function installHuntControls(root) {
    const field = root.querySelector(".sah-field-hunt");
    const input = root.querySelector(".sah-hunt");
    const trigger = root.querySelector(".sah-hunt-recent");
    if (!field || !input || !trigger) return;

    trigger.title = "Abrir lista completa de hunts";
    if (!trigger.dataset.stonerCatalogBound) {
      trigger.dataset.stonerCatalogBound = "true";
      trigger.addEventListener(
        "click",
        (event) => {
          event.preventDefault();
          event.stopImmediatePropagation();
          const dropdown = root.querySelector(".sah-hunt-dd");
          const willOpen = !dropdown?.classList.contains("open");
          if (!willOpen) {
            closeHuntDropdown();
            return;
          }
          renderHuntDropdown();
          dropdown?.classList.add("open");
          window.setTimeout(
            () => dropdown?.querySelector(".stoner-hunt-search")?.focus(),
            0,
          );
        },
        true,
      );
    }

    if (!input.dataset.stonerCatalogBound) {
      input.dataset.stonerCatalogBound = "true";
      const acceptTypedHunt = () => {
        const hunt = catalog.findByTitle(input.value);
        if (hunt && selectedHunt()?.id !== hunt.id) chooseHunt(hunt);
      };
      input.addEventListener("change", acceptTypedHunt);
      input.addEventListener("blur", acceptTypedHunt);
    }

    if (!field.querySelector(".stoner-creature-field")) {
      const creatureField = document.createElement("div");
      creatureField.className = "stoner-creature-field";
      const label = document.createElement("label");
      label.textContent = "Máximo de criaturas nesta hunt";
      const select = document.createElement("select");
      select.className = "stoner-creature-select";
      select.addEventListener("change", () => {
        const hunt = selectedHunt();
        if (hunt) chooseHunt(hunt, Number(select.value));
      });
      const details = document.createElement("small");
      details.className = "stoner-hunt-details";
      creatureField.append(label, select, details);
      field.append(creatureField);
    }
  }

  function installGloothControl(root) {
    if (root.querySelector(".stoner-glooth-row")) return;
    const row = document.createElement("div");
    row.className = "sah-checkline stoner-glooth-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "stoner-auto-glooth";
    checkbox.id = "stoner-auto-glooth";
    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = "Abrir Glooth Bags automaticamente";
    const status = document.createElement("span");
    status.className = "stoner-glooth-status";
    checkbox.addEventListener("change", () => {
      gloothStatus = checkbox.checked ? "aguardando item" : "desativado";
      updateConfig(
        { autoOpenGloothBags: checkbox.checked },
        `Abertura automática de Glooth Bags ${
          checkbox.checked ? "ativada" : "desativada"
        }.`,
      );
    });
    row.append(checkbox, label, status);
    const insertionPoint =
      root.querySelector(".sah-autotrade")?.closest(".sah-checkline") ??
      root.querySelector(".sah-autosell")?.closest(".sah-checkline");
    if (insertionPoint) insertionPoint.after(row);
    else root.querySelector(".sah-tab-content.active")?.prepend(row);
  }

  function renderPositionGrid(config = currentConfig()) {
    if (!activeRoot) return;
    const grid = activeRoot.querySelector(POSITION_UI_SELECTORS.grid);
    const status = activeRoot.querySelector(POSITION_UI_SELECTORS.status);
    const toggleLabel = activeRoot.querySelector(POSITION_UI_SELECTORS.label);
    if (!grid || !status) return;
    const expanded = activeRoot.dataset.stonerPositionExpanded !== "false";
    grid.className = POSITION_UI_CLASSES.grid;
    grid.style.display = expanded ? "grid" : "none";
    grid.replaceChildren();
    const savedPosition = isConfiguredPosition(config.position)
      ? { x: Number(config.position.x), y: Number(config.position.y) }
      : null;

    positionGridDescriptors().forEach((position) => {
      if (!position.selectable) {
        const blocked = document.createElement("span");
        blocked.className = POSITION_UI_CLASSES.blocked;
        const isCenter = position.x === 0 && position.y === 0;
        blocked.textContent = isCenter ? "●" : "";
        blocked.title = isCenter ? "Sua posição atual" : "SQM indisponível";
        grid.append(blocked);
        return;
      }
      const button = document.createElement("button");
      const selected =
        savedPosition?.x === position.x && savedPosition?.y === position.y;
      button.type = "button";
      button.className = POSITION_UI_CLASSES.choice;
      if (selected) button.classList.add(POSITION_UI_CLASSES.selected);
      button.textContent = selected ? "★" : "·";
      button.title = `Posição ${position.coordinate}`;
      button.setAttribute(
        "aria-label",
        `Salvar preferência de posição ${position.coordinate}`,
      );
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        updateConfig(
          { position: { x: position.x, y: position.y } },
          `Posição (${position.x}, ${position.y}) salva — será aplicada ao iniciar a hunt.`,
        );
      });
      grid.append(button);
    });

    status.textContent = savedPosition
      ? `Selecionada (${savedPosition.x}, ${savedPosition.y}). Você pode alterar mesmo fora da hunt.`
      : "Selecione agora um dos 18 SQMs; a posição será aplicada quando a hunt iniciar.";
    if (toggleLabel) {
      toggleLabel.textContent = expanded
        ? "Ocultar posições"
        : "Escolher posição";
    }
  }

  function installPositionControls(root) {
    const section = root.querySelector(".sah-pos-section");
    if (!section) return;

    const nativeToggle = section.querySelector(".sah-pos-toggle");
    const nativeStatus = section.querySelector(".sah-pos-status");
    const nativeGrid = section.querySelector(".sah-pos-grid");
    [nativeToggle, nativeStatus, nativeGrid].forEach((element) =>
      element?.classList.add("stoner-native-position-control"),
    );

    let toggle = section.querySelector(POSITION_UI_SELECTORS.toggle);
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = POSITION_UI_CLASSES.toggle;

      const nativeIcon = nativeToggle?.querySelector("svg");
      if (nativeIcon) {
        toggle.append(nativeIcon.cloneNode(true));
      } else {
        const pin = document.createElement("span");
        pin.className = "stoner-position-pin";
        pin.textContent = "●";
        toggle.append(pin);
      }

      const label = document.createElement("span");
      label.className = POSITION_UI_CLASSES.label;
      toggle.append(label);

      const status = document.createElement("div");
      status.className = POSITION_UI_CLASSES.status;

      const grid = document.createElement("div");
      grid.className = POSITION_UI_CLASSES.grid;

      section.append(toggle, status, grid);
    }
    if (toggle.dataset.stonerStaticBound) return;
    toggle.dataset.stonerStaticBound = "true";
    if (!root.dataset.stonerPositionExpanded) {
      root.dataset.stonerPositionExpanded = "true";
    }
    toggle.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopPropagation();
        root.dataset.stonerPositionExpanded = String(
          root.dataset.stonerPositionExpanded === "false",
        );
        renderPositionGrid();
      },
    );
  }

  function renderGloothControl(config = currentConfig()) {
    if (!activeRoot) return;
    const checkbox = activeRoot.querySelector(".stoner-auto-glooth");
    const status = activeRoot.querySelector(".stoner-glooth-status");
    if (checkbox) checkbox.checked = config.autoOpenGloothBags === true;
    if (status) {
      status.textContent =
        config.autoOpenGloothBags === true ? gloothStatus : "desativado";
    }
  }

  function panelSignature(config) {
    return JSON.stringify({
      huntId: config.huntId ?? null,
      huntName: config.huntName ?? "",
      huntCreatureLimits: config.huntCreatureLimits ?? {},
      lure: config.lure ?? null,
      position: config.position ?? null,
      autoOpenGloothBags: config.autoOpenGloothBags === true,
    });
  }

  function applyAltGridBrand(scope) {
    if (!scope) return;
    const brandImages = [
      ...(scope.matches?.("#stonegy-auto-hunt-fab")
        ? [scope.querySelector("img")]
        : []),
      ...(scope.querySelectorAll?.(".sah-head-logo, .sah-sidebar-btn img") ?? []),
    ].filter(Boolean);
    brandImages.forEach((image) => {
      if (globalScope.__ALTGRID_BOT_LOGO__) {
        image.src = globalScope.__ALTGRID_BOT_LOGO__;
      }
      image.alt = "AltGrid Bot";
    });

    const elements = [scope, ...(scope.querySelectorAll?.("[title], [aria-label], img[alt]") ?? [])];
    elements.forEach((element) => {
      ["title", "aria-label", "alt"].forEach((attribute) => {
        const value = element.getAttribute?.(attribute);
        if (value && /stoner/i.test(value)) {
          element.setAttribute(attribute, value.replace(/stoner/gi, "AltGrid Bot"));
        }
      });
    });

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (/stoner/i.test(node.nodeValue ?? "")) {
        node.nodeValue = node.nodeValue.replace(/stoner/gi, "AltGrid Bot");
      }
      node = walker.nextNode();
    }
  }

  function syncPanel(force = false) {
    applyAltGridBrand(document.querySelector("#stonegy-auto-hunt-fab"));
    document
      .querySelectorAll("#stonegy-auto-hunt-notify, [id^='stonegy-auto-hunt-notify']")
      .forEach(applyAltGridBrand);
    const root = document.querySelector(PANEL_SELECTOR);
    if (!root) {
      activeRoot = null;
      lastPanelSignature = "";
      return;
    }
    if (root !== activeRoot) {
      activeRoot = root;
      lastPanelSignature = "";
      installStyles();
      installHuntControls(root);
      installGloothControl(root);
      installEmptyQuickSellGuard(root);
      force = true;
    }
    applyAltGridBrand(root);
    installPositionControls(root);
    const config = currentConfig();
    const signature = panelSignature(config);
    const staticGridPresent = Boolean(
      root.querySelector(".stoner-position-choice"),
    );
    if (!force && signature === lastPanelSignature && staticGridPresent) {
      renderGloothControl(config);
      return;
    }
    lastPanelSignature = signature;
    renderCreatureField(config);
    renderPositionGrid(config);
    renderGloothControl(config);
  }

  function inventoryItemById(itemId) {
    const guide = `inventory-item-${Number(itemId)}`;
    return (
      [...document.querySelectorAll("[data-guide^='inventory-item-']")].find(
        (element) =>
          element.getAttribute("data-guide") === guide &&
          isVisible(element) &&
          !element.closest("[data-guide='quick-sell-modal']"),
      ) ?? null
    );
  }

  function inventoryItemAmount(item) {
    const slot = item?.matches?.(".stonegy-item-holder-slot")
      ? item
      : item?.querySelector?.(".stonegy-item-holder-slot");
    const amount = Number.parseInt(
      String(
        slot?.querySelector?.(".stonegy-item-holder-amount")?.textContent ??
          "1",
      ).replace(/[^\d]/g, ""),
      10,
    );
    return Number.isInteger(amount) && amount > 0 ? amount : 1;
  }

  function inventoryContextTarget(item, targetMode) {
    if (targetMode === "container") return item.parentElement ?? item;
    if (targetMode === "wrapper") return item;
    return item.querySelector?.(".stonegy-item-holder-slot") ?? item;
  }

  function openInventoryContextMenu(item, targetMode) {
    const target = inventoryContextTarget(item, targetMode);
    const rect = target.getBoundingClientRect?.();
    target.dispatchEvent(
      new window.MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 2,
        buttons: 2,
        clientX: rect ? rect.left + rect.width / 2 : 0,
        clientY: rect ? rect.top + rect.height / 2 : 0,
      }),
    );
  }

  function findContainingAncestor(element, requiredText, maximumDepth = 10) {
    const expected = requiredText.toLocaleLowerCase("pt-BR");
    let current = element;
    for (let depth = 0; current && depth <= maximumDepth; depth += 1) {
      if (
        normalizedText(current).toLocaleLowerCase("pt-BR").includes(expected)
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function clickableControl(element) {
    let current = element;
    for (let depth = 0; current && depth <= 6; depth += 1) {
      if (
        current.matches?.(
          "button, [role='button'], [role='menuitem'], a",
        ) ||
        window.getComputedStyle(current).cursor === "pointer"
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return element;
  }

  function clickControl(element) {
    const control = clickableControl(element);
    if (!control || control.disabled || control.getAttribute?.("aria-disabled") === "true") {
      return false;
    }
    const rect = control.getBoundingClientRect?.();
    const init = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: rect ? rect.left + rect.width / 2 : 0,
      clientY: rect ? rect.top + rect.height / 2 : 0,
    };
    if (typeof window.PointerEvent === "function") {
      control.dispatchEvent(new window.PointerEvent("pointerdown", init));
    }
    control.dispatchEvent(new window.MouseEvent("mousedown", init));
    if (typeof window.PointerEvent === "function") {
      control.dispatchEvent(new window.PointerEvent("pointerup", init));
    }
    control.dispatchEvent(new window.MouseEvent("mouseup", init));
    control.dispatchEvent(new window.MouseEvent("click", init));
    return true;
  }

  function installEmptyQuickSellGuard(root) {
    if (root.dataset.altgridEmptySellGuard === "true") return;
    root.dataset.altgridEmptySellGuard = "true";
    root.addEventListener(
      "click",
      (event) => {
        const toggle = event.target?.closest?.(".sah-toggle");
        const api = bridge();
        if (!toggle) return;
        if (api?.isRunning?.()) {
          initialHuntStartActive = false;
          return;
        }
        updateHuntPresence();
        const quickSell = document.querySelector(
          "[data-guide='home-quick-sell-button']",
        );
        const atHome = isVisible(quickSell);
        if (atHome) {
          initialHuntStartActive = true;
          initialHuntStartAt = Date.now();
          initialHuntWarningSent = false;
        }
        if (atHome) {
          api?.notify?.("Início direto: seguindo para a seleção de hunt.");
        }
      },
      true,
    );
  }

  function visibleTextElement(expected, scope = document) {
    const normalizedExpected = String(expected).toLocaleLowerCase("pt-BR");
    return (
      [...scope.querySelectorAll("button, [role='button'], h5, p, span")].find(
        (element) =>
          !element.closest(PANEL_SELECTOR) &&
          isVisible(element) &&
          normalizedText(element).toLocaleLowerCase("pt-BR") ===
            normalizedExpected,
      ) ?? null
    );
  }

  function normalizeHuntName(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/gi, " ")
      .trim()
      .toLocaleLowerCase("pt-BR");
  }

  function setSearchValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  }

  function configuredHuntCard(config) {
    const expected = normalizeHuntName(config.huntName);
    if (!expected) return null;
    const matches = [...document.querySelectorAll("p.MuiTypography-noWrap")].filter(
      (card) => isVisible(card) && normalizeHuntName(card.textContent) === expected,
    );
    const configured = catalog?.getById?.(config.huntId);
    const occurrence = configured
      ? Math.max(
          0,
          catalog.HUNTS.filter(
            (hunt) => normalizeHuntName(hunt.title) === expected,
          )
            .sort(
              (left, right) =>
                left.recommendedLevel - right.recommendedLevel || left.id - right.id,
            )
            .findIndex((hunt) => hunt.id === configured.id),
        )
      : 0;
    return matches[occurrence] ?? matches[0] ?? null;
  }

  function driveInitialHuntStart() {
    updateHuntPresence();
    const api = bridge();
    if (!initialHuntStartActive) return;
    if (huntPresent) {
      initialHuntStartActive = false;
      return;
    }
    if (Date.now() - initialHuntStartAt > 90000) {
      initialHuntStartActive = false;
      if (!initialHuntWarningSent) {
        api?.notify?.("Não foi possível confirmar a entrada na hunt. Revise a hunt escolhida e tente novamente.");
        initialHuntWarningSent = true;
      }
      return;
    }

    const modal = document.querySelector("[data-guide='quick-sell-modal']");
    if (isVisible(modal)) {
      const cancel = visibleTextElement("CANCELAR", modal);
      if (cancel) {
        clickControl(cancel);
        api?.setPhase?.("EXPLORE");
      }
      return;
    }

    const search = document.querySelector("input[placeholder='Hunt ou criatura']");
    if (!isVisible(search)) return;
    const config = currentConfig();
    if (!normalizeHuntName(config.huntName)) {
      if (!initialHuntWarningSent) {
        api?.notify?.("Escolha uma hunt no painel do AltGrid Bot antes de iniciar.");
        initialHuntWarningSent = true;
      }
      initialHuntStartActive = false;
      return;
    }
    if (!api?.isRunning?.()) api?.start?.();
    if (!["PICK_HUNT", "START_HUNT", "WAIT_HUNT"].includes(api?.getPhase?.())) {
      api?.setPhase?.("PICK_HUNT");
    }
    if (normalizeHuntName(search.value) !== normalizeHuntName(config.huntName)) {
      setSearchValue(search, config.huntName);
      return;
    }

    const start = visibleTextElement("INICIAR hunt");
    if (start && Date.now() - lastStartHuntAssistAt >= 1200) {
      if (clickControl(start)) {
        lastStartHuntAssistAt = Date.now();
        api?.setPhase?.("WAIT_HUNT");
      }
      return;
    }

    const card = configuredHuntCard(config);
    if (card && Date.now() - lastHuntCardAssistAt >= 1200) {
      if (clickControl(card)) {
        lastHuntCardAssistAt = Date.now();
        api?.setPhase?.("START_HUNT");
      }
    }
  }

  function assistStartHunt() {
    updateHuntPresence();
    const api = bridge();
    if (
      !api?.isRunning?.() ||
      huntPresent ||
      !["START_HUNT", "WAIT_HUNT"].includes(api.getPhase?.()) ||
      !isVisible(document.querySelector("input[placeholder='Hunt ou criatura']")) ||
      Date.now() - lastStartHuntAssistAt < 1600
    ) {
      return;
    }
    const start = visibleTextElement("INICIAR hunt");
    if (start && clickControl(start)) {
      lastStartHuntAssistAt = Date.now();
    }
  }

  function inventoryOpenAction() {
    const candidates = [
      ...document.querySelectorAll(
        "button, [role='menuitem'], li, div, span, p",
      ),
    ].filter(
      (element) =>
        isVisible(element) &&
        normalizedText(element).toLocaleLowerCase("pt-BR") === "abrir",
    );
    for (const candidate of candidates) {
      const semanticMenu = candidate.closest?.("[role='menu']");
      const menu =
        semanticMenu ?? findContainingAncestor(candidate, "Descartar", 10);
      if (!menu || !isVisible(menu)) continue;
      const menuText = normalizedText(menu).toLocaleLowerCase("pt-BR");
      if (semanticMenu || menuText.includes("descartar")) {
        return clickableControl(candidate);
      }
    }
    return null;
  }

  async function waitFor(probe, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = probe();
      if (result) return result;
      await new Promise((resolve) => window.setTimeout(resolve, 200));
    }
    return null;
  }

  async function openOneGloothBag(item) {
    let action = null;
    for (const targetMode of ["slot", "wrapper", "container"]) {
      openInventoryContextMenu(item, targetMode);
      action = await waitFor(inventoryOpenAction, 1500);
      if (action) break;
    }
    if (!action) {
      throw new Error("o menu do item não exibiu a opção Abrir");
    }
    if (typeof action.click === "function") {
      action.click();
    } else {
      action.dispatchEvent(
        new window.MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
        }),
      );
    }
    await waitFor(() => !inventoryOpenAction(), 5000);
  }

  async function openAllGloothBags() {
    let opened = 0;
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const item = inventoryItemById(GLOOTH_BAG_ITEM_ID);
      if (!item) break;
      const amountBefore = inventoryItemAmount(item);
      await openOneGloothBag(item);
      opened += 1;
      const changed = await waitFor(() => {
        const remainingItem = inventoryItemById(GLOOTH_BAG_ITEM_ID);
        return (
          !remainingItem ||
          inventoryItemAmount(remainingItem) < amountBefore
        );
      }, 10000);
      if (!changed) {
        throw new Error("a quantidade da Glooth Bag não diminuiu");
      }
      const remaining = inventoryItemById(GLOOTH_BAG_ITEM_ID);
      gloothStatus = remaining
        ? `${opened} aberta(s); restam ${inventoryItemAmount(remaining)}`
        : `${opened} aberta(s); concluído`;
      renderGloothControl();
    }
    return opened;
  }

  function readCapacity() {
    const text =
      document.querySelector("[data-guide='character-capacity']")?.textContent ??
      "";
    const match = String(text).replace(/\./g, "").match(/-?\d+/);
    return match ? Number(match[0]) : null;
  }

  function visibleExactText(expectedText) {
    const expected = expectedText.toLocaleLowerCase("pt-BR");
    return [
      ...document.querySelectorAll(
        "button, [role='button'], h1, h2, h3, h4, h5, p, span",
      ),
    ].some(
      (element) =>
        !element.closest(PANEL_SELECTOR) &&
        isVisible(element) &&
        normalizedText(element).toLocaleLowerCase("pt-BR") === expected,
    );
  }

  function updateHuntPresence() {
    const finishButton = document.querySelector(
      "[data-guide='hunt-finish-button']",
    );
    const nowInHunt = isVisible(finishButton);
    if (nowInHunt && !huntPresent) huntEnteredAt = Date.now();
    if (!nowInHunt) huntEnteredAt = 0;
    huntPresent = nowInHunt;
  }

  function safeToOpenGloothBags(config) {
    const api = bridge();
    const atHome = isVisible(
      document.querySelector("[data-guide='home-quick-sell-button']"),
    );
    const settledInHunt =
      huntPresent && Date.now() - huntEnteredAt >= 15000;
    if (
      !api?.isRunning?.() ||
      api.getPhase?.() !== "HUNTING" ||
      (!settledInHunt && !atHome)
    ) {
      return false;
    }
    const capacity = readCapacity();
    if (
      !atHome &&
      Number.isFinite(capacity) &&
      capacity <= Number(config.capThreshold ?? 0)
    ) {
      return false;
    }
    if (
      isVisible(
        document.querySelector("[data-guide='quick-sell-modal']"),
      ) ||
      visibleExactText("CONCLUIR") ||
      visibleExactText("CANCELAR POSICIONAMENTO") ||
      visibleExactText("Friend Trade") ||
      visibleExactText("Loot Splitter")
    ) {
      return false;
    }
    return true;
  }

  async function runGloothAutomation() {
    updateHuntPresence();
    const config = currentConfig();
    if (config.autoOpenGloothBags !== true) {
      gloothStatus = "desativado";
      renderGloothControl(config);
      return;
    }
    if (openingGloothBags) return;
    const item = inventoryItemById(GLOOTH_BAG_ITEM_ID);
    if (!item) {
      gloothStatus = "aguardando item";
      renderGloothControl(config);
      return;
    }
    if (!safeToOpenGloothBags(config)) {
      gloothStatus = "aguardando a hunt ficar livre";
      renderGloothControl(config);
      return;
    }

    openingGloothBags = true;
    bridge()?.setExternalBusy?.(true);
    gloothStatus = `detectada (${inventoryItemAmount(item)}); abrindo`;
    renderGloothControl(config);
    try {
      const opened = await openAllGloothBags();
      if (opened > 0) {
        bridge()?.notify?.(`${opened} Glooth Bag(s) aberta(s) automaticamente.`);
      }
      lastGloothError = "";
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      gloothStatus = `erro: ${message}`;
      if (
        message !== lastGloothError ||
        Date.now() - lastGloothErrorAt > 60000
      ) {
        bridge()?.notify?.(`⚠ Glooth Bag: ${message}`);
        lastGloothError = message;
        lastGloothErrorAt = Date.now();
      }
    } finally {
      bridge()?.setExternalBusy?.(false);
      openingGloothBags = false;
      renderGloothControl();
    }
  }

  installStyles();
  syncPanel(true);
  window.setInterval(() => syncPanel(), 750);
  window.setInterval(() => {
    driveInitialHuntStart();
    assistStartHunt();
  }, 250);
  window.setInterval(() => {
    void runGloothAutomation();
  }, 2000);
})(typeof globalThis === "undefined" ? window : globalThis);
