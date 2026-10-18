/* @vercel/speed-insights v1.3.1 - Browser-compatible version
   Source: https://github.com/vercel/speed-insights
   License: Apache-2.0
   
   Vercel Speed Insights integration for static HTML sites.
   Call window.famoSpeedInsights.inject() to initialize tracking. */
(function (global) {
  "use strict";

  const name = "@vercel/speed-insights";
  const version = "1.3.1";

  const initQueue = () => {
    if (window.si) return;
    window.si = function a(...params) {
      (window.siq = window.siq || []).push(params);
    };
  };

  function isBrowser() {
    return typeof window !== "undefined";
  }

  function detectEnvironment() {
    try {
      const env = typeof process !== "undefined" && process.env && process.env.NODE_ENV;
      if (env === "development" || env === "test") {
        return "development";
      }
    } catch (e) {
      // Ignore errors accessing process
    }
    return "production";
  }

  function isDevelopment() {
    return detectEnvironment() === "development";
  }

  function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function turnValueToRegExp(value) {
    return new RegExp(`/${escapeRegExp(value)}(?=[/?#]|$)`);
  }

  function computeRoute(pathname, pathParams) {
    if (!pathname || !pathParams) {
      return pathname;
    }
    let result = pathname;
    try {
      const entries = Object.entries(pathParams);
      for (const [key, value] of entries) {
        if (!Array.isArray(value)) {
          const matcher = turnValueToRegExp(value);
          if (matcher.test(result)) {
            result = result.replace(matcher, `/[${key}]`);
          }
        }
      }
      for (const [key, value] of entries) {
        if (Array.isArray(value)) {
          const matcher = turnValueToRegExp(value.join("/"));
          if (matcher.test(result)) {
            result = result.replace(matcher, `/[...${key}]`);
          }
        }
      }
      return result;
    } catch (e) {
      return pathname;
    }
  }

  function getScriptSrc(props) {
    if (props.scriptSrc) {
      return props.scriptSrc;
    }
    if (isDevelopment()) {
      return "https://va.vercel-scripts.com/v1/speed-insights/script.debug.js";
    }
    if (props.dsn) {
      return "https://va.vercel-scripts.com/v1/speed-insights/script.js";
    }
    if (props.basePath) {
      return `${props.basePath}/speed-insights/script.js`;
    }
    return "/_vercel/speed-insights/script.js";
  }

  function injectSpeedInsights(props = {}) {
    if (!isBrowser() || props.route === null) return null;
    initQueue();
    const src = getScriptSrc(props);
    if (document.head.querySelector(`script[src*="${src}"]`)) return null;
    if (props.beforeSend) {
      if (window.si) {
        window.si("beforeSend", props.beforeSend);
      }
    }
    const script = document.createElement("script");
    script.src = src;
    script.defer = true;
    script.dataset.sdkn = name + (props.framework ? `/${props.framework}` : "");
    script.dataset.sdkv = version;
    if (props.sampleRate) {
      script.dataset.sampleRate = props.sampleRate.toString();
    }
    if (props.route) {
      script.dataset.route = props.route;
    }
    if (props.endpoint) {
      script.dataset.endpoint = props.endpoint;
    } else if (props.basePath) {
      script.dataset.endpoint = `${props.basePath}/speed-insights/vitals`;
    }
    if (props.dsn) {
      script.dataset.dsn = props.dsn;
    }
    if (isDevelopment() && props.debug === false) {
      script.dataset.debug = "false";
    }
    script.onerror = () => {
      console.log(
        `[Vercel Speed Insights] Failed to load script from ${src}. Please check if any content blockers are enabled and try again.`
      );
    };
    document.head.appendChild(script);
    return {
      setRoute: (route) => {
        script.dataset.route = route !== null && route !== undefined ? route : undefined;
      }
    };
  }

  // Export globally for use in FAMO portal
  global.famoSpeedInsights = {
    inject: injectSpeedInsights,
    computeRoute: computeRoute
  };

})(typeof window !== "undefined" ? window : this);
