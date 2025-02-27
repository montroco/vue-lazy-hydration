var observers = new Map();
function makeHydrationObserver(options) {
  if (typeof IntersectionObserver === "undefined") return null;
  var optionKey = JSON.stringify(options);
  if (observers.has(optionKey)) return observers.get(optionKey);
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      // Use `intersectionRatio` because of Edge 15's
      // lack of support for `isIntersecting`.
      // See: https://github.com/w3c/IntersectionObserver/issues/211
      var isIntersecting = entry.isIntersecting || entry.intersectionRatio > 0;
      if (!isIntersecting || !entry.target.hydrate) return;
      entry.target.hydrate();
    });
  }, options);
  observers.set(optionKey, observer);
  return observer;
}

function makeHydrationPromise() {
  var hydrate = function hydrate() {};

  var hydrationPromise = new Promise(function (resolve) {
    hydrate = resolve;
  });
  return {
    hydrate: hydrate,
    hydrationPromise: hydrationPromise
  };
}

var isServer = typeof window === "undefined";

function isAsyncComponentFactory(componentOrFactory) {
  return typeof componentOrFactory === "function";
}

function resolveComponent(componentOrFactory) {
  if (isAsyncComponentFactory(componentOrFactory)) {
    return componentOrFactory().then(function (componentModule) {
      return componentModule.default;
    });
  }

  return componentOrFactory;
}

function makeNonce(_ref) {
  var component = _ref.component,
      hydrationPromise = _ref.hydrationPromise;
  if (isServer) return component;
  return function () {
    return hydrationPromise.then(function () {
      return resolveComponent(component);
    });
  };
}

var hydrationDisabled = false;

if (typeof window === "undefined") {
  hydrationDisabled = true;
} else {
  window.addEventListener("load", function () {
    hydrationDisabled = true;
  });
}

function makeHydrationBlocker(component, options) {
  return Object.assign({
    mixins: [{
      beforeCreate: function beforeCreate() {
        this.cleanupHandlers = [];

        if (hydrationDisabled) {
          this.Nonce = component;
        } else {
          var _makeHydrationPromise = makeHydrationPromise(),
              hydrate = _makeHydrationPromise.hydrate,
              hydrationPromise = _makeHydrationPromise.hydrationPromise;

          this.Nonce = makeNonce({
            component: component,
            hydrationPromise: hydrationPromise
          });
          this.hydrate = hydrate;
          this.hydrationPromise = hydrationPromise;
        }
      },
      beforeDestroy: function beforeDestroy() {
        this.cleanup();
      },
      mounted: function mounted() {
        var _this = this;

        if (!this.hydrate) return;

        if (this.$el.nodeType === Node.COMMENT_NODE) {
          // No SSR rendered content, hydrate immediately.
          this.hydrate();
          return;
        }

        if (this.never) return;

        if (this.whenVisible) {
          var observerOptions = this.whenVisible !== true ? this.whenVisible : undefined;
          var observer = makeHydrationObserver(observerOptions); // If Intersection Observer API is not supported, hydrate immediately.

          if (!observer) {
            this.hydrate();
            return;
          }

          this.$el.hydrate = this.hydrate;

          var cleanup = function cleanup() {
            return observer.unobserve(_this.$el);
          };

          this.cleanupHandlers.push(cleanup);
          this.hydrationPromise.then(cleanup);
          observer.observe(this.$el);
          return;
        }

        if (this.whenIdle) {
          // If `requestIdleCallback()` or `requestAnimationFrame()`
          // is not supported, hydrate immediately.
          if (!("requestIdleCallback" in window) || !("requestAnimationFrame" in window)) {
            this.hydrate();
            return;
          } // @ts-ignore


          var id = requestIdleCallback(function () {
            requestAnimationFrame(_this.hydrate);
          }, {
            timeout: this.idleTimeout
          }); // @ts-ignore

          var _cleanup = function _cleanup() {
            return cancelIdleCallback(id);
          };

          this.cleanupHandlers.push(_cleanup);
          this.hydrationPromise.then(_cleanup);
        }

        if (this.interactionEvents && this.interactionEvents.length) {
          var eventListenerOptions = {
            capture: true,
            once: true,
            passive: true
          };
          this.interactionEvents.forEach(function (eventName) {
            _this.$el.addEventListener(eventName, _this.hydrate, eventListenerOptions);

            var cleanup = function cleanup() {
              _this.$el.removeEventListener(eventName, _this.hydrate, eventListenerOptions);
            };

            _this.cleanupHandlers.push(cleanup);
          });
        }
      },
      methods: {
        cleanup: function cleanup() {
          this.cleanupHandlers.forEach(function (handler) {
            return handler();
          });
        }
      },
      render: function render(h) {
        return h(this.Nonce, {
          attrs: Object.assign({}, this.$attrs),
          on: this.$listeners,
          scopedSlots: this.$scopedSlots
        }, this.$slots.default);
      }
    }]
  }, options);
}

function hydrateWhenIdle(componentOrFactory) {
  var _ref = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
      _ref$timeout = _ref.timeout,
      timeout = _ref$timeout === void 0 ? 2000 : _ref$timeout;

  return makeHydrationBlocker(componentOrFactory, {
    beforeCreate: function beforeCreate() {
      this.whenIdle = true;
      this.idleTimeout = timeout;
    }
  });
}
function hydrateWhenVisible(componentOrFactory) {
  var _ref2 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
      _ref2$observerOptions = _ref2.observerOptions,
      observerOptions = _ref2$observerOptions === void 0 ? undefined : _ref2$observerOptions;

  return makeHydrationBlocker(componentOrFactory, {
    beforeCreate: function beforeCreate() {
      this.whenVisible = observerOptions || true;
    }
  });
}
function hydrateNever(componentOrFactory) {
  return makeHydrationBlocker(componentOrFactory, {
    beforeCreate: function beforeCreate() {
      this.never = true;
    }
  });
}
function hydrateOnInteraction(componentOrFactory) {
  var _ref3 = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {},
      _ref3$event = _ref3.event,
      event = _ref3$event === void 0 ? "focus" : _ref3$event;

  var events = Array.isArray(event) ? event : [event];
  return makeHydrationBlocker(componentOrFactory, {
    beforeCreate: function beforeCreate() {
      this.interactionEvents = events;
    }
  });
}
var Placeholder = {
  render: function render() {
    return this.$slots.default;
  }
};
var LazyHydrate = makeHydrationBlocker(Placeholder, {
  props: {
    idleTimeout: {
      default: 2000,
      type: Number
    },
    never: {
      type: Boolean
    },
    onInteraction: {
      type: [Array, Boolean, String]
    },
    triggerHydration: {
      default: false,
      type: Boolean
    },
    whenIdle: {
      type: Boolean
    },
    whenVisible: {
      type: [Boolean, Object]
    }
  },
  computed: {
    interactionEvents: function interactionEvents() {
      if (!this.onInteraction) return [];
      if (this.onInteraction === true) return ["focus"];
      return Array.isArray(this.onInteraction) ? this.onInteraction : [this.onInteraction];
    }
  },
  watch: {
    triggerHydration: {
      immediate: true,
      handler: function handler(isTriggered) {
        if (isTriggered && this.hydrate) this.hydrate();
      }
    }
  }
});

export default LazyHydrate;
export { hydrateNever, hydrateOnInteraction, hydrateWhenIdle, hydrateWhenVisible };
