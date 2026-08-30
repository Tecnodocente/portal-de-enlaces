(function () {
  'use strict';

  const SESSION_KEY = 'portal-session-token-v2';
  const LOADED_APP_VERSION = '2.4.4';
  const AUTO_VISUAL = 'AUTO';
  const READ_RETRY_DELAY_MS = 550;
  const RETRYABLE_READ_ACTIONS = Object.freeze({
    bootstrap: true,
    'data.revision': true,
    'admin.listLinks': true,
    'admin.listUsers': true
  });
  let REMOTE_VERSION = LOADED_APP_VERSION;
  const VERSION_CHECK_MS = 3 * 60 * 1000;
  const VERSION_RETRY_MS = 15 * 1000;
  const UPDATE_COOLDOWN_MS = 2 * 60 * 1000;
  const UPDATE_ATTEMPT_KEY = 'portal-version-update-attempt';
  const DATA_CHECK_MS = 90 * 1000;
  const DATA_CHECK_THROTTLE_MS = 15 * 1000;
  const DRAG_START_PX = 14;
  const SWIPE_NAV_PX = 46;
  const CARD_ACCENTS = ['cobalt', 'terracotta', 'sage', 'gold', 'violet', 'teal'];
  const BUILTIN_LIBRARY = [
    { file: 'alumnado.webp', label: 'Alumnado', categories: ['alumnado', 'estudiante', 'tutoría', 'orientación'] },
    { file: 'incidencias.webp', label: 'Incidencias', categories: ['incidencia', 'aviso', 'parte'] },
    { file: 'mantenimiento.webp', label: 'Mantenimiento', categories: ['mantenimiento', 'reparación', 'taller'] },
    { file: 'comunidad.webp', label: 'Convivencia', categories: ['convivencia', 'comunidad', 'familia', 'claustro'] },
    { file: 'espacios.webp', label: 'Espacios', categories: ['espacio', 'aula', 'reserva', 'instalación'] },
    { file: 'organizacion.webp', label: 'Organización', categories: ['organización', 'gestión', 'calendario', 'secretaría'] },
    { file: 'formularios.webp', label: 'Formularios', categories: ['formulario', 'encuesta', 'solicitud'] },
    { file: 'recursos.webp', label: 'Recursos', categories: ['recurso', 'docencia', 'aprendizaje', 'biblioteca'] },
    { file: 'digital.webp', label: 'Aplicaciones externas', categories: ['aplicación', 'plataforma', 'digital', 'tic', 'herramienta'] },
    { file: 'documentacion.webp', label: 'Documentación', categories: ['documentación', 'documento', 'archivo', 'normativa'] }
  ];
  const config = window.PORTAL_CONFIG || {};
  const baseUrl = new URL('.', window.location.href).href.replace(/\/$/, '');
  const core = window.PortalCore;
  const cardVisuals = window.PortalCardVisuals;
  const root = document.getElementById('portal-root');
  const state = {
    version: LOADED_APP_VERSION,
    assetsVersion: LOADED_APP_VERSION,
    sessionToken: '',
    user: null,
    links: [],
    current: 0,
    cardNodes: [],
    library: [],
    adminLinks: [],
    adminUsers: [],
    adminLinksLoaded: false,
    adminUsersLoaded: false,
    adminLinksRevision: '',
    adminUsersRevision: '',
    adminActiveTab: 'links',
    adminFormOpen: false,
    adminRefreshPending: false,
    dataRevision: '',
    dataCheckPending: false,
    lastDataCheck: 0,
    mainNeedsRefresh: false,
    versionCheckPending: false,
    lastVersionCheck: 0,
    suppressClickUntil: 0,
    serviceWorkerRegistration: null,
    versionRetryTimer: null
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function button(label, className, handler) {
    const node = el('button', className, label);
    node.type = 'button';
    node.addEventListener('click', handler);
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function readLocalToken() {
    const token = String(localStorage.getItem(SESSION_KEY) || '').trim();
    return /^[a-f0-9]{64}$/i.test(token) ? token : '';
  }

  function saveLocalToken(token) {
    localStorage.setItem(SESSION_KEY, token);
  }

  function clearSession() {
    localStorage.removeItem(SESSION_KEY);
    state.sessionToken = '';
    state.user = null;
    state.links = [];
    state.dataRevision = '';
    state.adminLinksLoaded = false;
    state.adminUsersLoaded = false;
  }

  async function requestApi(action, payload, token) {
    const attempts = RETRYABLE_READ_ACTIONS[action] ? 2 : 1;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await requestApiOnce(action, payload, token);
      } catch (error) {
        lastError = error;
        if (!error.transient || attempt + 1 >= attempts) throw error;
        await delay(READ_RETRY_DELAY_MS);
      }
    }
    throw lastError;
  }

  async function requestApiOnce(action, payload, token) {
    let response;
    try {
      response = await fetch(String(config.API_URL || ''), {
        method: 'POST',
        redirect: 'follow',
        cache: 'no-store',
        credentials: 'omit',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: action, token: token || '', payload: payload || {} })
      });
    } catch (_) {
      throw apiError_('NETWORK', 'No se ha podido conectar con el servidor. Comprueba la conexión e inténtalo de nuevo.', true);
    }
    if (!response.ok) throw apiError_('NETWORK', 'El servidor no ha respondido correctamente. Inténtalo de nuevo.', true);
    let envelope;
    try {
      envelope = JSON.parse(await response.text());
    } catch (_) {
      throw apiError_('INVALID_RESPONSE', 'El servidor ha devuelto una respuesta temporalmente inválida. Inténtalo de nuevo.', true);
    }
    if (!envelope || typeof envelope.ok !== 'boolean') {
      throw apiError_('INVALID_RESPONSE', 'El servidor no ha devuelto una respuesta reconocible. Inténtalo de nuevo.', true);
    }
    if (!envelope.ok) {
      const detail = envelope.error || {};
      if (detail.code === 'SESSION_EXPIRED' || detail.code === 'SESSION_INVALID') {
        clearSession();
        renderEntry();
      }
      throw apiError_(detail.code || 'SERVER_ERROR', detail.message || 'No se pudo completar la operación.');
    }
    return envelope.data;
  }

  async function api(action, payload) {
    if (!state.sessionToken) throw apiError_('AUTH_REQUIRED', 'Vuelve a identificarte.');
    return requestApi(action, payload, state.sessionToken);
  }

  function apiError_(code, message, transient) {
    const error = new Error(message);
    error.code = code;
    error.transient = Boolean(transient);
    return error;
  }

  function delay(milliseconds) {
    return new Promise(function (resolve) { setTimeout(resolve, milliseconds); });
  }

  function configurationReady() {
    return /^https:\/\/script\.google\.com\/.*\/exec(?:\?.*)?$/i.test(String(config.API_URL || ''));
  }

  function renderEntry(message) {
    clear(root);
    root.className = 'entry';
    const wash = el('div', 'entry__wash');
    const card = el('main', 'entry__card');
    const eyebrow = el('p', 'eyebrow', 'Acceso del profesorado');
    const title = el('h1', 'entry__title', 'PORTAL DE ENLACES');
    const copy = el('p', 'entry__copy', 'Tus herramientas habituales, reunidas en un lugar claro y rápido.');
    const form = el('form', 'login-form');
    const emailWrap = el('label', 'field');
    emailWrap.append(el('span', 'field__label', 'Correo corporativo'));
    const email = el('input', 'field__input');
    email.type = 'email';
    email.name = 'email';
    email.required = true;
    email.autocomplete = 'username';
    email.placeholder = 'nombre@g.educaand.es';
    emailWrap.append(email);
    const pinWrap = el('label', 'field');
    pinWrap.append(el('span', 'field__label', 'PIN'));
    const pin = el('input', 'field__input');
    pin.type = 'password';
    pin.name = 'pin';
    pin.required = true;
    pin.inputMode = 'numeric';
    pin.autocomplete = 'current-password';
    pin.pattern = '[0-9]{4,8}';
    pin.minLength = 4;
    pin.maxLength = 8;
    pinWrap.append(pin);
    const submit = el('button', 'primary-button login-submit', 'Entrar');
    submit.type = 'submit';
    const feedback = el('p', 'login-feedback', message || '');
    feedback.setAttribute('role', 'alert');
    form.append(emailWrap, pinWrap, submit, feedback);
    const note = el('p', 'entry__note', 'Acceso exclusivo con correo corporativo y PIN.');
    const version = el('p', 'version-chip', 'Versión ' + state.version);
    card.append(eyebrow, title, copy);

    if (!configurationReady()) {
      card.append(el('p', 'config-warning', 'Falta completar la URL de Apps Script en config.js antes de publicar.'), note, version);
    } else {
      form.addEventListener('submit', async function (event) {
        event.preventDefault();
        feedback.textContent = '';
        submit.disabled = true;
        submit.textContent = 'Comprobando…';
        try {
          const result = await requestApi('login', {
            email: email.value,
            pin: pin.value
          }, '');
          if (!result || !/^[a-f0-9]{64}$/i.test(String(result.token || ''))) {
            throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto una sesión válida.');
          }
          pin.value = '';
          state.sessionToken = result.token;
          saveLocalToken(result.token);
          await bootstrap(true, false);
        } catch (error) {
          pin.value = '';
          feedback.textContent = error.code === 'ACCESS_DENIED'
            ? 'Correo o PIN incorrectos.'
            : humanError(error);
          submit.disabled = false;
          submit.textContent = 'Entrar';
          pin.focus();
        }
      });
      card.append(form, note, version);
      setTimeout(function () { email.focus(); }, 0);
    }
    root.append(wash, card);
  }

  function renderLoading() {
    clear(root);
    root.className = 'state-screen';
    const panel = el('main', 'state-card');
    const pulse = el('span', 'loading-orbit');
    pulse.setAttribute('aria-hidden', 'true');
    panel.append(pulse, el('h1', '', 'Preparando tu portal'), el('p', '', 'Un momento, estamos comprobando tu acceso.'));
    root.append(panel);
  }

  function renderStatus(title, message, actionLabel, actionHandler) {
    clear(root);
    root.className = 'state-screen';
    const panel = el('main', 'state-card state-card--message');
    panel.append(el('span', 'state-mark', '—'), el('h1', '', title), el('p', '', message));
    if (actionLabel) panel.append(button(actionLabel, 'secondary-button', actionHandler || function () { renderEntry(); }));
    panel.append(el('p', 'version-chip', 'Versión ' + state.version));
    root.append(panel);
  }

  async function bootstrap(fromLogin, silent) {
    if (!silent) renderLoading();
    try {
      const data = await api('bootstrap');
      if (!data || !data.user || !data.user.email) {
        throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto los datos de sesión esperados.');
      }
      applyBootstrapData(data, false);
      renderApp();
    } catch (error) {
      if (error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_INVALID') {
        clearSession();
        renderEntry();
      } else {
        const temporary = error.transient || error.code === 'NETWORK' || error.code === 'INVALID_RESPONSE';
        renderStatus(
          temporary ? 'Problema temporal de conexión' : 'No se ha podido cargar el portal',
          humanError(error),
          'Reintentar',
          function () { bootstrap(fromLogin, false); }
        );
      }
    }
  }

  function applyBootstrapData(data, preserveCurrent) {
    const currentId = preserveCurrent && state.links[state.current] ? state.links[state.current].id : '';
    state.user = data.user;
    state.links = Array.isArray(data.links) ? data.links : [];
    state.dataRevision = String(data.dataRevision || state.dataRevision || '');
    const preservedIndex = currentId ? state.links.findIndex(function (link) { return link.id === currentId; }) : -1;
    state.current = preservedIndex >= 0 ? preservedIndex : 0;
  }

  function renderApp() {
    clear(root);
    root.className = 'app';

    const header = el('header', 'app-header');
    const brand = el('div', 'brand');
    brand.append(el('h1', 'brand__title', 'PORTAL DE ENLACES'), el('p', 'brand__version', 'Versión ' + state.version));
    const tools = el('div', 'header-tools');
    if (state.user.admin) tools.append(button('Administrar', 'header-button header-button--accent', openAdmin));
    tools.append(button('Cerrar sesión', 'header-button', logout));
    const logo = el('img', 'school-logo');
    logo.src = baseUrl + '/assets/branding/logo-centro.png?v=' + encodeURIComponent(state.assetsVersion);
    logo.alt = 'Logo del centro';
    logo.addEventListener('error', function () { logo.hidden = true; });
    tools.append(logo);
    header.append(brand, tools);

    const main = el('main', 'app-main');
    const welcome = el('div', 'welcome');
    welcome.append(el('p', 'eyebrow', 'Hola, ' + state.user.name), el('h2', 'welcome__title', '¿Dónde necesitas ir?'));
    main.append(welcome);

    if (!state.links.length) {
      const empty = el('section', 'empty-state');
      empty.append(el('span', 'state-mark', '—'), el('h3', '', 'Todavía no hay enlaces activos'), el('p', '', 'Cuando se publique el primero aparecerá aquí automáticamente.'));
      if (state.user.admin) empty.append(button('Añadir el primer enlace', 'primary-button', openAdmin));
      main.append(empty);
    } else {
      main.append(buildCarousel());
    }

    const footer = el('footer', 'app-footer');
    const account = el('span', 'footer-account');
    account.append(el('span', '', state.user.email));
    const pinSettings = button('⚙', 'pin-settings-button', openPinDialog);
    pinSettings.setAttribute('aria-label', 'Cambiar PIN');
    pinSettings.title = 'Cambiar PIN';
    account.append(pinSettings);
    footer.append(el('span', '', 'Acceso interno del profesorado'), account);
    root.append(header, main, footer, buildToast(), buildAdminDialog(), buildPinDialog(), buildCreateUserDialog(), buildDeleteUserDialog());
  }

  function buildCarousel() {
    const section = el('section', 'carousel');
    section.setAttribute('aria-roledescription', 'carrusel');
    section.setAttribute('aria-label', 'Enlaces del centro');
    const viewport = el('div', 'carousel__viewport');
    viewport.tabIndex = 0;
    const track = el('div', 'carousel__track');
    state.cardNodes = state.links.map(function (link, index) {
      const card = el('button', 'link-card');
      card.type = 'button';
      card.dataset.index = String(index);
      const profile = semanticProfile(link);
      card.classList.add('link-card--accent-' + cardAccent(link, profile));
      const variation = cardVariation(link);
      card.setAttribute('aria-label', 'Abrir ' + link.title);
      cardVisuals.render(card, {
        link: link,
        profile: profile,
        variation: variation,
        baseUrl: baseUrl,
        assetsVersion: state.assetsVersion,
        visualUrl: resolveLinkVisual(link),
        eager: index < 3
      });
      card.addEventListener('click', function () {
        if (core && core.shouldSuppressClick(state.suppressClickUntil, Date.now())) return;
        if (state.current !== index) {
          state.current = index;
          updateCarousel();
          return;
        }
        openExternal(link.url);
      });
      track.append(card);
      return card;
    });
    viewport.append(track);

    const controls = el('div', 'carousel__controls');
    const prev = button('Anterior', 'round-button', function () { moveCarousel(-1); });
    prev.setAttribute('aria-label', 'Enlace anterior');
    prev.textContent = '←';
    const counter = el('p', 'carousel__counter');
    counter.id = 'carousel-counter';
    const next = button('Siguiente', 'round-button', function () { moveCarousel(1); });
    next.setAttribute('aria-label', 'Enlace siguiente');
    next.textContent = '→';
    controls.append(prev, counter, next);
    section.append(viewport, controls);

    viewport.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft') { event.preventDefault(); moveCarousel(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); moveCarousel(1); }
      if (event.key === 'Enter') { event.preventDefault(); openExternal(state.links[state.current].url); }
    });
    attachDrag(viewport, track);
    requestAnimationFrame(updateCarousel);
    return section;
  }

  function stableHash(value) {
    const text = String(value || '');
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function cardAccent(link, profile) {
    if (profile && CARD_ACCENTS.indexOf(profile.accent) !== -1) return profile.accent;
    return CARD_ACCENTS[stableHash((link.id || '') + '|' + (link.title || '')) % CARD_ACCENTS.length];
  }

  function cardVariation(link) {
    if (core && typeof core.cardVariation === 'function') return core.cardVariation(link.id || link.title);
    const hash = stableHash(link.id || link.title);
    return { x: 38 + hash % 25, y: 42 + Math.floor(hash / 29) % 18, scale: 1.02 + (Math.floor(hash / 997) % 7) / 100 };
  }

  function cardService(link) {
    if (core && typeof core.recognizedService === 'function') return core.recognizedService(link);
    let host = '';
    try { host = new URL(String(link.url || '')).hostname.toLowerCase(); } catch (_) {}
    if (host === 'forms.gle' || host === 'docs.google.com' && /\/forms\//i.test(String(link.url || ''))) return 'Google Forms';
    if (host === 'drive.google.com' || host === 'docs.google.com') return 'Google';
    if (host.indexOf('seneca') !== -1) return 'Séneca';
    if (host.indexOf('moodle') !== -1) return 'Moodle';
    if (host.indexOf('canva.com') !== -1) return 'Canva';
    return '';
  }

  function semanticProfile(link) {
    if (core && typeof core.semanticProfile === 'function') return core.semanticProfile(link);
    return { file: suggestVisual(link && link.category), label: link && link.category || 'Recursos', service: cardService(link) };
  }

  function updateCarousel() {
    const total = state.links.length;
    state.cardNodes.forEach(function (card, index) {
      let offset = index - state.current;
      if (offset > total / 2) offset -= total;
      if (offset < -total / 2) offset += total;
      const visibleOffset = Math.max(-2, Math.min(2, offset));
      const distance = Math.abs(visibleOffset);
      const translate = visibleOffset * 72;
      const scale = Math.max(0.72, 1 - distance * 0.14);
      const rotate = visibleOffset * -3;
      card.style.transform = 'translateX(calc(-50% + ' + translate + '%)) scale(' + scale + ') rotateY(' + rotate + 'deg)';
      card.style.zIndex = String(10 - distance);
      card.style.opacity = Math.abs(offset) > 2 ? '0' : String(Math.max(0.34, 1 - distance * 0.31));
      card.style.pointerEvents = Math.abs(offset) > 2 ? 'none' : 'auto';
      card.classList.toggle('is-active', index === state.current);
      card.tabIndex = index === state.current ? 0 : -1;
      card.setAttribute('aria-hidden', index === state.current ? 'false' : 'true');
    });
    const counter = document.getElementById('carousel-counter');
    if (counter) counter.textContent = (state.current + 1) + ' / ' + total;
  }

  function moveCarousel(direction) {
    if (!state.links.length) return;
    state.current = (state.current + direction + state.links.length) % state.links.length;
    updateCarousel();
  }

  function attachDrag(viewport, track) {
    let startX = 0;
    let startY = 0;
    let deltaX = 0;
    let deltaY = 0;
    let pointerActive = false;
    let dragging = false;
    let pointerId = null;
    viewport.addEventListener('pointerdown', function (event) {
      if (!event.isPrimary || event.button !== 0) return;
      pointerActive = true;
      dragging = false;
      pointerId = event.pointerId;
      startX = event.clientX;
      startY = event.clientY;
      deltaX = 0;
      deltaY = 0;
    });
    viewport.addEventListener('pointermove', function (event) {
      if (!pointerActive || event.pointerId !== pointerId) return;
      deltaX = event.clientX - startX;
      deltaY = event.clientY - startY;
      if (!dragging) {
        const horizontalDrag = core && typeof core.isHorizontalDrag === 'function'
          ? core.isHorizontalDrag(deltaX, deltaY, DRAG_START_PX)
          : Math.abs(deltaX) >= DRAG_START_PX && Math.abs(deltaX) > Math.abs(deltaY);
        if (!horizontalDrag) return;
        dragging = true;
        viewport.setPointerCapture(pointerId);
        viewport.classList.add('is-dragging');
      }
      event.preventDefault();
      track.style.transform = 'translateX(' + Math.max(-70, Math.min(70, deltaX * 0.18)) + 'px)';
    });
    function finish(event, cancelled) {
      if (!pointerActive || event.pointerId !== pointerId) return;
      pointerActive = false;
      if (!dragging) { pointerId = null; return; }
      dragging = false;
      viewport.classList.remove('is-dragging');
      track.style.transform = '';
      state.suppressClickUntil = Date.now() + 550;
      if (viewport.hasPointerCapture(pointerId)) viewport.releasePointerCapture(pointerId);
      if (!cancelled && (core ? core.isNavigationSwipe(deltaX, SWIPE_NAV_PX) : Math.abs(deltaX) > SWIPE_NAV_PX)) {
        moveCarousel(deltaX > 0 ? -1 : 1);
      }
      pointerId = null;
    }
    viewport.addEventListener('pointerup', function (event) { finish(event, false); });
    viewport.addEventListener('pointercancel', function (event) { finish(event, true); });
  }

  function resolveVisual(visual) {
    const safe = String(visual || '').trim();
    if (!safe || safe.includes('..') || !/\.(png|webp|jpe?g)$/i.test(safe)) {
      return baseUrl + '/assets/cards/recursos.webp?v=' + encodeURIComponent(state.assetsVersion);
    }
    return baseUrl + '/' + (safe.indexOf('assets/') === 0 ? safe : 'assets/cards/' + safe) +
      '?v=' + encodeURIComponent(state.assetsVersion);
  }

  function resolveLinkVisual(link) {
    const visual = String(link && link.visual || '').trim();
    return resolveVisual(!visual || visual.toUpperCase() === AUTO_VISUAL ? semanticProfile(link).file : visual);
  }

  function openExternal(url) {
    if (!/^https:\/\//i.test(String(url || ''))) {
      showToast('Este enlace no tiene una dirección segura.', true);
      return;
    }
    const anchor = document.createElement('a');
    anchor.href = String(url);
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.hidden = true;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  async function logout() {
    const token = state.sessionToken;
    clearSession();
    renderEntry();
    if (token) {
      try { await requestApi('logout', {}, token); } catch (_) {}
    }
  }

  function buildToast() {
    const toast = el('div', 'toast');
    toast.id = 'portal-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    return toast;
  }

  function showToast(message, isError) {
    const toast = document.getElementById('portal-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.toggle('toast--error', Boolean(isError));
    toast.classList.add('is-visible');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () { toast.classList.remove('is-visible'); }, 3300);
  }

  function buildAdminDialog() {
    const dialog = el('dialog', 'admin-dialog');
    dialog.id = 'admin-dialog';
    const frame = el('div', 'admin-frame');
    const header = el('header', 'admin-header');
    const heading = el('div');
    heading.append(el('p', 'eyebrow', 'Zona protegida'), el('h2', 'admin-title', 'Administración'));
    header.append(heading, button('Cerrar', 'header-button', closeAdmin));
    const tabs = el('nav', 'admin-tabs');
    const linksTab = button('Enlaces', 'admin-tab is-active', function () { selectAdminTab('links'); });
    linksTab.dataset.tab = 'links';
    const usersTab = button('Usuarios', 'admin-tab', function () { selectAdminTab('users'); });
    usersTab.dataset.tab = 'users';
    tabs.append(linksTab, usersTab);
    const content = el('div', 'admin-content');
    content.id = 'admin-content';
    frame.append(header, tabs, content);
    dialog.append(frame);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeAdmin(); });
    return dialog;
  }

  function buildPinDialog() {
    const dialog = el('dialog', 'pin-dialog');
    dialog.id = 'pin-dialog';
    const form = el('form', 'pin-dialog__card');
    form.method = 'dialog';
    form.append(el('p', 'eyebrow', 'Cuenta personal'), el('h2', 'pin-dialog__title', 'Cambiar PIN'));
    const currentPin = field(form, 'PIN actual', 'password', 'currentPin', '', true);
    const newPin = field(form, 'PIN nuevo', 'password', 'newPin', '', true);
    const confirmation = field(form, 'Repetir PIN nuevo', 'password', 'newPinConfirmation', '', true);
    [currentPin, newPin, confirmation].forEach(function (input) {
      input.inputMode = 'numeric';
      input.pattern = '[0-9]{4,8}';
      input.minLength = 4;
      input.maxLength = 8;
    });
    currentPin.autocomplete = 'current-password';
    newPin.autocomplete = 'new-password';
    confirmation.autocomplete = 'new-password';
    const feedback = el('p', 'pin-dialog__feedback');
    feedback.setAttribute('role', 'alert');
    const actions = el('div', 'form-actions');
    actions.append(button('Cancelar', 'secondary-button', closePinDialog));
    const submit = el('button', 'primary-button', 'Guardar PIN');
    submit.type = 'submit';
    actions.append(submit);
    form.append(feedback, actions);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      feedback.textContent = '';
      if (!/^\d{4,8}$/.test(currentPin.value) || !/^\d{4,8}$/.test(newPin.value) || !/^\d{4,8}$/.test(confirmation.value)) {
        feedback.textContent = 'Los tres PIN deben contener entre 4 y 8 dígitos.';
        return;
      }
      if (newPin.value !== confirmation.value) {
        feedback.textContent = 'El PIN nuevo y su confirmación no coinciden.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Guardando…';
      try {
        const result = await api('changeOwnPin', {
          currentPin: currentPin.value,
          newPin: newPin.value,
          newPinConfirmation: confirmation.value
        });
        if (!result || result.changed !== true) throw apiError_('SERVER_ERROR', 'El servidor no ha confirmado el cambio de PIN.');
        form.reset();
        closePinDialog();
        showToast('PIN actualizado correctamente.');
      } catch (error) {
        currentPin.value = '';
        newPin.value = '';
        confirmation.value = '';
        feedback.textContent = humanError(error);
        currentPin.focus();
      } finally {
        submit.disabled = false;
        submit.textContent = 'Guardar PIN';
      }
    });
    dialog.append(form);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closePinDialog(); });
    return dialog;
  }

  function buildCreateUserDialog() {
    const dialog = el('dialog', 'user-dialog');
    dialog.id = 'create-user-dialog';
    const form = el('form', 'user-dialog__card');
    form.append(el('p', 'eyebrow', 'Administración de usuarios'), el('h2', 'user-dialog__title', 'Dar de alta usuario'));
    const name = field(form, 'NOMBRE', 'text', 'name', '', true);
    const email = field(form, 'CORREO', 'email', 'email', '', true);
    email.placeholder = 'nombre@g.educaand.es';
    const choices = el('div', 'user-dialog__choices');
    const active = checkbox('ACTIVO', true);
    const admin = checkbox('ADMIN', false);
    choices.append(active.label, admin.label);
    const note = el('p', 'user-dialog__note', 'El PIN inicial será 1234. Después, el profesor podrá cambiarlo desde su aplicación.');
    const feedback = el('p', 'user-dialog__feedback');
    feedback.setAttribute('role', 'alert');
    const actions = el('div', 'form-actions');
    actions.append(button('Cancelar', 'secondary-button', closeCreateUserDialog));
    const submit = el('button', 'primary-button', 'Dar de alta usuario');
    submit.type = 'submit';
    actions.append(submit);
    form.append(choices, note, feedback, actions);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Guardando…';
      feedback.textContent = '';
      try {
        const result = await api('admin.createUser', {
          name: name.value,
          email: email.value,
          active: active.input.checked,
          admin: admin.input.checked
        });
        if (!result || !result.user || !result.user.email) throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto el usuario creado.');
        state.adminUsers.push(result.user);
        state.adminUsers = sortUsers(state.adminUsers);
        state.adminUsersLoaded = true;
        applyKnownRevision(result.dataRevision, 'users');
        closeCreateUserDialog();
        renderAdminUsers();
        showToast('Usuario dado de alta. PIN inicial: 1234.');
      } catch (error) {
        feedback.textContent = humanError(error);
      } finally {
        submit.disabled = false;
        submit.textContent = 'Dar de alta usuario';
      }
    });
    dialog.append(form);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeCreateUserDialog(); });
    return dialog;
  }

  function buildDeleteUserDialog() {
    const dialog = el('dialog', 'user-dialog');
    dialog.id = 'delete-user-dialog';
    const card = el('div', 'user-dialog__card');
    card.append(el('p', 'eyebrow', 'Acción irreversible en la hoja'), el('h2', 'user-dialog__title', 'Eliminar profesor'));
    const identity = el('div', 'delete-user__identity');
    const name = el('strong');
    name.dataset.role = 'delete-user-name';
    const email = el('span');
    email.dataset.role = 'delete-user-email';
    identity.append(name, email);
    card.append(identity, el('p', 'user-dialog__warning', 'El registro correspondiente será eliminado de la hoja USUARIOS.'));
    const feedback = el('p', 'user-dialog__feedback');
    feedback.setAttribute('role', 'alert');
    const actions = el('div', 'form-actions');
    actions.append(button('Cancelar', 'secondary-button', closeDeleteUserDialog));
    const remove = button('Eliminar profesor', 'danger-button', confirmDeleteUser);
    actions.append(remove);
    card.append(feedback, actions);
    dialog.append(card);
    dialog.addEventListener('cancel', function (event) { event.preventDefault(); closeDeleteUserDialog(); });
    return dialog;
  }

  function openCreateUserDialog() {
    const dialog = document.getElementById('create-user-dialog');
    if (!dialog) return;
    const form = dialog.querySelector('form');
    if (form) form.reset();
    const feedback = dialog.querySelector('.user-dialog__feedback');
    if (feedback) feedback.textContent = '';
    dialog.showModal();
    const name = dialog.querySelector('input[name="name"]');
    if (name) name.focus();
  }

  function closeCreateUserDialog() {
    const dialog = document.getElementById('create-user-dialog');
    if (dialog && dialog.open) dialog.close();
  }

  function openDeleteUserDialog(user) {
    const dialog = document.getElementById('delete-user-dialog');
    if (!dialog) return;
    dialog._targetUser = user;
    dialog.querySelector('[data-role="delete-user-name"]').textContent = user.name || 'Sin nombre';
    dialog.querySelector('[data-role="delete-user-email"]').textContent = user.email;
    dialog.querySelector('.user-dialog__feedback').textContent = '';
    dialog.showModal();
  }

  function closeDeleteUserDialog() {
    const dialog = document.getElementById('delete-user-dialog');
    if (!dialog) return;
    dialog._targetUser = null;
    if (dialog.open) dialog.close();
  }

  async function confirmDeleteUser() {
    const dialog = document.getElementById('delete-user-dialog');
    const user = dialog && dialog._targetUser;
    if (!dialog || !user) return;
    const remove = dialog.querySelector('.danger-button');
    const feedback = dialog.querySelector('.user-dialog__feedback');
    remove.disabled = true;
    feedback.textContent = '';
    try {
      const result = await api('admin.deleteUser', { email: user.email });
      if (!result || !result.user || result.user.email !== user.email) throw apiError_('SERVER_ERROR', 'El servidor no ha confirmado el usuario eliminado.');
      state.adminUsers = state.adminUsers.filter(function (item) { return item.email !== user.email; });
      applyKnownRevision(result.dataRevision, 'users');
      closeDeleteUserDialog();
      if (result.selfDeleted) {
        clearSession();
        state.mainNeedsRefresh = false;
        closeAdmin();
        renderEntry('Tu usuario ha sido eliminado.');
        return;
      }
      renderAdminUsers();
      showToast('Profesor eliminado.');
    } catch (error) {
      feedback.textContent = humanError(error);
    } finally {
      remove.disabled = false;
    }
  }

  function openPinDialog() {
    const dialog = document.getElementById('pin-dialog');
    if (!dialog) return;
    dialog.showModal();
    const currentPin = dialog.querySelector('input[name="currentPin"]');
    if (currentPin) currentPin.focus();
  }

  function closePinDialog() {
    const dialog = document.getElementById('pin-dialog');
    if (!dialog) return;
    const form = dialog.querySelector('form');
    if (form) form.reset();
    const feedback = dialog.querySelector('.pin-dialog__feedback');
    if (feedback) feedback.textContent = '';
    if (dialog.open) dialog.close();
  }

  async function openAdmin() {
    const dialog = document.getElementById('admin-dialog');
    if (!dialog) return;
    dialog.showModal();
    selectAdminTab('links');
  }

  function closeAdmin() {
    const dialog = document.getElementById('admin-dialog');
    if (dialog && dialog.open) dialog.close();
    if (state.mainNeedsRefresh) {
      state.mainNeedsRefresh = false;
      renderApp();
    }
  }

  async function selectAdminTab(tab) {
    state.adminActiveTab = tab;
    state.adminFormOpen = false;
    state.adminRefreshPending = false;
    document.querySelectorAll('.admin-tab').forEach(function (node) {
      node.classList.toggle('is-active', node.dataset.tab === tab);
    });
    const content = document.getElementById('admin-content');
    if (!content) return;
    clear(content);
    const hasFreshLinks = tab === 'links' && state.adminLinksLoaded && state.adminLinksRevision === state.dataRevision;
    const hasFreshUsers = tab === 'users' && state.adminUsersLoaded && state.adminUsersRevision === state.dataRevision;
    if (hasFreshLinks) { renderAdminLinks(); return; }
    if (hasFreshUsers) { renderAdminUsers(); return; }
    content.append(el('p', 'admin-loading', 'Cargando…'));
    try {
      if (tab === 'links') {
        const results = await Promise.all([api('admin.listLinks'), loadLibrary()]);
        const response = results[0];
        if (!response || !Array.isArray(response.links)) throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto el listado de enlaces esperado.');
        state.adminLinks = response.links;
        state.adminLinksLoaded = true;
        state.adminLinksRevision = String(response.dataRevision || state.dataRevision);
        state.dataRevision = state.adminLinksRevision;
        renderAdminLinks();
      } else {
        const response = await api('admin.listUsers');
        if (!response || !Array.isArray(response.users)) throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto el listado de usuarios esperado.');
        state.adminUsers = response.users;
        state.adminUsersLoaded = true;
        state.adminUsersRevision = String(response.dataRevision || state.dataRevision);
        state.dataRevision = state.adminUsersRevision;
        renderAdminUsers();
      }
    } catch (error) {
      renderAdminError(error);
    }
  }

  async function loadLibrary() {
    if (state.library.length) return state.library;
    try {
      const response = await fetch(baseUrl + '/assets/cards/library.json?v=' +
        encodeURIComponent(state.assetsVersion) + '&cb=' + Date.now(), { cache: 'no-store' });
      if (!response.ok) throw new Error('Biblioteca no disponible');
      const data = await response.json();
      state.library = Array.isArray(data.items) && data.items.length ? data.items : BUILTIN_LIBRARY;
    } catch (_) {
      // Si una política de red bloquea el manifiesto, la biblioteca incluida
      // continúa disponible.
      state.library = BUILTIN_LIBRARY;
    }
    return state.library;
  }

  function renderAdminLinks() {
    state.adminFormOpen = false;
    const content = document.getElementById('admin-content');
    clear(content);
    const toolbar = el('div', 'admin-toolbar');
    toolbar.append(
      el('p', 'admin-summary', state.adminLinks.length + (state.adminLinks.length === 1 ? ' enlace' : ' enlaces')),
      button('Nuevo enlace', 'primary-button primary-button--small', function () { renderLinkForm(null); })
    );
    const list = el('div', 'admin-list');
    if (!state.adminLinks.length) list.append(el('p', 'admin-empty', 'Aún no hay enlaces. Crea el primero cuando quieras.'));
    state.adminLinks.forEach(function (link) {
      const row = el('article', 'admin-row');
      const thumb = el('img', 'admin-row__thumb');
      thumb.src = resolveLinkVisual(link);
      thumb.alt = '';
      thumb.addEventListener('error', function () { thumb.src = resolveVisual('recursos.webp'); });
      const info = el('div', 'admin-row__info');
      info.append(el('strong', '', link.title), el('span', '', (link.category || 'Sin categoría') + ' · Orden ' + link.order));
      const status = el('span', 'status-pill ' + (link.active ? 'status-pill--on' : ''), link.active ? 'Activo' : 'Inactivo');
      const actions = el('div', 'admin-row__actions');
      actions.append(
        button(link.active ? 'Desactivar' : 'Activar', 'text-button', function () { toggleLink(link); }),
        button('Editar', 'text-button', function () { renderLinkForm(link); }),
        button('Eliminar', 'text-button text-button--danger', function () { removeLink(link); })
      );
      row.append(thumb, info, status, actions);
      list.append(row);
    });
    content.append(toolbar, list);
  }

  function renderLinkForm(link) {
    state.adminFormOpen = true;
    const content = document.getElementById('admin-content');
    clear(content);
    const form = el('form', 'link-form');
    const title = el('h3', 'form-title', link ? 'Editar enlace' : 'Nuevo enlace');
    const grid = el('div', 'form-grid');
    const titleInput = field(grid, 'Título', 'text', 'title', link ? link.title : '', true);
    const urlInput = field(grid, 'URL segura', 'url', 'url', link ? link.url : 'https://', true);
    const categoryInput = field(grid, 'Categoría', 'text', 'category', link ? link.category : '', false);
    const orderInput = field(grid, 'Orden', 'number', 'order', link ? link.order : state.adminLinks.length + 1, true);
    orderInput.step = '1';
    const descriptionWrap = el('label', 'field field--wide');
    descriptionWrap.append(el('span', 'field__label', 'Descripción breve'));
    const description = el('textarea', 'field__input');
    description.name = 'description';
    description.maxLength = 280;
    description.rows = 3;
    description.value = link ? link.description : '';
    descriptionWrap.append(description);
    grid.append(descriptionWrap);

    const activeWrap = el('label', 'check-field');
    const active = el('input');
    active.type = 'checkbox';
    active.name = 'active';
    active.checked = link ? link.active : true;
    activeWrap.append(active, el('span', '', 'Enlace activo'));

    const visualTitle = el('p', 'field__label visual-heading', 'Fotografía de fondo');
    const visuals = el('div', 'visual-picker');
    const currentVisual = link && link.visual ? link.visual : AUTO_VISUAL;
    const autoOption = el('label', 'visual-option visual-option--auto');
    const autoRadio = el('input');
    autoRadio.type = 'radio';
    autoRadio.name = 'visual';
    autoRadio.value = AUTO_VISUAL;
    autoRadio.checked = String(currentVisual).toUpperCase() === AUTO_VISUAL;
    const autoImage = el('img');
    autoImage.alt = '';
    const autoLabel = el('span', '', 'Automático');
    autoOption.append(autoRadio, autoImage, autoLabel);
    visuals.append(autoOption);
    state.library.forEach(function (item, index) {
      const option = el('label', 'visual-option');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'visual';
      radio.value = item.file;
      radio.checked = currentVisual === item.file;
      const image = el('img');
      image.src = resolveVisual(item.file);
      image.alt = '';
      option.append(radio, image, el('span', '', item.label));
      visuals.append(option);
    });
    function updateAutomaticPreview() {
      const profile = semanticProfile({
        id: link ? link.id : '',
        title: titleInput.value,
        url: urlInput.value,
        category: categoryInput.value,
        description: description.value
      });
      autoImage.src = resolveVisual(profile.file);
      autoLabel.textContent = 'Automático · ' + profile.label;
    }
    [titleInput, urlInput, categoryInput, description].forEach(function (input) {
      input.addEventListener('input', updateAutomaticPreview);
    });
    updateAutomaticPreview();

    const actions = el('div', 'form-actions');
    actions.append(button('Cancelar', 'secondary-button', leaveLinkForm));
    const submit = el('button', 'primary-button', 'Guardar');
    submit.type = 'submit';
    actions.append(submit);
    form.append(title, grid, activeWrap, visualTitle, visuals, actions);
    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      submit.disabled = true;
      submit.textContent = 'Guardando…';
      try {
        const selected = form.querySelector('input[name="visual"]:checked');
        const result = await api('admin.saveLink', {
          id: link ? link.id : '',
          title: titleInput.value,
          url: urlInput.value,
          category: categoryInput.value,
          order: Number(orderInput.value),
          active: active.checked,
          visual: selected ? selected.value : '',
          description: description.value
        });
        applySavedLink(result);
        state.mainNeedsRefresh = true;
        state.adminFormOpen = false;
        renderAdminLinks();
        showToast('Enlace guardado.');
      } catch (error) {
        showToast(humanError(error), true);
        submit.disabled = false;
        submit.textContent = 'Guardar';
      }
    });
    content.append(form);
  }

  function leaveLinkForm() {
    state.adminFormOpen = false;
    if (state.adminRefreshPending || !state.adminLinksLoaded || state.adminLinksRevision !== state.dataRevision) {
      selectAdminTab('links');
      return;
    }
    renderAdminLinks();
  }

  function sortLinks(links) {
    return links.slice().sort(function (a, b) { return a.order - b.order || a.title.localeCompare(b.title, 'es'); });
  }

  function sortUsers(users) {
    return core && typeof core.sortUsers === 'function'
      ? core.sortUsers(users)
      : users.slice().sort(function (a, b) { return String(a.name || '').localeCompare(String(b.name || ''), 'es'); });
  }

  function updatePublicLinksFromAdmin() {
    const currentId = state.links[state.current] ? state.links[state.current].id : '';
    state.links = sortLinks(state.adminLinks.filter(function (item) { return item.active; }));
    const preservedIndex = currentId ? state.links.findIndex(function (item) { return item.id === currentId; }) : -1;
    state.current = preservedIndex >= 0 ? preservedIndex : 0;
  }

  function applyKnownRevision(revision, changedArea) {
    const value = String(revision || state.dataRevision || '');
    state.dataRevision = value;
    if (changedArea === 'links') {
      state.adminLinksRevision = value;
      if (state.adminUsersLoaded) state.adminUsersRevision = value;
    } else if (changedArea === 'users') {
      state.adminUsersRevision = value;
      if (state.adminLinksLoaded) state.adminLinksRevision = value;
    }
  }

  function applySavedLink(result) {
    if (!result || !result.link || !result.link.id) throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto el enlace guardado.');
    const index = state.adminLinks.findIndex(function (item) { return item.id === result.link.id; });
    if (index >= 0) state.adminLinks[index] = result.link;
    else state.adminLinks.push(result.link);
    state.adminLinks = sortLinks(state.adminLinks);
    state.adminLinksLoaded = true;
    applyKnownRevision(result.dataRevision, 'links');
    updatePublicLinksFromAdmin();
  }

  function field(parent, label, type, name, value, required) {
    const wrap = el('label', 'field');
    wrap.append(el('span', 'field__label', label));
    const input = el('input', 'field__input');
    input.type = type;
    input.name = name;
    input.value = value;
    input.required = required;
    wrap.append(input);
    parent.append(wrap);
    return input;
  }

  function suggestVisual(category) {
    const normalized = String(category || '').toLowerCase();
    const item = state.library.find(function (candidate) {
      return Array.isArray(candidate.categories) && candidate.categories.some(function (keyword) {
        return normalized.includes(String(keyword).toLowerCase());
      });
    });
    return item ? item.file : (state.library[0] ? state.library[0].file : 'recursos.webp');
  }

  async function toggleLink(link) {
    try {
      const result = await api('admin.saveLink', Object.assign({}, link, { active: !link.active }));
      applySavedLink(result);
      state.mainNeedsRefresh = true;
      renderAdminLinks();
      showToast(link.active ? 'Enlace desactivado.' : 'Enlace activado.');
    } catch (error) {
      showToast(humanError(error), true);
    }
  }

  async function removeLink(link) {
    if (!window.confirm('¿Eliminar “' + link.title + '”? Esta acción quita la fila de ENLACES.')) return;
    try {
      const result = await api('admin.deleteLink', { id: link.id });
      if (!result || result.id !== link.id) throw apiError_('SERVER_ERROR', 'El servidor no ha confirmado el enlace eliminado.');
      state.adminLinks = state.adminLinks.filter(function (item) { return item.id !== result.id; });
      applyKnownRevision(result.dataRevision, 'links');
      updatePublicLinksFromAdmin();
      state.mainNeedsRefresh = true;
      renderAdminLinks();
      showToast('Enlace eliminado.');
    } catch (error) {
      showToast(humanError(error), true);
    }
  }

  function renderAdminUsers() {
    state.adminFormOpen = false;
    const content = document.getElementById('admin-content');
    clear(content);
    const toolbar = el('div', 'admin-toolbar');
    toolbar.append(
      el('p', 'admin-summary', state.adminUsers.length + (state.adminUsers.length === 1 ? ' usuario' : ' usuarios')),
      button('+ Dar de alta usuario', 'primary-button primary-button--small', openCreateUserDialog)
    );
    content.append(toolbar, el('p', 'admin-note', 'Gestiona aquí el alta, la baja, el acceso y el rol. El PIN no se muestra ni se modifica desde Administración.'));
    const list = el('div', 'users-list');
    state.adminUsers.forEach(function (user) {
      const row = el('article', 'user-row');
      const identity = el('div', 'user-row__identity');
      identity.append(el('strong', '', user.name || 'Sin nombre'), el('span', '', user.email));
      const toggles = el('div', 'user-row__toggles');
      const active = checkbox('Activo', user.active);
      const admin = checkbox('Administrador', user.admin);
      toggles.append(active.label, admin.label);
      async function saveUser() {
        const selfBlocking = user.email === state.user.email && (!active.input.checked || !admin.input.checked);
        let confirmed = false;
        if (selfBlocking) {
          confirmed = window.confirm('Este cambio puede bloquear tu propio acceso de administración. ¿Quieres continuar?');
          if (!confirmed) {
            active.input.checked = user.active;
            admin.input.checked = user.admin;
            return;
          }
        }
        active.input.disabled = true;
        admin.input.disabled = true;
        try {
          const result = await api('admin.updateUser', {
            email: user.email,
            active: active.input.checked,
            admin: admin.input.checked,
            confirmSelfLockout: confirmed
          });
          if (!result || !result.user || result.user.email !== user.email) throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto el usuario actualizado.');
          user.active = result.user.active;
          user.admin = result.user.admin;
          user.name = result.user.name;
          applyKnownRevision(result.dataRevision, 'users');
          showToast('Permisos actualizados.');
          if (user.email === state.user.email && !user.active) {
            clearSession();
            closeAdmin();
            renderEntry();
          } else if (user.email === state.user.email && !user.admin) {
            state.user.admin = false;
            state.mainNeedsRefresh = false;
            renderApp();
          }
        } catch (error) {
          active.input.checked = user.active;
          admin.input.checked = user.admin;
          showToast(humanError(error), true);
        } finally {
          active.input.disabled = false;
          admin.input.disabled = false;
        }
      }
      active.input.addEventListener('change', saveUser);
      admin.input.addEventListener('change', saveUser);
      const remove = button('Eliminar', 'user-row__delete', function () { openDeleteUserDialog(user); });
      remove.textContent = '🗑';
      remove.title = 'Eliminar profesor';
      remove.setAttribute('aria-label', 'Eliminar profesor');
      row.append(identity, toggles, remove);
      list.append(row);
    });
    content.append(list);
  }

  function checkbox(labelText, checked) {
    const label = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.defaultChecked = checked;
    const control = el('span', 'switch__control');
    control.setAttribute('aria-hidden', 'true');
    label.append(input, control, el('span', '', labelText));
    return { label: label, input: input };
  }

  function renderAdminError(error) {
    const content = document.getElementById('admin-content');
    clear(content);
    const panel = el('div', 'admin-error');
    panel.append(el('h3', '', 'No se ha podido cargar'), el('p', '', humanError(error)), button('Cerrar', 'secondary-button', closeAdmin));
    content.append(panel);
  }

  function cssEscape(value) {
    if (window.CSS && CSS.escape) return CSS.escape(value);
    return String(value).replace(/["\\]/g, '\\$&');
  }

  function humanError(error) {
    const message = error && error.message ? String(error.message) : 'Ha ocurrido un error inesperado.';
    return message.replace(/^Exception:\s*/i, '');
  }

  async function checkDataRevision(force) {
    if (!state.sessionToken || state.dataCheckPending) return;
    const now = Date.now();
    if (now - state.lastDataCheck < DATA_CHECK_THROTTLE_MS) return;
    if (!force && now - state.lastDataCheck < DATA_CHECK_MS) return;
    state.lastDataCheck = now;
    state.dataCheckPending = true;
    try {
      const result = await api('data.revision');
      const revision = result && String(result.dataRevision || '');
      if (revision && state.dataRevision && revision !== state.dataRevision) {
        await refreshDataFromServer();
      } else if (revision && !state.dataRevision) {
        state.dataRevision = revision;
      }
    } catch (_) {
      // La comprobación periódica no interrumpe el uso; los errores de sesión ya vuelven al acceso.
    } finally {
      state.dataCheckPending = false;
    }
  }

  async function refreshDataFromServer() {
    const adminDialog = document.getElementById('admin-dialog');
    const adminWasOpen = Boolean(adminDialog && adminDialog.open);
    const formWasOpen = adminWasOpen && state.adminFormOpen;
    const data = await api('bootstrap');
    if (!data || !data.user || !data.user.email || !Array.isArray(data.links)) {
      throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto los datos actualizados esperados.');
    }
    applyBootstrapData(data, true);
    state.adminLinksLoaded = false;
    state.adminUsersLoaded = false;
    state.adminLinksRevision = '';
    state.adminUsersRevision = '';
    if (!adminWasOpen) {
      renderApp();
      return;
    }
    if (!state.user.admin) {
      renderApp();
      return;
    }
    state.mainNeedsRefresh = true;
    if (formWasOpen) {
      state.adminRefreshPending = true;
      return;
    }
    await selectAdminTab(state.adminActiveTab);
  }

  async function fetchVersionMeta() {
    const response = await fetch(baseUrl + '/version.json?check=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) throw new Error('No se puede comprobar la versión.');
    const meta = await response.json();
    if (!/^\d+\.\d+\.\d+$/.test(String(meta.version || ''))) throw new Error('La versión remota no es válida.');
    return meta;
  }

  async function fetchPublishedConstant(file, constantName, targetVersion) {
    const response = await fetch(baseUrl + '/' + file + '?probe=' + encodeURIComponent(targetVersion), { cache: 'reload' });
    if (!response.ok) return '';
    const source = await response.text();
    const match = source.match(new RegExp('\\b' + constantName + '\\s*=\\s*[\\\'\"]([^\\\'\"]+)[\\\'\"]'));
    return match ? match[1] : '';
  }

  async function publishedReleaseReady(targetVersion) {
    const versions = await Promise.all([
      fetchPublishedConstant('app.js', 'LOADED_APP_VERSION', targetVersion),
      fetchPublishedConstant('sw.js', 'SERVICE_WORKER_VERSION', targetVersion)
    ]);
    return core
      ? core.releaseArtifactsReady(targetVersion, versions[0], versions[1])
      : targetVersion === versions[0] && targetVersion === versions[1];
  }

  function readUpdateAttempt() {
    try { return JSON.parse(sessionStorage.getItem(UPDATE_ATTEMPT_KEY) || 'null'); }
    catch (_) { return null; }
  }

  function scheduleVersionRetry() {
    if (state.versionRetryTimer) return;
    state.versionRetryTimer = setTimeout(function () {
      state.versionRetryTimer = null;
      checkRemoteVersion(true);
    }, VERSION_RETRY_MS);
  }

  async function checkRemoteVersion(force) {
    if (state.versionCheckPending || (!force && Date.now() - state.lastVersionCheck < 30000)) return;
    state.lastVersionCheck = Date.now();
    state.versionCheckPending = true;
    try {
      const meta = await fetchVersionMeta();
      REMOTE_VERSION = meta.version;
      const decision = core
        ? core.versionUpdateDecision(LOADED_APP_VERSION, REMOTE_VERSION, readUpdateAttempt(), Date.now(), UPDATE_COOLDOWN_MS)
        : (REMOTE_VERSION !== LOADED_APP_VERSION ? 'update' : 'none');
      if (decision === 'none') {
        state.assetsVersion = meta.assetsVersion || LOADED_APP_VERSION;
        const attempt = readUpdateAttempt();
        if (attempt && (attempt.targetVersion || attempt.version) === LOADED_APP_VERSION) {
          sessionStorage.removeItem(UPDATE_ATTEMPT_KEY);
        }
        return;
      }
      if (decision === 'wait') {
        scheduleVersionRetry();
        return;
      }
      if (decision !== 'update') return; // Respuesta inválida o cacheada más antigua.
      if (!await publishedReleaseReady(REMOTE_VERSION)) {
        scheduleVersionRetry();
        return;
      }
      await showUpdatingAndReload(meta);
    } catch (_) {
      // Una comprobación de versión no debe interrumpir el uso normal.
    } finally {
      state.versionCheckPending = false;
    }
  }

  async function showUpdatingAndReload(meta) {
    const overlay = el('div', 'update-overlay');
    overlay.append(el('span', 'loading-orbit'), el('strong', '', 'Actualizando…'));
    document.body.append(overlay);
    let reloaded = false;
    function reloadOnce() {
      if (reloaded) return;
      reloaded = true;
      window.location.reload();
    }
    function recordReloadAttempt() {
      sessionStorage.setItem(UPDATE_ATTEMPT_KEY, JSON.stringify({
        targetVersion: meta.version,
        loadedVersion: LOADED_APP_VERSION,
        reloadedAt: Date.now()
      }));
    }
    if (!('serviceWorker' in navigator)) {
      recordReloadAttempt();
      reloadOnce();
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register(
        './sw.js?v=' + encodeURIComponent(meta.version),
        { scope: './', updateViaCache: 'none' }
      );
      state.serviceWorkerRegistration = registration;
      await registration.update();
      if (!await activateServiceWorker(registration, meta.version)) throw new Error('El service worker no se ha activado.');
      recordReloadAttempt();
      reloadOnce();
    } catch (_) {
      overlay.remove();
      scheduleVersionRetry();
    }
  }

  function waitForWorkerState(worker, expected, timeoutMs) {
    if (!worker) return Promise.resolve(false);
    if (worker.state === expected) return Promise.resolve(true);
    return new Promise(function (resolve) {
      let settled = false;
      const timeout = setTimeout(function () { finish(false); }, timeoutMs);
      function finish(value) {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.removeEventListener('statechange', onChange);
        resolve(value);
      }
      function onChange() {
        if (worker.state === expected) finish(true);
        else if (worker.state === 'redundant') finish(false);
      }
      worker.addEventListener('statechange', onChange);
    });
  }

  async function activateServiceWorker(registration, targetVersion) {
    let waitingState = registration.waiting && registration.waiting.state;
    const installingState = registration.installing && registration.installing.state;
    const activeMatchesTarget = Boolean(registration.active &&
      new URL(registration.active.scriptURL).searchParams.get('v') === targetVersion);
    let plan = core
      ? core.workerActivationPlan(waitingState, installingState, activeMatchesTarget)
      : (waitingState === 'installed' ? 'activate-waiting' : activeMatchesTarget ? 'ready' : 'wait-installing');
    if (plan === 'ready') return true;
    if (plan === 'wait-installing') {
      const installing = registration.installing;
      if (!await waitForWorkerState(installing, 'installed', 10000)) return false;
      waitingState = registration.waiting && registration.waiting.state;
      plan = core
        ? core.workerActivationPlan(waitingState || installing.state, '', false)
        : 'activate-waiting';
    }
    if (plan !== 'activate-waiting') return false;
    const worker = registration.waiting || registration.installing;
    const activated = waitForWorkerState(worker, 'activated', 10000);
    worker.postMessage({ type: 'SKIP_WAITING' });
    return activated;
  }

  async function initializeApp() {
    state.sessionToken = readLocalToken();
    if (state.sessionToken) renderLoading();
    else renderEntry();
    let meta = null;
    try {
      meta = await fetchVersionMeta();
      REMOTE_VERSION = meta.version;
      if (REMOTE_VERSION === LOADED_APP_VERSION) {
        state.assetsVersion = meta.assetsVersion || LOADED_APP_VERSION;
        const attempt = readUpdateAttempt();
        if (attempt && (attempt.targetVersion || attempt.version) === LOADED_APP_VERSION) {
          sessionStorage.removeItem(UPDATE_ATTEMPT_KEY);
        }
      }
    } catch (_) {
      // Si ya existe un SW, la interfaz todavía puede abrirse sin conexión.
    }
    const decision = meta && core
      ? core.versionUpdateDecision(LOADED_APP_VERSION, REMOTE_VERSION, readUpdateAttempt(), Date.now(), UPDATE_COOLDOWN_MS)
      : (meta && REMOTE_VERSION !== LOADED_APP_VERSION ? 'update' : 'none');
    if (decision === 'update' || decision === 'wait') {
      checkRemoteVersion(true);
      return;
    }
    if ('serviceWorker' in navigator) {
      try {
        state.serviceWorkerRegistration = await navigator.serviceWorker.register(
          './sw.js?v=' + encodeURIComponent(LOADED_APP_VERSION),
          { scope: './', updateViaCache: 'none' }
        );
      } catch (_) {}
    }
    if (state.sessionToken) bootstrap(false, true);
  }

  window.addEventListener('focus', function () {
    checkRemoteVersion(true);
    checkDataRevision(true);
  });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') {
      checkRemoteVersion(true);
      checkDataRevision(true);
    }
  });
  setInterval(function () { checkRemoteVersion(false); }, VERSION_CHECK_MS);
  setInterval(function () { checkDataRevision(false); }, DATA_CHECK_MS);

  initializeApp();
})();
