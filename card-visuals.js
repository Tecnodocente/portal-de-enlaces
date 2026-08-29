(function (root, factory) {
  'use strict';
  root.PortalCardVisuals = factory(root.document);
})(typeof self !== 'undefined' ? self : this, function (document) {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  const CARD_PALETTE = Object.freeze([
    Object.freeze({ accent: '#7896B8', tint: '#AFC0D2' }),
    Object.freeze({ accent: '#8FA58B', tint: '#BDC9B9' }),
    Object.freeze({ accent: '#C98268', tint: '#E0B09F' }),
    Object.freeze({ accent: '#C58E9A', tint: '#DDB8C0' }),
    Object.freeze({ accent: '#B9A06B', tint: '#D5C59F' }),
    Object.freeze({ accent: '#9A91B4', tint: '#C1BBD0' }),
    Object.freeze({ accent: '#6F9F9A', tint: '#A9C7C4' }),
    Object.freeze({ accent: '#D3A07C', tint: '#E4C1A8' })
  ]);

  function stableHash(value) {
    const text = String(value || 'portal-card');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function paletteFor(link) {
    const item = link || {};
    const stableId = item.id || item.title || item.url || 'portal-card';
    return CARD_PALETTE[stableHash(stableId) % CARD_PALETTE.length];
  }

  function node(tag, className, text) {
    const item = document.createElement(tag);
    if (className) item.className = className;
    if (text != null) item.textContent = text;
    return item;
  }

  function icon(symbol, className, spriteUrl) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', spriteUrl + '#' + symbol);
    svg.append(use);
    return svg;
  }

  function scene(symbol, className, spriteUrl) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', className);
    svg.setAttribute('viewBox', '0 0 360 300');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS(NS, 'use');
    use.setAttribute('href', spriteUrl + '#scene-' + symbol);
    svg.append(use);
    return svg;
  }

  function titleClass(value) {
    const length = String(value || '').trim().length;
    if (length <= 24) return 'link-card__title--short';
    if (length <= 48) return 'link-card__title--medium';
    if (length <= 72) return 'link-card__title--long';
    return 'link-card__title--very-long';
  }

  function render(card, options) {
    const link = options.link || {};
    const profile = options.profile || { key: 'general', label: 'Enlace del centro' };
    const variation = options.variation || {};
    const palette = paletteFor(link);
    const spriteUrl = options.baseUrl + '/assets/cards/semantic-symbols.svg?v=' + encodeURIComponent(options.assetsVersion || '');
    const scenesUrl = options.baseUrl + '/assets/cards/semantic-scenes.svg?v=' + encodeURIComponent(options.assetsVersion || '');

    card.classList.add('link-card--type-' + profile.key, 'link-card--variant-' + (variation.variant || 0));
    card.style.setProperty('--card-accent', palette.accent);
    card.style.setProperty('--card-tint', palette.tint);
    card.style.setProperty('--image-position-x', (variation.x || 50) + '%');
    card.style.setProperty('--image-position-y', (variation.y || 50) + '%');
    card.style.setProperty('--image-scale', String(variation.scale || 1.04));
    card.style.setProperty('--motif-x', (variation.motifX || 0) + 'px');
    card.style.setProperty('--motif-y', (variation.motifY || 0) + 'px');
    card.style.setProperty('--motif-scale', String(variation.motifScale || 1));
    card.style.setProperty('--motif-rotate', (variation.motifRotate || 0) + 'deg');

    const media = node('span', 'link-card__media');
    const image = node('img', 'link-card__image');
    image.src = options.visualUrl;
    image.alt = '';
    image.loading = options.eager ? 'eager' : 'lazy';
    image.addEventListener('error', function () {
      image.hidden = true;
      card.classList.add('link-card--fallback');
    });
    media.append(image, node('span', 'link-card__veil'));

    const semantic = node('span', 'link-card__semantic');
    semantic.setAttribute('aria-hidden', 'true');
    semantic.append(scene(profile.key, 'link-card__semantic-scene', scenesUrl));

    const body = node('span', 'link-card__body');
    const identity = node('span', 'link-card__identity');
    const iconBox = node('span', 'link-card__icon');
    iconBox.setAttribute('aria-hidden', 'true');
    iconBox.append(icon(profile.key, 'link-card__icon-mark', spriteUrl));
    const identityText = node('span', 'link-card__identity-text');
    identityText.append(node('span', 'link-card__category', link.category || profile.label || 'Enlace'));
    if (profile.service) {
      const service = profile.key === 'schedule' && profile.service === 'Séneca'
        ? 'Séneca · Gestión académica'
        : profile.service;
      identityText.append(node('span', 'link-card__service', service));
    }
    identity.append(iconBox, identityText);
    body.append(identity, node('span', 'link-card__title ' + titleClass(link.title), link.title));
    body.append(node('span', 'link-card__action', 'Abrir enlace ↗'));
    card.append(media, semantic, body);
  }

  return Object.freeze({ render: render, titleClass: titleClass, paletteFor: paletteFor });
});
