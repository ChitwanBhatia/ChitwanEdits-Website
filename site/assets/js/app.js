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
      video.src = v.local;
      // No YouTube link and no local original (e.g. once deployed): loop the preview instead.
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

  function renderContact() {
    const box = $('#contact-links');
    if (!box) return;
    const c = SITE.contact || {};
    const links = [];
    if (c.email) links.push(`<a class="btn btn-accent" href="mailto:${esc(c.email)}">Email me</a>`);
    if (c.whatsapp) links.push(`<a class="btn btn-ghost" href="https://wa.me/${esc(String(c.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener">WhatsApp</a>`);
    if (c.instagram) links.push(`<a class="btn btn-ghost" href="${esc(c.instagram)}" target="_blank" rel="noopener">Instagram</a>`);
    if (c.linkedin) links.push(`<a class="btn btn-ghost" href="${esc(c.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`);
    if (c.youtube) links.push(`<a class="btn btn-ghost" href="${esc(c.youtube)}" target="_blank" rel="noopener">YouTube</a>`);
    box.innerHTML = links.length ? links.join('') : '<p class="contact-empty">Contact links coming soon.</p>';
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
      const tile = e.target.closest('.tile');
      if (!tile) return;
      const v = byId[tile.dataset.id];
      openLightbox(v.id, videosIn(v.cat).map((x) => x.id), tile);
    });

    // Only play the clips while the hero is on screen.
    new IntersectionObserver(([entry]) => {
      $$('.tile video', hero).forEach((v) => (entry.isIntersecting ? v.play().catch(() => {}) : v.pause()));
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
    initHero();

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
