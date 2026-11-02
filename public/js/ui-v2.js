/* DWIM TV UI v2: scrolled topbar, mobile menu, scroll reveal, active nav link */
(function () {
  var bar = document.querySelector('.topbar');
  var nav = document.getElementById('topnav');
  var btn = document.getElementById('menuBtn');

  function onScroll() { if (bar) bar.classList.toggle('scrolled', window.scrollY > 24); }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  function closeMenu() { if (nav) nav.classList.remove('open'); if (btn) { btn.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } }
  if (btn && nav) {
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.addEventListener('click', function (e) { if (e.target.tagName === 'A') closeMenu(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMenu(); });
  }

  // scroll reveal
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var targets = document.querySelectorAll('.section-block .testi-head, .purpose-card, .testi-card, .leader-card, .builder-card, .purpose-videos figure, .visit-card, .block-content, .countdown');
  if (!('IntersectionObserver' in window) || reduce) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(function (el, i) { el.classList.add('reveal'); el.style.transitionDelay = ((i % 4) * 70) + 'ms'; io.observe(el); });

  // highlight the nav link of the section in view
  var links = {};
  document.querySelectorAll('.topnav a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
  var so = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting && links[en.target.id]) {
        Object.keys(links).forEach(function (k) { links[k].classList.remove('active'); });
        links[en.target.id].classList.add('active');
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  Object.keys(links).forEach(function (id) { var el = document.getElementById(id); if (el) so.observe(el); });
})();
