(() => {
  const DATA = window.CE_DATA || { categories: [], videos: [] };
  const SITE = window.CE_SITE || {};
  const byId = Object.fromEntries(DATA.videos.map((v) => [v.id, v]));
  const catById = Object.fromEntries(DATA.categories.map((c) => [c.id, c]));

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // Featured videos first (by their featured number), then the rest in manifest order.
  const videosIn = (catId) => {
    const list = DATA.videos.filter((v) => v.cat === catId);
    const featured = list.filter((v) => v.featured).sort((a, b) => a.featured - b.featured);
    return featured.concat(list.filter((v) => !v.featured));
  };
  const catUrl = (catId) => `work.html?c=${encodeURIComponent(catId)}`;
  const pad2 = (n) => String(n).padStart(2, '0');

  /* ---------------- Cards ---------------- */

  function cardHTML(v) {
    return `<button class="card" type="button" data-id="${v.id}" data-aspect="${v.aspect}" aria-label="Play ${esc(v.title)}">
      <span class="card-media">
        <img src="${v.poster}" alt="" loading="lazy" decoding="async">
        <video muted loop playsinline preload="none" data-src="${v.preview}" aria-hidden="true" tabindex="-1"></video>
      </span>
      <span class="card-dur">${esc(v.duration)}</span>
      <span class="card-play" aria-hidden="true"></span>
      <span class="card-info"><span class="card-tag">${esc(v.tag)}</span><span class="card-title">${esc(v.title)}</span></span>
    </button>`;
  }

  function startPreview(card) {
    if (reduceMotion) return;
    const video = $('video', card);
    if (!video.src) video.src = video.dataset.src;
    const p = video.play();
    if (p) p.catch(() => {});
  }

  function stopPreview(card) {
    const video = $('video', card);
    if (!video.src) return;
    video.pause();
    card.classList.remove('playing');
  }

  // On touch screens previews play while a card is mostly on screen.
  const touchObserver = canHover
    ? null
    : new IntersectionObserver(
        (entries) => entries.forEach((e) => (e.intersectionRatio >= 0.6 ? startPreview(e.target) : stopPreview(e.target))),
        { threshold: [0, 0.6] },
      );

  function wireCards(container, listIds) {
    $$('.card', container).forEach((card) => {
      const video = $('video', card);
      video.addEventListener('playing', () => card.classList.add('playing'));
      card.addEventListener('click', () => openLightbox(card.dataset.id, listIds, card));
      if (canHover) {
        card.addEventListener('pointerenter', () => startPreview(card));
        card.addEventListener('pointerleave', () => stopPreview(card));
        card.addEventListener('focus', () => startPreview(card));
        card.addEventListener('blur', () => stopPreview(card));
      } else {
        touchObserver.observe(card);
      }
    });
  }

  /* ---------------- Justified layout ----------------
     Cards keep their real aspect ratio; each row is scaled so it fills the width exactly. */

  function justify(container, { target, max = Infinity, single = false }) {
    const cards = $$('.card', container);
    const W = container.clientWidth;
    if (!W || !cards.length) return;
    const gap = parseFloat(getComputedStyle(container).columnGap) || 0;
    const aspect = (c) => parseFloat(c.dataset.aspect) || 1.7778;

    const place = (row, h) => {
      row.forEach((c) => {
        const w = Math.floor(aspect(c) * h);
        c.style.width = `${w}px`;
        c.style.height = `${Math.round(h)}px`;
        c.classList.toggle('tiny', w < 150);
      });
    };
    const heightFor = (row) => (W - gap * (row.length - 1)) / row.reduce((s, c) => s + aspect(c), 0);

    if (single) {
      place(cards, Math.min(max, heightFor(cards)));
      return;
    }

    let row = [];
    for (const card of cards) {
      const next = row.concat(card);
      const widthAtTarget = next.reduce((s, c) => s + aspect(c) * target, 0) + gap * (next.length - 1);
      if (widthAtTarget < W) {
        row = next;
        continue;
      }
      // Row is full: keep whichever split lands closer to the target height.
      const hWith = heightFor(next);
      const hWithout = row.length ? heightFor(row) : Infinity;
      if (Math.abs(hWith - target) <= Math.abs(hWithout - target)) {
        place(next, hWith);
        row = [];
      } else {
        place(row, hWithout);
        row = [card];
      }
    }
    if (row.length) place(row, Math.min(target, max, heightFor(row)));
  }

  const layouts = [];
  function registerLayout(container, optsFn) {
    const run = () => justify(container, optsFn(container.clientWidth));
    layouts.push(run);
    run();
  }
  let resizeFrame = 0;
  const relayout = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => layouts.forEach((fn) => fn()));
  };
  window.addEventListener('resize', relayout);
  if (document.fonts) document.fonts.ready.then(relayout);

  const galleryTarget = (w) => (w >= 1000 ? 340 : w >= 700 ? 300 : 280);

  /* ---------------- Lightbox ---------------- */

  const lb = {
    root: $('#lightbox'),
    stage: $('#lb-stage'),
    title: $('#lb-title'),
    tag: $('#lb-tag'),
    list: [],
    index: 0,
    returnFocus: null,
  };

  function openLightbox(id, listIds, fromEl) {
    if (!byId[id] || !lb.root) return;
    lb.list = listIds && listIds.includes(id) ? listIds : [id];
    lb.index = lb.list.indexOf(id);
    lb.returnFocus = fromEl || document.activeElement;
    $$('.card.playing').forEach(stopPreview);
    lb.root.hidden = false;
    document.body.classList.add('lb-open');
    renderLightbox();
    $('[data-close].lb-btn', lb.root).focus({ preventScroll: true });
  }

  function renderLightbox() {
    const v = byId[lb.list[lb.index]];
    const cat = catById[v.cat];
    lb.stage.parentElement.style.setProperty('--a', v.aspect);
    lb.stage.innerHTML = '';

    if (v.youtube) {
      const iframe = document.createElement('iframe');
      iframe.src = `https://www.youtube-nocookie.com/embed/${v.youtube}?autoplay=1&rel=0&modestbranding=1&playsinline=1`;
      iframe.title = v.title;
      iframe.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
      iframe.allowFullscreen = true;
      lb.stage.append(iframe);
    } else {
      const video = document.createElement('video');
      video.controls = true;
      video.autoplay = true;
      video.playsInline = true;
      video.poster = v.poster;
      video.src = v.full;
      // If the full-watch clip can't load, loop the preview instead.
      video.addEventListener('error', () => {
        if (video.dataset.fallback) return;
        video.dataset.fallback = '1';
        video.src = v.preview;
        video.loop = true;
        video.play().catch(() => {});
        const note = document.createElement('span');
        note.className = 'lb-note';
        note.textContent = 'Preview — full video coming soon';
        lb.stage.append(note);
      }, { once: false });
      lb.stage.append(video);
    }

    lb.title.textContent = v.title;
    lb.tag.textContent = `${cat ? cat.title : ''} · ${v.duration}`;
    const multi = lb.list.length > 1;
    $$('[data-prev], [data-next]', lb.root).forEach((b) => (b.hidden = !multi));
    history.replaceState(null, '', `${location.pathname}${location.search}#v=${v.id}`);
  }

  function step(delta) {
    if (lb.list.length < 2) return;
    lb.index = (lb.index + delta + lb.list.length) % lb.list.length;
    renderLightbox();
  }

  function closeLightbox() {
    if (!lb.root || lb.root.hidden) return;
    lb.stage.innerHTML = '';
    lb.root.hidden = true;
    document.body.classList.remove('lb-open');
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    if (lb.returnFocus && document.contains(lb.returnFocus)) lb.returnFocus.focus({ preventScroll: true });
  }

  if (lb.root) {
    lb.root.addEventListener('click', (e) => {
      if (e.target.closest('[data-close]')) closeLightbox();
      else if (e.target.closest('[data-prev]')) step(-1);
      else if (e.target.closest('[data-next]')) step(1);
    });
    document.addEventListener('keydown', (e) => {
      if (lb.root.hidden) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowRight' && e.target.tagName !== 'VIDEO') step(1);
      else if (e.key === 'ArrowLeft' && e.target.tagName !== 'VIDEO') step(-1);
      else if (e.key === 'Tab') {
        const focusables = $$('button:not([hidden]), video, iframe', lb.root);
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  }

  function openFromHash() {
    const m = location.hash.match(/^#v=([\w-]+)/);
    if (!m || !byId[m[1]]) return;
    const v = byId[m[1]];
    openLightbox(v.id, videosIn(v.cat).map((x) => x.id));
  }

  /* ---------------- Shared bits ---------------- */

  function renderChips(container, activeId, hrefFor) {
    if (!container) return;
    container.innerHTML = DATA.categories
      .map((c) => {
        const n = DATA.videos.filter((v) => v.cat === c.id).length;
        const current = c.id === activeId ? ' aria-current="page"' : '';
        return `<a class="chip" href="${hrefFor(c.id)}"${current}>${esc(c.title)}<small>${n}</small></a>`;
      })
      .join('');
  }

  const whatsappUrl = (text) => {
    const number = String((SITE.contact || {}).whatsapp || '').replace(/\D/g, '');
    if (!number) return '';
    return `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
  };

  function renderContact() {
    const box = $('#contact-links');
    if (!box) return;
    const c = SITE.contact || {};
    // A null href is the "Contact me" button that opens the form; it leads as the accent button.
    const links = [['Contact me', null]];
    if (c.email) links.push(['Email me', `mailto:${c.email}`]);
    if (c.whatsapp) links.push(['WhatsApp', whatsappUrl()]);
    if (c.instagram) links.push(['Instagram', c.instagram]);
    if (c.linkedin) links.push(['LinkedIn', c.linkedin]);
    if (c.youtube) links.push(['YouTube', c.youtube]);
    if (c.x) links.push(['X', c.x]);
    box.innerHTML = links
      .map(([label, href], i) => {
        const cls = `btn ${i ? 'btn-ghost' : 'btn-accent'}`;
        if (!href) return `<button class="${cls}" type="button" data-contact>${label}</button>`;
        const external = href.startsWith('mailto:') ? '' : ' target="_blank" rel="noopener"';
        return `<a class="${cls}" href="${esc(href)}"${external}>${label}</a>`;
      })
      .join('');
  }

  /* ---------------- Contact form ----------------
     Messages go to /api/enquiry (src/worker.js), which emails them to Chitwan with reminders.
     If sending fails, the visitor can pass the same message to WhatsApp instead. */

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let contactDialog = null;
  let contactReturnFocus = null;

  function contactDialogHTML() {
    const c = SITE.contact || {};
    const alt = [];
    if (c.whatsapp) alt.push(['Contact on WhatsApp', whatsappUrl()]);
    if (c.x) alt.push(['Contact on X', c.x]);
    return `<div class="cd-body">
        <button class="lb-btn cd-close" type="button" data-close aria-label="Close">✕</button>
        <form class="cd-form">
          <p class="eyebrow">Contact me</p>
          <h2 id="cd-title">Tell me about your project</h2>
          <p class="cd-lead">Send a quick note and it lands straight in my inbox.</p>
          <label class="field"><span>Your name</span>
            <input name="name" required maxlength="100" autocomplete="name"></label>
          <label class="field"><span>Email or phone number</span>
            <input name="contact" required maxlength="150" autocomplete="email" placeholder="Email, or phone with country code"></label>
          <label class="field"><span>What do you need?</span>
            <textarea name="message" rows="5" required maxlength="4000" placeholder="Type of video, length, deadline, budget, links to footage…"></textarea></label>
          <input class="cd-trap" type="checkbox" name="botcheck" tabindex="-1" autocomplete="off" aria-hidden="true">
          <button class="btn btn-accent cd-send" type="submit">Send message</button>
          <p class="cd-status" role="status" aria-live="polite"></p>
        </form>
        <div class="cd-done" hidden>
          <span class="cd-check" aria-hidden="true">✓</span>
          <h2>Message sent</h2>
          <p class="cd-lead"></p>
          <button class="btn btn-ghost" type="button" data-close>Close</button>
        </div>
      </div>
      ${alt.length
        ? `<div class="cd-alt"><span>Prefer to chat?</span>${alt
            .map(([label, href]) => `<a class="btn btn-ghost btn-small" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>`)
            .join('')}</div>`
        : ''}`;
  }

  function resetContact() {
    const form = $('.cd-form', contactDialog);
    form.reset();
    form.hidden = false;
    $('.cd-done', contactDialog).hidden = true;
    $('.cd-status', form).textContent = '';
  }

  async function sendContact(form) {
    const status = $('.cd-status', form);
    const send = $('.cd-send', form);
    const contactInput = form.elements.contact;
    const name = form.elements.name.value.trim();
    const contact = contactInput.value.trim();
    const message = form.elements.message.value.trim();
    const isEmail = EMAIL_RE.test(contact);

    if (!isEmail && contact.replace(/\D/g, '').length < 7) {
      contactInput.setCustomValidity('Please enter an email address or a phone number.');
      contactInput.reportValidity();
      return;
    }
    if (form.elements.botcheck.checked) return;

    const viaWhatsApp = whatsappUrl(`Hi Chitwan, I'm ${name}.\n\n${message}\n\nYou can reach me at: ${contact}`);
    status.classList.remove('error');
    send.disabled = true;
    send.textContent = 'Sending…';
    status.textContent = '';
    try {
      const res = await fetch('/api/enquiry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name, contact, message, page: location.pathname }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      $('.cd-done .cd-lead', contactDialog).textContent = `Thanks, ${name}. I'll get back to you soon.`;
      form.hidden = true;
      $('.cd-done', contactDialog).hidden = false;
      $('.cd-done [data-close]', contactDialog).focus();
    } catch {
      status.classList.add('error');
      status.innerHTML = viaWhatsApp
        ? `Couldn't send right now. <a href="${esc(viaWhatsApp)}" target="_blank" rel="noopener">Send it on WhatsApp instead</a>.`
        : "Couldn't send right now. Please try again in a minute.";
    } finally {
      send.disabled = false;
      send.textContent = 'Send message';
    }
  }

  function afterContactClosed() {
    if (contactDialog.open) return;
    document.body.classList.remove('lb-open');
    if (contactReturnFocus && document.contains(contactReturnFocus)) contactReturnFocus.focus({ preventScroll: true });
    contactReturnFocus = null;
  }

  function openContact(fromEl) {
    if (!contactDialog) {
      contactDialog = document.createElement('dialog');
      contactDialog.className = 'contact-dialog';
      contactDialog.setAttribute('aria-labelledby', 'cd-title');
      contactDialog.innerHTML = contactDialogHTML();
      document.body.append(contactDialog);

      const form = $('.cd-form', contactDialog);
      form.elements.contact.addEventListener('input', (e) => e.target.setCustomValidity(''));
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        sendContact(form);
      });
      // Clicks on the dimmed backdrop land on the dialog element itself.
      contactDialog.addEventListener('click', (e) => {
        if (e.target !== contactDialog && !e.target.closest('[data-close]')) return;
        contactDialog.close();
        afterContactClosed();
      });
      // Esc closes natively; "close" arrives a moment later, so it is ignored if the form was reopened since.
      contactDialog.addEventListener('close', afterContactClosed);
    }
    // After a sent message, start fresh; an unsent draft is kept.
    if (!$('.cd-done', contactDialog).hidden) resetContact();
    contactReturnFocus = fromEl;
    $$('.card.playing').forEach(stopPreview);
    contactDialog.showModal();
    document.body.classList.add('lb-open');
    if (canHover) contactDialog.querySelector('[name="name"]').focus();
  }

  function renderSocialProof() {
    const reviews = $('#reviews');
    const list = SITE.testimonials || [];
    if (reviews && list.length) {
      $('.review-grid', reviews).innerHTML = list
        .map((t) => `<figure class="review reveal"><blockquote>${esc(t.quote)}</blockquote><figcaption><strong>${esc(t.name)}</strong>${esc(t.role || '')}</figcaption></figure>`)
        .join('');
      reviews.hidden = false;
    }
    const clients = $('#clients');
    if (clients && (SITE.clients || []).length) {
      $('.client-list', clients).innerHTML = SITE.clients.map((n) => `<li>${esc(n)}</li>`).join('');
      clients.hidden = false;
    }
  }

  function initChrome() {
    const nav = $('.nav');
    const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 24);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    $$('[data-year]').forEach((n) => (n.textContent = new Date().getFullYear()));
    renderContact();
    renderSocialProof();

    // "Let's talk", "Contact me" and friends open the form; without <dialog> support they just scroll to #contact.
    if (typeof HTMLDialogElement === 'function') {
      document.addEventListener('click', (e) => {
        const trigger = e.target.closest('[data-contact]');
        if (!trigger) return;
        e.preventDefault();
        openContact(trigger);
      });
    }

    const revealObserver = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          revealObserver.unobserve(e.target);
        }
      }),
      { rootMargin: '0px 0px -8% 0px' },
    );
    $$('.reveal').forEach((n) => revealObserver.observe(n));
  }

  /* ---------------- Hero collage ---------------- */

  // Desktop slots around the headline: x %, y %, size, rotation (deg), parallax depth, preferred shape.
  // Sizes are equal-area, so vertical and horizontal clips carry the same visual weight.
  const SLOTS = [
    [8, 22, 19, -5, 1.0, 'l'], [15, 50, 16, 4, 0.6, 'p'], [7, 74, 18, 3, 0.9, 'l'], [19, 89, 14, -4, 0.5, 'l'],
    [92, 20, 18, 4, 0.8, 'l'], [85, 48, 16, -3, 0.6, 'p'], [93, 73, 17, 5, 1.0, 'l'], [80, 89, 14, 3, 0.5, 'l'],
    [31, 16, 12, 3, 0.4, 'l'], [69, 16, 12, -4, 0.4, 'l'], [34, 90, 12, -3, 0.5, 'p'], [66, 90, 12, 4, 0.5, 'p'],
    [-1, 48, 15, 7, 1.2, 'p'], [101, 47, 15, -7, 1.2, 'p'], [2, 97, 14, 4, 0.8, 'l'], [98, 98, 14, -4, 0.8, 'l'],
  ];
  const STRIP_COUNT = 6;
  const scatterMQ = window.matchMedia('(min-width: 1000px) and (min-height: 620px)');

  /* ---------------- Hero layout options ----------------
     The homepage normally shows the original first screen. /option2 – /option7 (or the footer's
     "Layout options" switcher) swap in another style for the first screen only, to compare layouts. */

  const HERO_LAYOUTS = [
    { id: 'original', name: 'Original' },
    { id: 'tickers', name: 'Ticker rows' },
    { id: 'columns', name: 'Side columns' },
    { id: 'mosaic', name: 'Mosaic frame' },
    { id: 'orbit', name: 'Orbit' },
    { id: 'coverflow', name: 'Split + carousel' },
    { id: 'wall', name: '3D floor' },
  ];
  let heroOption = 1;
  let stopAltHero = null;

  function optionFromUrl() {
    const m = location.pathname.match(/\/option(\d+)\/?$/) || location.search.match(/[?&]option=(\d+)/);
    const n = m ? Number(m[1]) : 1;
    return n >= 1 && n <= HERO_LAYOUTS.length ? n : 1;
  }

  // Builds one of the alternative first screens around .hero-inner. Returns a function that stops its timers.
  function buildAltHero(hero, layout, tiles) {
    const inner = $('.hero-inner', hero);
    const clip = (t, { cls = '', style = '' } = {}) => {
      const media = reduceMotion
        ? `<img src="${t.poster}" alt="">`
        : `<video src="${t.src}" poster="${t.poster}" muted loop playsinline autoplay preload="auto"></video>`;
      return `<div class="hclip ${cls}" data-id="${t.id}" style="--a:${t.aspect};${style}">${media}</div>`;
    };
    const twice = (list) => list.concat(list); // seamless loops slide by exactly half
    const stops = [];

    if (layout === 'tickers') {
      const row = (list, cls) => `<div class="alt alt-ticker ${cls}"><div class="alt-track">${twice(list).map((t) => clip(t)).join('')}</div></div>`;
      inner.insertAdjacentHTML('beforebegin', row(tiles.filter((_, i) => i % 2 === 0), ''));
      inner.insertAdjacentHTML('afterend', row(tiles.filter((_, i) => i % 2 === 1), 'rev'));
    }

    if (layout === 'columns') {
      const cols = [[], [], [], []];
      tiles.forEach((t, i) => cols[i % 4].push(t));
      inner.insertAdjacentHTML('afterend', `<div class="alt alt-cols">${cols
        .map((list, k) => `<div class="alt-col${k % 2 ? ' down' : ''}" style="--speed:${32 + k * 6}s"><div class="alt-track">${twice(list).map((t) => clip(t)).join('')}</div></div>`)
        .join('')}</div>`);
    }

    if (layout === 'mosaic') {
      const spots = [[1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6], [2, 1], [3, 1], [2, 6], [3, 6], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6]];
      inner.insertAdjacentHTML('afterend', spots
        .map(([r, c], i) => clip(tiles[i % tiles.length], { cls: `alt alt-cell${i >= 9 ? ' extra' : ''}`, style: `--r:${r};--c:${c}` }))
        .join(''));
    }

    if (layout === 'orbit') {
      const list = tiles.slice(0, hero.clientWidth < 700 ? 16 : 12);
      inner.insertAdjacentHTML('beforebegin', `<div class="alt alt-orbit">${list.map((t) => clip(t)).join('')}</div>`);
      const cards = $$('.alt-orbit .hclip', hero);
      const MAX_SCALE = 1.15;
      let running = true;
      const frame = (now) => {
        if (!running) return;
        const W = hero.clientWidth;
        const base = W < 700 ? W * 0.28 : Math.min(190, Math.max(120, W * 0.1));
        const size = (aspect) => {
          const w = aspect >= 1 ? base : base * 0.5;
          return [w, w / aspect];
        };
        // A path around the headline, big enough that no card can touch the text: a rounded box on
        // wide screens, an oval on phones (wider than the screen, so the arcs above and below show).
        const copyBox = inner.getBoundingClientRect();
        const heroBox = hero.getBoundingClientRect();
        const halfW = Math.max(...list.map((t) => size(t.aspect)[0])) * MAX_SCALE / 2;
        const halfH = Math.max(...list.map((t) => size(t.aspect)[1])) * MAX_SCALE / 2;
        const p = W < 700 ? 2 : 4; // superellipse power: 2 = oval, 4 = rounded box
        const k = 2 ** (1 / p); // the text box plus card margins fits exactly inside the path
        const rx = (copyBox.width / 2 + halfW + 16) * k;
        const ry = (copyBox.height / 2 + halfH + 16) * k;
        const cx = copyBox.left - heroBox.left + copyBox.width / 2;
        const cy = copyBox.top - heroBox.top + copyBox.height / 2;
        const spin = reduceMotion ? 0 : now * 0.0001;
        cards.forEach((card, i) => {
          const a = spin + (i / cards.length) * Math.PI * 2;
          const cos = Math.cos(a);
          const sin = Math.sin(a);
          const depth = (sin + 1) / 2; // 0 = top (far), 1 = bottom (near)
          const [w, h] = size(list[i].aspect);
          const x = cx + rx * Math.sign(cos) * Math.abs(cos) ** (2 / p);
          const y = cy + ry * Math.sign(sin) * Math.abs(sin) ** (2 / p);
          card.style.width = `${w}px`;
          card.style.height = `${h}px`;
          card.style.transform = `translate(${x - w / 2}px, ${y - h / 2}px) scale(${(0.7 + (MAX_SCALE - 0.7) * depth).toFixed(3)})`;
          card.style.opacity = (0.45 + 0.55 * depth).toFixed(2);
          card.style.zIndex = Math.round(depth * 10);
        });
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
      stops.push(() => { running = false; });
    }

    if (layout === 'coverflow') {
      inner.insertAdjacentHTML('afterend', `<div class="alt alt-flow">${tiles.slice(0, 11).map((t) => clip(t)).join('')}</div>`);
      const cards = $$('.alt-flow .hclip', hero);
      let current = 0;
      const place = () => {
        const n = cards.length;
        cards.forEach((card, i) => {
          let k = i - current;
          if (k > n / 2) k -= n;
          if (k < -n / 2) k += n;
          const d = Math.abs(k);
          card.style.transform = `translate(-50%, -50%) translateX(${k * 52}%) translateZ(${-d * 160}px) rotateY(${k * -32}deg)`;
          card.style.opacity = d > 3 ? 0 : (1 - d * 0.16).toFixed(2);
          card.style.filter = `brightness(${(1 - d * 0.22).toFixed(2)})`;
          card.style.zIndex = 20 - d;
        });
      };
      place();
      if (!reduceMotion) {
        const timer = setInterval(() => { current = (current + 1) % cards.length; place(); }, 2600);
        stops.push(() => clearInterval(timer));
      }
    }

    if (layout === 'wall') {
      hero.insertAdjacentHTML('beforeend', '<div class="alt alt-wall"><div class="alt-plane"><div class="alt-grid"></div></div></div>');
      const wall = $('.alt-wall', hero);
      const grid = $('.alt-grid', hero);
      // Each half must be whole rows (6 across on laptops, 4 on phones) so the loop has no jump.
      const cols = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const half = Array.from({ length: Math.ceil(16 / cols) * cols }, (_, i) => tiles[i % tiles.length]);
      grid.innerHTML = twice(half).map((t) => clip(t)).join('');
      // The floor starts just under the buttons, however tall the headline wraps.
      const place = () => { wall.style.top = `${inner.getBoundingClientRect().bottom - hero.getBoundingClientRect().top + 20}px`; };
      place();
      window.addEventListener('resize', place);
      if (document.fonts) document.fonts.ready.then(place);
      stops.push(() => window.removeEventListener('resize', place));
    }

    return () => stops.forEach((stop) => stop());
  }

  // Screen sizes for previewing the site as another device, inside this window.
  const DEVICES = {
    desktop: { w: 1440, h: 860, label: 'Desktop' },
    tablet: { w: 820, h: 1180, label: 'Tablet' },
    phone: { w: 390, h: 844, label: 'Phone' },
  };
  const screenKind = () => (window.innerWidth >= 1000 ? 'desktop' : window.innerWidth >= 700 ? 'tablet' : 'phone');

  // The footer's "Layout options" button (and any /optionN link) shows a bar for flipping between styles
  // and for viewing the page as a desktop, tablet or phone. ?view=phone opens straight into that view.
  function initLayoutOptions() {
    const hero = $('#hero');
    if (!hero) return;
    const trigger = $('[data-layout-options]');
    // Inside a device preview the page is shown plain, without its own switcher.
    if (window.self !== window.top) {
      if (trigger) trigger.remove();
      return;
    }
    const base = location.pathname.replace(/option\d+\/?$/, '').replace(/index\.html$/, '');
    const pageUrl = (n) => (n === 1 ? base : `${base}option${n}`);
    let view = new URLSearchParams(location.search).get('view');
    if (!DEVICES[view]) view = screenKind();
    let bar = null;
    let viewer = null;
    const previewing = () => viewer && !viewer.hidden;

    const syncUrl = () => history.replaceState(null, '', pageUrl(heroOption) + (view === screenKind() ? '' : `?view=${view}`));
    const update = () => {
      const opt = HERO_LAYOUTS[heroOption - 1];
      $('.sb-name', bar).innerHTML = `<small>Layout ${heroOption}</small>${esc(opt.name)}`;
      $$('.sb-btns button', bar).forEach((b, i) => b.setAttribute('aria-pressed', String(i + 1 === heroOption)));
      $$('.sb-views button', bar).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    };

    // The device frame: the same page in an iframe at that device's size, scaled to fit above the bar.
    const fitViewer = () => {
      if (!previewing()) return;
      const d = DEVICES[view];
      const room = bar.offsetHeight + 40;
      const scale = Math.min(1, (window.innerWidth - 32) / d.w, (window.innerHeight - room - 44) / d.h);
      const frame = $('iframe', viewer);
      frame.style.width = `${d.w}px`;
      frame.style.height = `${d.h}px`;
      frame.style.transform = `scale(${scale})`;
      $('.dv-frame', viewer).style.width = `${Math.round(d.w * scale)}px`;
      $('.dv-frame', viewer).style.height = `${Math.round(d.h * scale)}px`;
      viewer.style.paddingBottom = `${room}px`;
      $('.dv-label', viewer).textContent = `${d.label} view · ${d.w} × ${d.h}${scale < 1 ? ` · shown at ${Math.round(scale * 100)}%` : ''}`;
    };
    const openViewer = () => {
      if (!viewer) {
        viewer = document.createElement('div');
        viewer.className = 'device-view';
        viewer.innerHTML = '<div class="dv-frame"><iframe title="Device preview"></iframe></div><p class="dv-label"></p>';
        document.body.append(viewer);
        window.addEventListener('resize', fitViewer);
      }
      const frame = $('iframe', viewer);
      const src = new URL(pageUrl(heroOption), location.href).href;
      // A new layout or a new device size loads the page fresh, so every style is built for that size.
      if (frame.src !== src || viewer.dataset.device !== view || viewer.hidden) frame.src = src;
      viewer.hidden = false;
      viewer.dataset.device = view;
      document.documentElement.classList.add('device-preview');
      $$('video', hero).forEach((v) => v.pause()); // the page behind the frame stays still
      fitViewer();
    };
    const closeViewer = () => {
      if (!previewing()) return;
      viewer.hidden = true;
      $('iframe', viewer).src = 'about:blank';
      document.documentElement.classList.remove('device-preview');
      renderHero(); // the page behind may have missed layout changes while the frame was open
      $$('video', hero).forEach((v) => v.play().catch(() => {}));
    };

    const choose = (n) => {
      heroOption = n;
      if (previewing()) openViewer();
      else {
        renderHero();
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      }
      update();
      syncUrl();
    };
    const chooseView = (v) => {
      view = v;
      if (view === screenKind()) closeViewer();
      else openViewer();
      update();
      syncUrl();
    };
    const show = () => {
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'style-bar';
        bar.setAttribute('role', 'group');
        bar.setAttribute('aria-label', 'Layout options');
        bar.innerHTML = `<span class="sb-name"></span><div class="sb-btns">${HERO_LAYOUTS
          .map((o, i) => `<button type="button" title="${esc(o.name)}">${i + 1}</button>`)
          .join('')}</div><div class="sb-views">${Object.entries(DEVICES)
          .map(([key, d]) => `<button type="button" data-view="${key}">${d.label}</button>`)
          .join('')}</div><button class="sb-close" type="button" aria-label="Hide layout options">✕</button>`;
        document.body.append(bar);
        $$('.sb-btns button', bar).forEach((b, i) => b.addEventListener('click', () => choose(i + 1)));
        $$('.sb-views button', bar).forEach((b) => b.addEventListener('click', () => chooseView(b.dataset.view)));
        $('.sb-close', bar).addEventListener('click', () => {
          view = screenKind();
          closeViewer();
          bar.hidden = true;
          syncUrl();
        });
      }
      bar.hidden = false;
      update();
    };

    if (trigger) {
      trigger.addEventListener('click', () => {
        show();
        window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
      });
    }
    if (heroOption > 1 || view !== screenKind()) show();
    if (view !== screenKind()) openViewer();
  }

  function tileHTML(t, style) {
    const v = byId[t.id];
    const media = reduceMotion
      ? `<img src="${t.poster}" alt="">`
      : `<video src="${t.src}" poster="${t.poster}" muted loop playsinline autoplay preload="auto"></video>`;
    return `<button class="tile" type="button" tabindex="-1" data-id="${t.id}" title="${esc(v ? v.title : '')}" style="${style}"><span class="tile-inner">${media}</span></button>`;
  }

  function assignSlots(tiles) {
    const used = new Set();
    const take = (test) => {
      const i = tiles.findIndex((t, k) => !used.has(k) && test(t));
      if (i >= 0) used.add(i);
      return i;
    };
    return SLOTS.map((slot) => {
      let i = take((t) => (slot[5] === 'p' ? t.aspect < 1 : t.aspect >= 1));
      if (i < 0) i = take(() => true);
      return i < 0 ? null : [slot, tiles[i]];
    }).filter(Boolean);
  }

  function renderHero() {
    const hero = $('#hero');
    const collage = $('#hero-collage');
    const strips = $$('.hero-strip', hero);
    const tiles = DATA.tiles || [];
    const scatter = scatterMQ.matches;
    hero.classList.remove('ready');

    if (stopAltHero) stopAltHero();
    stopAltHero = null;
    $$('.alt', hero).forEach((n) => n.remove());
    const layout = HERO_LAYOUTS[heroOption - 1].id;
    if (layout !== 'original') {
      collage.innerHTML = '';
      strips.forEach((s) => (s.innerHTML = ''));
      hero.classList.remove('strips');
      hero.dataset.layout = layout;
      stopAltHero = buildAltHero(hero, layout, tiles);
      hero.classList.add('ready');
      return;
    }
    delete hero.dataset.layout;
    hero.classList.toggle('strips', !scatter);

    if (scatter) {
      strips.forEach((s) => (s.innerHTML = ''));
      collage.innerHTML = assignSlots(tiles)
        .map(([[x, y, s, r, d], t], i) => {
          const k = Math.sqrt(t.aspect);
          const style = `--x:${x}%;--y:${y}%;--w:${(s * k).toFixed(2)};--h:${(s / k).toFixed(2)};--r:${r}deg;--d:${d};`
            + `--delay:${(0.15 + i * 0.06).toFixed(2)}s;--float:${(3.2 + (i % 5) * 0.55).toFixed(2)}s`;
          return tileHTML(t, style);
        })
        .join('');
    } else {
      collage.innerHTML = '';
      strips.forEach((strip, n) => {
        const mine = tiles.filter((_, i) => i % 2 === n).slice(0, STRIP_COUNT);
        strip.innerHTML = `<div class="strip-track">${mine
          .map((t, i) => tileHTML(t, `--a:${t.aspect};--delay:${(0.1 + i * 0.06).toFixed(2)}s`))
          .join('')}</div>`;
      });
      requestAnimationFrame(updateDrift);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.add('ready')));
  }

  // Each strip slides back and forth across exactly its overflow.
  function updateDrift() {
    $$('#hero .hero-strip').forEach((strip) => {
      const track = $('.strip-track', strip);
      if (!track) return;
      const distance = Math.max(0, track.scrollWidth - strip.clientWidth);
      track.style.setProperty('--drift', `${-distance}px`);
      track.style.setProperty('--drift-time', `${Math.min(60, Math.max(16, distance / 14)).toFixed(1)}s`);
    });
  }

  function initHero() {
    const hero = $('#hero');
    if (!hero) return;
    const collage = $('#hero-collage');
    renderHero();
    scatterMQ.addEventListener('change', renderHero);
    window.addEventListener('resize', () => scatterMQ.matches || updateDrift());

    hero.addEventListener('click', (e) => {
      const tile = e.target.closest('.tile, .hclip');
      if (!tile) return;
      const v = byId[tile.dataset.id];
      openLightbox(v.id, videosIn(v.cat).map((x) => x.id), tile);
    });

    // Only play the clips while the hero is on screen.
    new IntersectionObserver(([entry]) => {
      $$('video', hero).forEach((v) => (entry.isIntersecting ? v.play().catch(() => {}) : v.pause()));
    }, { threshold: 0.05 }).observe(hero);

    const hint = $('.scroll-hint', hero);
    const onScroll = () => {
      hint.classList.toggle('gone', window.scrollY > 60);
      if (!reduceMotion) collage.style.setProperty('--sy', Math.min(1.5, window.scrollY / window.innerHeight).toFixed(3));
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    // Tiles lean away from the pointer a little, deeper tiles more.
    if (canHover && !reduceMotion) {
      let tx = 0, ty = 0, cx = 0, cy = 0, frame = 0;
      const tick = () => {
        cx += (tx - cx) * 0.08;
        cy += (ty - cy) * 0.08;
        collage.style.setProperty('--mx', cx.toFixed(3));
        collage.style.setProperty('--my', cy.toFixed(3));
        frame = Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(tick) : 0;
      };
      hero.addEventListener('pointermove', (e) => {
        const r = hero.getBoundingClientRect();
        tx = ((e.clientX - r.left) / r.width) * 2 - 1;
        ty = ((e.clientY - r.top) / r.height) * 2 - 1;
        if (!frame) frame = requestAnimationFrame(tick);
      });
    }
  }

  /* ---------------- Pages ---------------- */

  function initHome() {
    heroOption = optionFromUrl();
    initHero();
    initLayoutOptions();

    const stats = $('#work-stats');
    if (stats) {
      stats.innerHTML = `
        <li><strong>${DATA.videos.length}</strong><span>edits on show</span></li>
        <li><strong>${DATA.categories.length}</strong><span>formats</span></li>
        <li><strong>4K</strong><span>finishing</span></li>`;
    }

    const marquee = $('#marquee');
    if (marquee) {
      const items = DATA.categories.map((c) => `<span>${esc(c.title)}</span>`).join('');
      marquee.innerHTML = items + items;
    }

    renderChips($('#cat-chips'), null, (id) => `#cat-${id}`);

    const host = $('#categories');
    host.innerHTML = DATA.categories
      .map((c, i) => {
        const total = DATA.videos.filter((v) => v.cat === c.id).length;
        const more = total > 3
          ? `<a class="more-link" href="${catUrl(c.id)}">View all ${total} <span aria-hidden="true">→</span></a>`
          : `<a class="more-link" href="${catUrl(c.id)}">Open category <span aria-hidden="true">→</span></a>`;
        return `<section class="cat reveal" id="cat-${c.id}" aria-labelledby="h-${c.id}">
          <header class="cat-head">
            <span class="cat-num">${pad2(i + 1)}</span>
            <div><h2 id="h-${c.id}">${esc(c.title)}</h2><p>${esc(c.blurb)}</p></div>
            ${more}
          </header>
          <div class="row" data-cat="${c.id}"></div>
          ${total > 3 ? `<a class="more-link more-mobile" href="${catUrl(c.id)}">View all ${total} <span aria-hidden="true">→</span></a>` : ''}
        </section>`;
      })
      .join('');

    DATA.categories.forEach((c) => {
      const row = $(`.row[data-cat="${c.id}"]`, host);
      const all = videosIn(c.id);
      const shown = all.slice(0, 3);
      row.innerHTML = shown.map(cardHTML).join('');
      row.classList.add('center');
      wireCards(row, all.map((v) => v.id));
      registerLayout(row, (w) => (w >= 700 ? { single: true, max: 560 } : { target: 280 }));
    });

    initChrome();
    openFromHash();
  }

  function initCategory() {
    const params = new URLSearchParams(location.search);
    const cat = catById[params.get('c')] || DATA.categories[0];
    if (!cat) return;
    const list = videosIn(cat.id);

    document.title = `${cat.title} | ${SITE.name || 'Chitwan Edits'}`;
    $('#cat-title').textContent = cat.title;
    $('#cat-blurb').textContent = cat.blurb;
    $('#cat-count').textContent = `${list.length} ${list.length === 1 ? 'video' : 'videos'}`;
    renderChips($('#cat-chips'), cat.id, catUrl);

    const gallery = $('#gallery');
    gallery.innerHTML = list.map(cardHTML).join('');
    wireCards(gallery, list.map((v) => v.id));
    registerLayout(gallery, (w) => ({ target: galleryTarget(w) }));

    initChrome();
    openFromHash();
  }

  if (document.body.dataset.page === 'category') initCategory();
  else initHome();
  window.addEventListener('hashchange', openFromHash);
})();
