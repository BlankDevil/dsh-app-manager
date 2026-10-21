/**
 * dsh-app-manager — browser half.
 *
 * Why this file exists
 * --------------------
 * The plugin's real UI is a plain HTTP page registered on `webServer` at
 * `/app-manager`. That works in `dsh web`, where you can type the URL. It does
 * **not** work in DSH Desktop: the Electron shell has no address bar, and the
 * only way a plugin's page can be reached from the shell is the Plugins panel's
 * per-row config page — the `plugins.row.config` slot, keyed by
 * `<bundle package name>#<row id>`.
 *
 * So this half does exactly one thing: register that row page, and render the
 * existing page inside it. No second implementation of the dashboard — the
 * iframe points at the same `/app-manager` route the browser uses, resolved
 * against the shell's own origin (same origin in both web and desktop).
 *
 * Build format
 * ------------
 * DSH client bundles are **not** ES modules loaded by the browser. They are
 * scripts that call `window.__ModuleLoader__.load({ id, factory })`; running a
 * bundle only registers its factory, and the body materialises lazily on first
 * use. `require()` resolves against the shell's frozen platform table (React,
 * Cordis, static UI libraries), which is why this file can use React without
 * declaring it under `dsh.client.external`.
 *
 * That makes the format hand-writable — no bundler, no JSX, no build-time
 * dependency on the DSH client packages. `scripts/build-client.mjs` copies this
 * file verbatim to `lib/client.js`, which is what `exports["./client"]` points
 * at.
 */

window.__ModuleLoader__.load({
  id: "dsh-app-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

    const react = require("react");

    /** Dictionary namespace owned by this plugin. */
    const NS = "plugin.appManager";

    /**
     * The slot key the Plugins panel looks for.
     *
     * `dsh-client-ui-plugin-manager` builds this as
     * `${bundle package name}#${row id}`; the row id is the one our patch
     * declares (`app-manager`). A mismatch is silent — the row simply never
     * grows a chevron and the page stays unreachable — so `tests/client-entry.test.mjs`
     * asserts this string against `patch.yml` and `package.json`.
     */
    const ROW_KEY = "dsh-app-manager#app-manager";

    /** The route the server half registers. */
    const PAGE_PATH = "/app-manager";

    const en = {
      title: "App Manager",
      summary: "Installed CLI tools: versions, update state, and leftovers.",
      openInTab: "Open in a new tab",
      frameTitle: "App Manager dashboard",
      unsupported: "This shell cannot embed the dashboard; open it in a browser instead.",
      urlLabel: "Dashboard URL",
    };

    const zh = {
      title: "应用管理器",
      summary: "本机已安装的命令行工具：版本、可更新状态、卸载残留。",
      openInTab: "在新标签页打开",
      frameTitle: "应用管理器面板",
      unsupported: "当前外壳无法内嵌该面板，请在浏览器中打开。",
      urlLabel: "面板地址",
    };

    /**
     * Absolute URL of the dashboard.
     *
     * Deliberately derived from the shell's own origin at render time rather
     * than hard-coded: the desktop shell picks a **random localhost port** on
     * every launch (it is not 3080 — that is `dsh web`), so any baked-in port
     * would be wrong half the time. Same-origin means `web` and `desktop` both
     * resolve correctly with no configuration.
     *
     * @returns {string} absolute URL when the shell is served over http(s),
     *   otherwise the root-relative path.
     */
    function pageUrl() {
      try {
        const loc = window.location;
        if (loc && /^https?:$/.test(loc.protocol) && loc.origin && loc.origin !== "null") {
          return loc.origin + PAGE_PATH;
        }
      } catch {
        /* fall through to the relative form */
      }
      return PAGE_PATH;
    }

    /**
     * Read one label, tolerating a shell that did not inject `t`.
     *
     * @param {object} props slot props.
     * @param {keyof zh} key dictionary key.
     * @returns {string} localized copy, or the English fallback.
     */
    function label(props, key) {
      try {
        if (props && typeof props.t === "function") return props.t(key);
      } catch {
        /* fall through */
      }
      return en[key];
    }

    /**
     * The row page the Plugins panel renders.
     *
     * `view: "summary"` is the one-liner shown under the row title; `view:
     * "page"` is the page itself. Both come from the same registration.
     *
     * @param {object} props slot props (`view`, `t`, `form`).
     * @returns {object} React element.
     */
    function AppManagerPage(props) {
      const view = props && props.view;

      if (view === "summary") {
        return react.createElement("span", null, label(props, "summary"));
      }

      const url = pageUrl();

      const toolbar = react.createElement(
        "div",
        {
          style: {
            display: "flex",
            alignItems: "center",
            gap: "0.75rem",
            flexWrap: "wrap",
            margin: "0 0 0.6rem",
            font: "inherit",
          },
        },
        react.createElement(
          "a",
          {
            href: url,
            target: "_blank",
            rel: "noreferrer",
            style: { font: "inherit", fontWeight: 600 },
          },
          label(props, "openInTab")
        ),
        react.createElement(
          "code",
          { style: { opacity: 0.7, font: "inherit", fontSize: "0.9em" } },
          url
        )
      );

      const frame = react.createElement("iframe", {
        src: url,
        title: label(props, "frameTitle"),
        style: {
          width: "100%",
          height: "calc(100vh - 220px)",
          minHeight: "420px",
          border: "1px solid rgba(127,127,127,0.28)",
          borderRadius: "8px",
          background: "transparent",
          display: "block",
        },
      });

      return react.createElement("div", { "data-dsh-app-manager": true }, toolbar, frame);
    }

    /** Required cordis services. */
    const inject = ["slots", "locale"];

    /**
     * Register the row page for as long as this plugin is loaded.
     *
     * @param {object} ctx browser plugin context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS);

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-app-manager: dictionaries");

      ctx.effect(
        () =>
          ctx.slots.inject("plugins.row.config", () =>
            ctx.slots.register(
              {
                name: "plugins.row.config",
                key: ROW_KEY,
                locale: NS,
              },
              AppManagerPage
            )
          ),
        "dsh-app-manager: plugins row page"
      );

      // The dictionary is bound eagerly so a missing namespace fails at mount
      // time (matching every other client plugin) rather than on first render.
      void t;
    }

    exports.NS = NS;
    exports.ROW_KEY = ROW_KEY;
    exports.PAGE_PATH = PAGE_PATH;
    exports.AppManagerPage = AppManagerPage;
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  },
});
