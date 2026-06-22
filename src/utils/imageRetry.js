const IMG_RETRY_STATE = new WeakMap();
const URL_RETRY_STATE = new Map();

const BG_URL_REGEX = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;

const DEFAULT_OPTIONS = {
  maxRetries: 5,
  baseDelayMs: 500,
  maxDelayMs: 16000,
};

function getBackoffDelay(attempt, { baseDelayMs, maxDelayMs }) {
  return Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
}

function shouldRetryUrl(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return false;
  return true;
}

function stripRetryParam(url) {
  try {
    const parsed = new URL(url, window.location.href);
    if (!parsed.searchParams.has('_rt')) return url;
    parsed.searchParams.delete('_rt');
    const search = parsed.searchParams.toString();
    parsed.search = search ? `?${search}` : '';
    return parsed.href;
  } catch {
    return url.replace(/([?&])_rt=[^&]*&?/, '$1').replace(/[?&]$/, '');
  }
}

function appendCacheBuster(url) {
  try {
    const parsed = new URL(url, window.location.href);
    parsed.searchParams.set('_rt', Date.now().toString());
    return parsed.href;
  } catch {
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_rt=${Date.now()}`;
  }
}

function extractImageUrls(backgroundImage) {
  if (!backgroundImage || backgroundImage === 'none') return [];
  const urls = [];
  BG_URL_REGEX.lastIndex = 0;
  let match;
  while ((match = BG_URL_REGEX.exec(backgroundImage)) !== null) {
    const url = match[2];
    if (shouldRetryUrl(url)) urls.push(url);
  }
  return urls;
}

function replaceUrlInBackground(backgroundImage, fromUrl, toUrl) {
  const escaped = fromUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return backgroundImage.replace(
    new RegExp(`url\\(['"]?${escaped}['"]?\\)`, 'i'),
    `url("${toUrl}")`
  );
}

function getImgState(img) {
  let state = IMG_RETRY_STATE.get(img);
  if (!state) {
    state = {
      attempt: 0,
      timer: null,
      originalSrc: img.dataset.originalSrc || img.currentSrc || img.src,
    };
    IMG_RETRY_STATE.set(img, state);
    if (!img.dataset.originalSrc && state.originalSrc) {
      img.dataset.originalSrc = state.originalSrc;
    }
  }
  return state;
}

function scheduleImgRetry(img, options) {
  const state = getImgState(img);
  if (state.timer || state.attempt >= options.maxRetries) return;

  const attempt = state.attempt++;
  const delay = getBackoffDelay(attempt, options);

  state.timer = setTimeout(() => {
    state.timer = null;
    img.src = appendCacheBuster(state.originalSrc);
  }, delay);
}

function handleImageError(event, options) {
  const img = event.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (!shouldRetryUrl(img.currentSrc || img.src)) return;

  scheduleImgRetry(img, options);
}

function getUrlState(originalUrl) {
  let state = URL_RETRY_STATE.get(originalUrl);
  if (!state) {
    state = {
      attempt: 0,
      timer: null,
      probing: false,
      subscribers: new Set(),
    };
    URL_RETRY_STATE.set(originalUrl, state);
  }
  return state;
}

function updateElementBackground(element, originalUrl, retryUrl) {
  const bgImage = element.style.backgroundImage;
  if (!bgImage) return;

  for (const url of extractImageUrls(bgImage)) {
    if (stripRetryParam(url) === originalUrl) {
      element.style.backgroundImage = replaceUrlInBackground(
        bgImage,
        url,
        retryUrl
      );
      return;
    }
  }
}

function updateBackgroundSubscribers(originalUrl, retryUrl) {
  const state = URL_RETRY_STATE.get(originalUrl);
  if (!state) return;

  for (const element of state.subscribers) {
    if (!element.isConnected) {
      state.subscribers.delete(element);
      continue;
    }
    updateElementBackground(element, originalUrl, retryUrl);
  }
}

function probeBackgroundUrl(originalUrl, options) {
  const state = getUrlState(originalUrl);
  if (state.probing || state.timer) return;

  state.probing = true;
  const img = new Image();
  const loadUrl =
    state.lastRetryUrl && state.attempt > 0 ? state.lastRetryUrl : originalUrl;

  img.onload = () => {
    state.probing = false;
  };
  img.onerror = () => {
    state.probing = false;
    scheduleBackgroundRetry(originalUrl, options);
  };
  img.src = loadUrl;
}

function scheduleBackgroundRetry(originalUrl, options) {
  const state = getUrlState(originalUrl);
  if (state.timer || state.attempt >= options.maxRetries) return;

  const attempt = state.attempt++;
  const delay = getBackoffDelay(attempt, options);

  state.timer = setTimeout(() => {
    state.timer = null;
    state.lastRetryUrl = appendCacheBuster(originalUrl);
    updateBackgroundSubscribers(originalUrl, state.lastRetryUrl);
    probeBackgroundUrl(originalUrl, options);
  }, delay);
}

function watchBackgroundImage(element, options) {
  const bgImage = element.style.backgroundImage;
  if (!bgImage) return;

  for (const url of extractImageUrls(bgImage)) {
    const originalUrl = stripRetryParam(url);
    const state = getUrlState(originalUrl);

    if (url === originalUrl) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
      state.attempt = 0;
      state.probing = false;
      state.lastRetryUrl = null;
    }

    state.subscribers.add(element);
    probeBackgroundUrl(originalUrl, options);
  }
}

function scanElementForBackground(element, options) {
  if (!(element instanceof HTMLElement)) return;
  watchBackgroundImage(element, options);
}

function scanTreeForBackground(root, options) {
  if (!(root instanceof HTMLElement)) return;
  scanElementForBackground(root, options);
  root.querySelectorAll('[style*="background"]').forEach(el => {
    scanElementForBackground(el, options);
  });
}

function initBackgroundImageRetry(options) {
  scanTreeForBackground(document.documentElement, options);

  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === 'style'
      ) {
        scanElementForBackground(mutation.target, options);
      }
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach(node => {
          scanTreeForBackground(node, options);
        });
      }
    }
  });

  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['style'],
  });
}

/**
 * Retries failed image loads with exponential backoff for:
 * - <img> elements (via capture-phase error events)
 * - CSS background-image on inline styles (via Image() probing)
 *
 * Browsers do not expose network error codes (e.g. ERR_CONNECTION_CLOSED)
 * on image failures, so this retries all load failures — transient ones
 * like connection resets are covered.
 */
export function initImageRetry(userOptions = {}) {
  const options = { ...DEFAULT_OPTIONS, ...userOptions };

  document.addEventListener(
    'error',
    event => handleImageError(event, options),
    true
  );

  initBackgroundImageRetry(options);
}
