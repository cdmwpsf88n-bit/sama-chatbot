/*
 * Widget de chat intégrable. À coller sur votre site, juste avant </body> :
 *   <script src="https://VOTRE-APP.vercel.app/widget.js" async></script>
 * Options facultatives : data-color="#1F6F5C" data-label="Réserver" data-position="left"
 */
(function () {
  if (window.__samaChatWidget) return;
  window.__samaChatWidget = true;

  var script = document.currentScript || (function () {
    var s = document.querySelectorAll('script[src*="widget.js"]');
    return s[s.length - 1];
  })();
  var base = new URL(script.src).origin;
  var color = script.getAttribute('data-color') || '#1F6F5C';
  var label = script.getAttribute('data-label') || 'Réserver / Questions';
  var left = script.getAttribute('data-position') === 'left';
  var side = left ? 'left' : 'right';

  var style = document.createElement('style');
  style.textContent =
    '.sama-cw-btn{position:fixed;' + side + ':20px;bottom:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;' +
    'background:' + color + ';color:#fff;border:0;border-radius:999px;padding:12px 18px 12px 14px;font:600 15px/1 system-ui,sans-serif;' +
    'box-shadow:0 6px 20px rgba(0,0,0,.2);cursor:pointer}' +
    '.sama-cw-btn:focus-visible{outline:3px solid #F0A452;outline-offset:2px}' +
    '.sama-cw-btn svg{width:22px;height:22px;flex:none}' +
    '.sama-cw-frame{position:fixed;' + side + ':20px;bottom:84px;z-index:2147483000;width:380px;height:600px;max-height:calc(100vh - 110px);' +
    'border:0;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.25);background:#fff;display:none}' +
    '.sama-cw-open .sama-cw-frame{display:block}' +
    '@media (max-width:480px){.sama-cw-frame{left:0;right:0;bottom:0;top:0;width:100%;height:100%;max-height:none;border-radius:0}' +
    '.sama-cw-open .sama-cw-btn{bottom:auto;top:12px;' + side + ':12px;padding:10px 14px}}';
  document.head.appendChild(style);

  var root = document.createElement('div');
  var frame = document.createElement('iframe');
  frame.className = 'sama-cw-frame';
  frame.title = 'Chat de réservation';
  frame.setAttribute('loading', 'lazy');

  var btn = document.createElement('button');
  btn.className = 'sama-cw-btn';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  var chatIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
  var closeIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  function paint(open) {
    btn.innerHTML = (open ? closeIcon : chatIcon) + '<span></span>';
    btn.lastChild.textContent = open ? 'Fermer' : label;
    btn.setAttribute('aria-expanded', String(open));
  }
  paint(false);

  btn.addEventListener('click', function () {
    var open = !root.classList.contains('sama-cw-open');
    if (open && !frame.src) frame.src = base + '/?embed=1';
    root.classList.toggle('sama-cw-open', open);
    paint(open);
  });

  root.appendChild(frame);
  root.appendChild(btn);
  (document.body || document.documentElement).appendChild(root);
})();
