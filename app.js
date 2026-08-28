(function () {
  'use strict';

  const SESSION_KEY = 'portal-session-token-v2';
  const LOADED_APP_VERSION = '2.1.0';
  let REMOTE_VERSION = LOADED_APP_VERSION;
  const VERSION_CHECK_MS = 3 * 60 * 1000;
  const VERSION_RETRY_MS = 15 * 1000;
  const UPDATE_COOLDOWN_MS = 2 * 60 * 1000;
  const UPDATE_ATTEMPT_KEY = 'portal-version-update-attempt';
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
  }

  async function requestApi(action, payload, token) {
    const response = await fetch(String(config.API_URL || ''), {
      method: 'POST',
      redirect: 'follow',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: action, token: token || '', payload: payload || {} })
    });
    if (!response.ok) throw apiError_('NETWORK', 'El servidor no ha respondido correctamente.');
    const envelope = await response.json();
    if (!envelope || !envelope.ok) {
      const detail = envelope && envelope.error ? envelope.error : {};
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

  function apiError_(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
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

  function renderStatus(title, message, actionLabel) {
    clear(root);
    root.className = 'state-screen';
    const panel = el('main', 'state-card state-card--message');
    panel.append(el('span', 'state-mark', '—'), el('h1', '', title), el('p', '', message));
    if (actionLabel) panel.append(button(actionLabel, 'secondary-button', function () { renderEntry(); }));
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
      state.user = data.user;
      state.links = Array.isArray(data.links) ? data.links : [];
      state.current = 0;
      renderApp();
    } catch (error) {
      clearSession();
      if (silent || error.code === 'SESSION_EXPIRED' || error.code === 'SESSION_INVALID') {
        renderEntry();
      } else {
        renderStatus('No se ha podido entrar', humanError(error), 'Volver');
      }
    }
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
    root.append(header, main, footer, buildToast(), buildAdminDialog(), buildPinDialog());
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
      card.setAttribute('aria-label', 'Abrir ' + link.title);
      const media = el('span', 'link-card__media');
      const image = el('img', 'link-card__image');
      image.src = resolveVisual(link.visual);
      image.alt = '';
      image.loading = index < 3 ? 'eager' : 'lazy';
      image.addEventListener('error', function () {
        image.hidden = true;
        card.classList.add('link-card--fallback');
      });
      const veil = el('span', 'link-card__veil');
      media.append(image, veil);
      const body = el('span', 'link-card__body');
      const category = el('span', 'link-card__category', link.category || 'Enlace');
      const title = el('span', 'link-card__title', link.title);
      body.append(category, title);
      if (link.description) body.append(el('span', 'link-card__description', link.description));
      body.append(el('span', 'link-card__action', 'Abrir enlace ↗'));
      card.append(media, body);
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
    let deltaX = 0;
    let dragging = false;
    viewport.addEventListener('pointerdown', function (event) {
      dragging = true;
      startX = event.clientX;
      deltaX = 0;
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add('is-dragging');
    });
    viewport.addEventListener('pointermove', function (event) {
      if (!dragging) return;
      deltaX = event.clientX - startX;
      track.style.transform = 'translateX(' + Math.max(-70, Math.min(70, deltaX * 0.18)) + 'px)';
    });
    function finish() {
      if (!dragging) return;
      dragging = false;
      viewport.classList.remove('is-dragging');
      track.style.transform = '';
      if (Math.abs(deltaX) > 10) state.suppressClickUntil = Date.now() + 550;
      if (core ? core.isNavigationSwipe(deltaX, 45) : Math.abs(deltaX) > 45) {
        moveCarousel(deltaX > 0 ? -1 : 1);
      }
    }
    viewport.addEventListener('pointerup', finish);
    viewport.addEventListener('pointercancel', finish);
  }

  function resolveVisual(visual) {
    const safe = String(visual || '').trim();
    if (!safe || safe.includes('..') || !/\.(png|webp|jpe?g)$/i.test(safe)) {
      return baseUrl + '/assets/cards/recursos.webp?v=' + encodeURIComponent(state.assetsVersion);
    }
    return baseUrl + '/' + (safe.indexOf('assets/') === 0 ? safe : 'assets/cards/' + safe) +
      '?v=' + encodeURIComponent(state.assetsVersion);
  }

  function openExternal(url) {
    if (!/^https:\/\//i.test(String(url || ''))) {
      showToast('Este enlace no tiene una dirección segura.', true);
      return;
    }
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
    else window.location.assign(url);
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
    document.querySelectorAll('.admin-tab').forEach(function (node) {
      node.classList.toggle('is-active', node.dataset.tab === tab);
    });
    const content = document.getElementById('admin-content');
    if (!content) return;
    clear(content);
    content.append(el('p', 'admin-loading', 'Cargando…'));
    try {
      if (tab === 'links') {
        const results = await Promise.all([api('admin.listLinks'), loadLibrary()]);
        state.adminLinks = Array.isArray(results[0]) ? results[0] : [];
        renderAdminLinks();
      } else {
        const users = await api('admin.listUsers');
        if (!Array.isArray(users)) throw apiError_('SERVER_ERROR', 'El servidor no ha devuelto el listado de usuarios esperado.');
        state.adminUsers = users;
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
      thumb.src = resolveVisual(link.visual);
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

    const visualTitle = el('p', 'field__label visual-heading', 'Imagen de la biblioteca');
    const visuals = el('div', 'visual-picker');
    const currentVisual = link ? link.visual : suggestVisual(categoryInput.value);
    state.library.forEach(function (item, index) {
      const option = el('label', 'visual-option');
      const radio = el('input');
      radio.type = 'radio';
      radio.name = 'visual';
      radio.value = item.file;
      radio.checked = currentVisual ? currentVisual === item.file : index === 0;
      const image = el('img');
      image.src = resolveVisual(item.file);
      image.alt = '';
      option.append(radio, image, el('span', '', item.label));
      visuals.append(option);
    });
    categoryInput.addEventListener('change', function () {
      if (link) return;
      const suggestion = suggestVisual(categoryInput.value);
      const radio = visuals.querySelector('input[value="' + cssEscape(suggestion) + '"]');
      if (radio) radio.checked = true;
    });

    const actions = el('div', 'form-actions');
    actions.append(button('Cancelar', 'secondary-button', renderAdminLinks));
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
        await api('admin.saveLink', {
          id: link ? link.id : '',
          title: titleInput.value,
          url: urlInput.value,
          category: categoryInput.value,
          order: Number(orderInput.value),
          active: active.checked,
          visual: selected ? selected.value : '',
          description: description.value
        });
        state.adminLinks = await api('admin.listLinks');
        const fresh = await api('bootstrap');
        state.links = fresh.links || [];
        state.current = 0;
        state.mainNeedsRefresh = true;
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
      await api('admin.saveLink', Object.assign({}, link, { active: !link.active }));
      state.adminLinks = await api('admin.listLinks');
      const fresh = await api('bootstrap');
      state.links = fresh.links || [];
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
      await api('admin.deleteLink', { id: link.id });
      state.adminLinks = await api('admin.listLinks');
      const fresh = await api('bootstrap');
      state.links = fresh.links || [];
      state.mainNeedsRefresh = true;
      renderAdminLinks();
      showToast('Enlace eliminado.');
    } catch (error) {
      showToast(humanError(error), true);
    }
  }

  function renderAdminUsers() {
    const content = document.getElementById('admin-content');
    clear(content);
    content.append(el('p', 'admin-note', 'El alta, la eliminación y el PIN inicial se gestionan en la hoja USUARIOS. Aquí puedes gestionar el acceso y el rol.'));
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
          await api('admin.updateUser', {
            email: user.email,
            active: active.input.checked,
            admin: admin.input.checked,
            confirmSelfLockout: confirmed
          });
          user.active = active.input.checked;
          user.admin = admin.input.checked;
          showToast('Permisos actualizados.');
          if (user.email === state.user.email && (!user.active || !user.admin)) {
            clearSession();
            closeAdmin();
            renderEntry();
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
      row.append(identity, toggles);
      list.append(row);
    });
    content.append(list);
  }

  function checkbox(labelText, checked) {
    const label = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = checked;
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

  window.addEventListener('focus', function () { checkRemoteVersion(true); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') checkRemoteVersion(true);
  });
  setInterval(function () { checkRemoteVersion(false); }, VERSION_CHECK_MS);

  initializeApp();
})();
