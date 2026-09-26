/* Glisser-déposer léger (Pointer Events) : souris, tablette et téléphone.
   - Souris : le glisser commence après 6 px de mouvement (un simple clic reste un clic).
   - Tactile : appui long (220 ms) sans bouger, puis glisser ; un balayage normal fait défiler.
     Sur une poignée (.grip, touch-action:none) le glisser part tout de suite.
   Utilisé par le bord (statuts), Leveringen (ordre de tournée) et Beheer (ordre du catalogue).

   K.sortable(root, {
     items: ".ocard",          éléments déplaçables (délégué : survit aux re-rendus)
     zones: ".col",            conteneurs de dépôt (une seule liste si omis : root)
     handle: ".grip",          facultatif : zone de prise dans l'élément
     onDrop({ item, from, to, index, before }) → false pour annuler (l'élément revient)
   })
   Renvoie une fonction qui détache les écouteurs. */
(function (global) {
  const K = global.K;
  if (!K) return;
  const LONG_PRESS = 220, MOVE_START = 6, EDGE = 60;

  K.sortable = function (root, opts) {
    const o = Object.assign({ zones: null, handle: null }, opts || {});
    let st = null; // état du geste en cours

    const zoneOf = el => (o.zones ? el && el.closest(o.zones) : root);
    const itemsIn = zone => Array.from(zone.querySelectorAll(o.items)).filter(el => el !== st.item && el.offsetParent !== null);

    function begin() {
      const r = st.item.getBoundingClientRect();
      st.dx = st.x - r.left; st.dy = st.y - r.top; st.active = true;
      st.from = zoneOf(st.item);
      st.ghost = st.item.cloneNode(true);
      st.ghost.classList.add("drag-ghost");
      Object.assign(st.ghost.style, { width: r.width + "px", height: r.height + "px", left: r.left + "px", top: r.top + "px" });
      document.body.appendChild(st.ghost);
      st.ph = document.createElement("div");
      st.ph.className = "drag-ph"; st.ph.style.height = r.height + "px";
      st.item.parentNode.insertBefore(st.ph, st.item);
      st.item.classList.add("drag-src");
      document.documentElement.classList.add("dragging");
      if (navigator.vibrate) { try { navigator.vibrate(12); } catch (e) { /* ignore */ } }
    }

    function place(x, y) {
      st.ghost.style.transform = "translate(" + (x - st.x) + "px," + (y - st.y) + "px)";
      const under = document.elementFromPoint(x, y);
      let zone = under && zoneOf(under);
      if (!zone || !root.contains(zone)) zone = null;
      // défilement automatique près des bords de l'écran (fenêtre ou conteneur qui défile)
      const h = global.innerHeight;
      st.scroll = y < EDGE ? -14 : y > h - EDGE ? 14 : 0;
      if (!zone) return; // au-dessus d'une barre fixe : on garde la dernière position valable
      document.querySelectorAll(".drop-on").forEach(z => { if (z !== zone) z.classList.remove("drop-on"); });
      zone.classList.add("drop-on"); st.to = zone;
      const list = itemsIn(zone);
      const before = list.find(el => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
      const host = before ? before.parentNode : (list.length ? list[list.length - 1].parentNode : zone.querySelector("[data-drop-list]") || zone);
      if (before) host.insertBefore(st.ph, before); else host.appendChild(st.ph);
    }
    function scroller() {
      for (let el = root; el && el !== document.body; el = el.parentElement) {
        const cs = getComputedStyle(el);
        if (/(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight) return el;
      }
      return document.scrollingElement || document.documentElement;
    }

    function tick() {
      if (!st || !st.active) return;
      if (st.scroll) { (st.sc || (st.sc = scroller())).scrollTop += st.scroll; place(st.lx, st.ly); }
      st.raf = global.requestAnimationFrame(tick);
    }

    function end(cancel) {
      if (!st) return;
      const s = st; st = null;
      clearTimeout(s.timer);
      global.cancelAnimationFrame(s.raf);
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancelUp);
      document.removeEventListener("touchmove", blockScroll, { passive: false });
      document.removeEventListener("keydown", esc);
      if (!s.active) return;
      document.documentElement.classList.remove("dragging");
      document.querySelectorAll(".drop-on").forEach(z => z.classList.remove("drop-on"));
      s.ghost.remove();
      const to = !cancel && s.to;
      let index = -1, before = null;
      if (to) {
        before = s.ph.nextElementSibling && s.ph.nextElementSibling.matches(o.items) ? s.ph.nextElementSibling : null;
        s.ph.parentNode.insertBefore(s.item, s.ph);
        index = Array.from(to.querySelectorAll(o.items)).indexOf(s.item);
      }
      s.ph.remove(); s.item.classList.remove("drag-src");
      // le « click » qui suit un glisser ne doit pas ouvrir la fiche
      // (seulement sur l'élément glissé : un clic ailleurs, p. ex. « Bewaren », passe normalement)
      const stop = e => { if (s.item.contains(e.target)) { e.preventDefault(); e.stopPropagation(); } root.removeEventListener("click", stop, { capture: true }); };
      root.addEventListener("click", stop, { capture: true });
      setTimeout(() => root.removeEventListener("click", stop, { capture: true }), 400);
      if (!to) { revert(s); return; }
      Promise.resolve(o.onDrop({ item: s.item, from: s.from, to, index, before })).then(ok => { if (ok === false) revert(s); }, () => revert(s));
    }
    function revert(s) { if (s.home.parent) s.home.parent.insertBefore(s.item, s.home.next && s.home.next.parentNode === s.home.parent ? s.home.next : null); }

    function move(e) {
      if (!st || e.pointerId !== st.id) return;
      st.lx = e.clientX; st.ly = e.clientY;
      const far = Math.abs(e.clientX - st.x) + Math.abs(e.clientY - st.y) > MOVE_START;
      if (!st.active) {
        if (st.touch) { if (far) end(true); return; } // tactile : bouger avant l'appui long = défiler
        if (!far) return;
        begin(); tick();
      }
      e.preventDefault();
      place(e.clientX, e.clientY);
    }
    const up = e => { if (st && e.pointerId === st.id) end(false); };
    const cancelUp = e => { if (st && e.pointerId === st.id) end(true); };
    const esc = e => { if (e.key === "Escape") end(true); };
    const blockScroll = e => { if (st && st.active) e.preventDefault(); };

    function down(e) {
      if (st || (e.pointerType === "mouse" && e.button !== 0)) return;
      const item = e.target.closest(o.items);
      if (!item || !root.contains(item)) return;
      if (o.handle && !e.target.closest(o.handle)) return;
      if (e.target.closest("button, input, select, textarea, label, [data-no-drag]")) return;
      st = { id: e.pointerId, item, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, touch: e.pointerType !== "mouse" && !e.target.closest(".grip"), active: false, // poignée : pas d'appui long
        home: { parent: item.parentNode, next: item.nextElementSibling } };
      document.addEventListener("pointermove", move, { passive: false });
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancelUp);
      document.addEventListener("touchmove", blockScroll, { passive: false });
      document.addEventListener("keydown", esc);
      if (st.touch) st.timer = setTimeout(() => { if (st && !st.active) { begin(); place(st.lx, st.ly); tick(); } }, LONG_PRESS);
    }
    const noNative = e => { if (e.target.closest && e.target.closest(o.items)) e.preventDefault(); };
    const noMenu = e => { if (st) e.preventDefault(); }; // appui long tactile : pas de menu contextuel
    root.addEventListener("pointerdown", down);
    root.addEventListener("dragstart", noNative);
    root.addEventListener("contextmenu", noMenu);
    return () => { end(true); root.removeEventListener("pointerdown", down); root.removeEventListener("dragstart", noNative); root.removeEventListener("contextmenu", noMenu); };
  };
})(window);
