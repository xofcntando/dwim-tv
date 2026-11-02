/* DWIM TV — PWA: service worker registration + "Install App" button (Android, Windows, Mac, Linux, ChromeOS; iOS gets instructions) */
(function () {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function (e) { console.warn('SW registration failed', e); });
    });
  }

  var deferred = null;
  var btns = function () { return Array.prototype.slice.call(document.querySelectorAll('[data-install-app]')); };
  var standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  function show(on) { btns().forEach(function (b) { b.hidden = !on; }); }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferred = e;
    if (!standalone) show(true);
  });

  window.addEventListener('appinstalled', function () { deferred = null; show(false); });

  // iOS Safari has no install prompt: show the button and explain Add to Home Screen.
  document.addEventListener('DOMContentLoaded', function () {
    if (isIOS && !standalone) show(true);
    btns().forEach(function (b) {
      b.addEventListener('click', function () {
        if (deferred) {
          deferred.prompt();
          deferred.userChoice.then(function () { deferred = null; show(false); });
        } else if (isIOS) {
          alert('To install DWIM TV on your iPhone/iPad:\n\n1. Tap the Share button (square with an arrow) in Safari\n2. Scroll down and tap "Add to Home Screen"\n3. Tap "Add"');
        } else {
          alert('To install DWIM TV, open your browser menu and choose "Install app" or "Add to Home screen".');
        }
      });
    });
  });
})();
