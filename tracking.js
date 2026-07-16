(function () {
  var META_PIXEL_ID = '918376947924562';
  var CHECKOUT_CLICK_TTL = 60 * 1000;

  function initMetaPixel() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s){
      if(f.fbq)return;
      n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;
      n.push=n;
      n.loaded=!0;
      n.version='2.0';
      n.queue=[];
      t=b.createElement(e);
      t.async=!0;
      t.src=v;
      s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s);
    }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', META_PIXEL_ID);
  }

  function nowBase36() {
    return Date.now().toString(36);
  }

  function randomBase36() {
    if (window.crypto && window.crypto.getRandomValues) {
      var bytes = new Uint32Array(2);
      window.crypto.getRandomValues(bytes);
      return bytes[0].toString(36) + bytes[1].toString(36);
    }
    return Math.random().toString(36).slice(2);
  }

  function eventId(name) {
    return ['dl', name, nowBase36(), randomBase36()].join('_');
  }

  function getCookie(name) {
    var match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : undefined;
  }

  function getMetaCookies() {
    return {
      fbp: getCookie('_fbp'),
      fbc: getCookie('_fbc'),
    };
  }

  function pickUrlParams() {
    var params = new URLSearchParams(window.location.search);
    var keys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'src', 'sck'];
    return keys.reduce(function (acc, key) {
      var value = params.get(key);
      if (value) acc[key] = value;
      return acc;
    }, {});
  }

  function getAttribution() {
    var current = pickUrlParams();
    var hasCurrent = Object.keys(current).length > 0;
    var stored = {};
    try {
      stored = JSON.parse(localStorage.getItem('dl_attribution') || '{}') || {};
    } catch (e) {}

    var attribution = Object.assign({}, stored, current, {
      current_url: window.location.href,
      referrer: document.referrer || stored.referrer || '',
      landing_page: stored.landing_page || window.location.href,
    });

    if (hasCurrent || !stored.landing_page) {
      try {
        localStorage.setItem('dl_attribution', JSON.stringify(attribution));
      } catch (e) {}
    }

    return attribution;
  }

  function kitPayload(kit) {
    var kits = {
      1: { name: 'DuraLibid 1 Frasco', value: 89.90, quantity: 1, id: 'duralibid-1frasco' },
      2: { name: 'DuraLibid 2 Frascos', value: 165.90, quantity: 2, id: 'duralibid-2frascos' },
      3: { name: 'DuraLibid 3 Frascos', value: 239.90, quantity: 3, id: 'duralibid-3frascos' },
    };
    var selected = kits[kit] || kits[2];
    return {
      content_name: selected.name,
      content_ids: [selected.id],
      content_type: 'product',
      currency: 'BRL',
      value: selected.value,
      num_items: selected.quantity,
    };
  }

  function productPayload() {
    return {
      content_name: 'Duralibid',
      content_category: 'Serum Intimo Masculino',
      content_ids: ['duralibid-serumintimo'],
      content_type: 'product',
      value: 239.90,
      currency: 'BRL',
    };
  }

  function track(name, data, options) {
    options = options || {};
    var id = options.eventId || eventId(name);
    if (window.fbq) {
      window.fbq('track', name, data || {}, { eventID: id });
    }
    return id;
  }

  function trackCustom(name, data, options) {
    options = options || {};
    var id = options.eventId || eventId(name);
    if (window.fbq) {
      window.fbq('trackCustom', name, data || {}, { eventID: id });
    }
    return id;
  }

  function markCheckoutClick(kit) {
    try {
      sessionStorage.setItem('dl_checkout_click_' + kit, String(Date.now()));
    } catch (e) {}
  }

  function recentlyTrackedCheckoutClick(kit) {
    try {
      var trackedAt = parseInt(sessionStorage.getItem('dl_checkout_click_' + kit), 10);
      return trackedAt && Date.now() - trackedAt < CHECKOUT_CLICK_TTL;
    } catch (e) {
      return false;
    }
  }

  function bindPageTracking() {
    document.querySelectorAll('[data-track-cta]').forEach(function (el) {
      el.addEventListener('click', function () {
        trackCustom('CTAClick', {
          cta_name: el.getAttribute('data-track-cta'),
          destination: el.getAttribute('href') || '',
        });
      });
    });

    document.querySelectorAll('[data-track-checkout]').forEach(function (el) {
      el.addEventListener('click', function () {
        var kit = parseInt(el.getAttribute('data-track-checkout'), 10) || 2;
        markCheckoutClick(kit);
        track('InitiateCheckout', kitPayload(kit));
      });
    });
  }

  initMetaPixel();
  track('PageView', {});

  window.DLTracking = {
    eventId: eventId,
    getAttribution: getAttribution,
    getMetaCookies: getMetaCookies,
    kitPayload: kitPayload,
    productPayload: productPayload,
    recentlyTrackedCheckoutClick: recentlyTrackedCheckoutClick,
    track: track,
    trackCustom: trackCustom,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindPageTracking);
  } else {
    bindPageTracking();
  }
})();
