(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PortalCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function isNavigationSwipe(distance, threshold) {
    return Math.abs(Number(distance) || 0) > (Number(threshold) || 45);
  }

  function isHorizontalDrag(deltaX, deltaY, threshold) {
    const horizontal = Math.abs(Number(deltaX) || 0);
    const vertical = Math.abs(Number(deltaY) || 0);
    return horizontal >= (Number(threshold) || 14) && horizontal > vertical;
  }

  function shouldSuppressClick(suppressUntil, now) {
    return Number(suppressUntil) > Number(now);
  }

  function normalizeText(value) {
    return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function recognizedService(link) {
    let host = '';
    const url = String(link && link.url || '');
    try { host = new URL(url).hostname.toLowerCase(); } catch (_) {}
    if (host === 'forms.gle' || host === 'docs.google.com' && /\/forms\//i.test(url)) return 'Google Forms';
    if (host === 'docs.google.com' && /\/spreadsheets\//i.test(url)) return 'Google Sheets';
    if (host === 'docs.google.com' && /\/document\//i.test(url)) return 'Google Docs';
    if (host === 'drive.google.com' || host === 'docs.google.com') return 'Google Drive';
    if (host.indexOf('seneca') !== -1 || host.indexOf('juntadeandalucia.es') !== -1 && /seneca/i.test(url)) return 'Séneca';
    if (host.indexOf('moodle') !== -1) return 'Moodle';
    if (host.indexOf('canva.com') !== -1) return 'Canva';
    return '';
  }

  const SEMANTIC_TYPES = [
    { key: 'incidents', file: 'incidencias.webp', label: 'Incidencias', accent: 'terracotta', keywords: ['incidencia', 'disciplina', 'parte disciplinario', 'registro de partes', 'sancion', 'convivencia'] },
    { key: 'schedule', file: 'organizacion.webp', label: 'Horarios', accent: 'gold', keywords: ['horario', 'cuadrante', 'turno', 'planificacion horaria'] },
    { key: 'reservations', file: 'espacios.webp', label: 'Reservas', accent: 'teal', keywords: ['reserva', 'reservar', 'espacio', 'aula', 'laboratorio', 'instalacion'] },
    { key: 'assessment', file: 'alumnado.webp', label: 'Evaluación', accent: 'sage', keywords: ['evaluacion', 'rubrica', 'calificacion', 'criterio', 'progreso', 'informe de evaluacion'] },
    { key: 'tutoring', file: 'alumnado.webp', label: 'Tutoría', accent: 'violet', keywords: ['tutoria', 'orientacion', 'entrevista familia', 'seguimiento tutorial'] },
    { key: 'students', file: 'alumnado.webp', label: 'Alumnado', accent: 'cobalt', keywords: ['alumnado', 'estudiante', 'grupo', 'matricula', 'ficha personal'] },
    { key: 'maintenance', file: 'mantenimiento.webp', label: 'Mantenimiento', accent: 'terracotta', keywords: ['mantenimiento', 'reparacion', 'averia', 'taller', 'material deteriorado', 'inventario tecnico'] },
    { key: 'meetings', file: 'comunidad.webp', label: 'Reuniones', accent: 'gold', keywords: ['reunion', 'claustro', 'consejo escolar', 'equipo educativo', 'acta de reunion'] },
    { key: 'communications', file: 'comunidad.webp', label: 'Comunicaciones', accent: 'cobalt', keywords: ['comunicacion', 'mensaje', 'aviso', 'circular', 'notificacion', 'familias'] },
    { key: 'calendar', file: 'organizacion.webp', label: 'Calendario', accent: 'gold', keywords: ['calendario de reuniones', 'calendario', 'agenda', 'efemeride', 'fecha', 'plazo'] },
    { key: 'documents', file: 'documentacion.webp', label: 'Documentación', accent: 'cobalt', services: ['Google Drive', 'Google Docs', 'Google Sheets'], keywords: ['documentacion', 'documento', 'instrucciones', 'normativa', 'protocolo', 'acta', 'archivo', 'carpeta'] },
    { key: 'forms', file: 'formularios.webp', label: 'Formularios', accent: 'terracotta', services: ['Google Forms'], keywords: ['formulario', 'inscripcion', 'solicitud generica'] },
    { key: 'surveys', file: 'formularios.webp', label: 'Encuestas', accent: 'violet', keywords: ['encuesta', 'cuestionario', 'sondeo', 'valoracion', 'consulta'] },
    { key: 'virtual-classroom', file: 'digital.webp', label: 'Aula virtual', accent: 'teal', services: ['Moodle'], keywords: ['aula virtual', 'moodle', 'curso virtual', 'plataforma educativa'] },
    { key: 'academic-management', file: 'organizacion.webp', label: 'Gestión académica', accent: 'gold', services: ['Séneca'], keywords: ['gestion academica', 'secretaria', 'expediente', 'grabacion academica'] },
    { key: 'technology', file: 'digital.webp', label: 'Tecnología', accent: 'teal', keywords: ['tic', 'tecnologia', 'informatica', 'aplicacion', 'herramienta digital', 'canva'] },
    { key: 'administration', file: 'organizacion.webp', label: 'Administración', accent: 'terracotta', keywords: ['administracion', 'tramite', 'certificado', 'gestion interna', 'secretaria administrativa'] },
    { key: 'organization', file: 'organizacion.webp', label: 'Organización', accent: 'gold', keywords: ['planificacion', 'coordinacion', 'programacion', 'proyecto'] },
    { key: 'resources', file: 'recursos.webp', label: 'Recursos', accent: 'sage', services: ['Canva'], keywords: ['recurso', 'docencia', 'aprendizaje', 'material', 'biblioteca', 'contenido'] },
    { key: 'general', file: 'recursos.webp', label: 'Enlace del centro', accent: 'cobalt', keywords: [] }
  ];

  function semanticProfile(link) {
    const service = recognizedService(link);
    const fields = {
      category: normalizeText(link && link.category),
      title: normalizeText(link && link.title),
      description: normalizeText(link && link.description),
      url: normalizeText(link && link.url),
      service: normalizeText(service)
    };
    let best = SEMANTIC_TYPES[SEMANTIC_TYPES.length - 1];
    let bestScore = 0;
    SEMANTIC_TYPES.forEach(function (family) {
      let score = 0;
      if (family.services && family.services.indexOf(service) !== -1) score += 7;
      family.keywords.forEach(function (keyword) {
        const clean = normalizeText(keyword);
        if (fields.category === clean) score += 22;
        else if (fields.category.indexOf(clean) !== -1) score += 16;
        if (fields.title.indexOf(clean) !== -1) score += 11;
        if (fields.description.indexOf(clean) !== -1) score += 4;
        if (fields.service.indexOf(clean) !== -1) score += 5;
        if (clean && fields.url.indexOf(clean.replace(/\s+/g, '')) !== -1) score += 1;
      });
      if (score > bestScore) {
        best = family;
        bestScore = score;
      }
    });
    return { key: best.key, file: best.file, label: best.label, service: service, accent: best.accent };
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

  function cardVariation(id) {
    const hash = stableHash(id || 'portal-card');
    return {
      x: 38 + hash % 25,
      y: 42 + Math.floor(hash / 29) % 18,
      scale: 1.02 + (Math.floor(hash / 997) % 7) / 100,
      variant: hash % 6,
      motifX: -10 + Math.floor(hash / 17) % 21,
      motifY: -8 + Math.floor(hash / 41) % 17,
      motifScale: 0.94 + (Math.floor(hash / 109) % 13) / 100,
      motifRotate: -5 + Math.floor(hash / 331) % 11
    };
  }

  function sortUsers(users) {
    return (Array.isArray(users) ? users : []).slice().sort(function (a, b) {
      return String(a.name || '').localeCompare(String(b.name || ''), 'es') || String(a.email || '').localeCompare(String(b.email || ''), 'es');
    });
  }

  function compareSemanticVersions(left, right) {
    const pattern = /^\d+\.\d+\.\d+$/;
    if (!pattern.test(String(left || '')) || !pattern.test(String(right || ''))) return null;
    const a = String(left).split('.').map(Number);
    const b = String(right).split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
      if (a[index] < b[index]) return -1;
      if (a[index] > b[index]) return 1;
    }
    return 0;
  }

  function versionUpdateDecision(loaded, remote, lastAttempt, now, cooldownMs) {
    const comparison = compareSemanticVersions(remote, loaded);
    if (comparison === null) return 'invalid';
    if (comparison === 0) return 'none';
    if (comparison < 0) return 'stale-remote';
    const cooldown = Number(cooldownMs) || 120000;
    const attemptedTarget = lastAttempt && (lastAttempt.targetVersion || lastAttempt.version);
    const attemptedFrom = lastAttempt && (lastAttempt.loadedVersion || loaded);
    const attemptedAt = lastAttempt && (lastAttempt.reloadedAt || lastAttempt.at);
    if (attemptedTarget === remote && attemptedFrom === loaded && Number(now) - Number(attemptedAt) < cooldown) {
      return 'wait';
    }
    return 'update';
  }

  function releaseArtifactsReady(target, appVersion, workerVersion) {
    return Boolean(target && target === appVersion && target === workerVersion);
  }

  function workerActivationPlan(waitingState, installingState, activeMatchesTarget) {
    if (waitingState === 'installed') return 'activate-waiting';
    if (installingState && installingState !== 'redundant') return 'wait-installing';
    if (activeMatchesTarget) return 'ready';
    return 'missing';
  }

  return Object.freeze({
    isNavigationSwipe: isNavigationSwipe,
    isHorizontalDrag: isHorizontalDrag,
    shouldSuppressClick: shouldSuppressClick,
    normalizeText: normalizeText,
    recognizedService: recognizedService,
    semanticProfile: semanticProfile,
    cardVariation: cardVariation,
    sortUsers: sortUsers,
    compareSemanticVersions: compareSemanticVersions,
    versionUpdateDecision: versionUpdateDecision,
    releaseArtifactsReady: releaseArtifactsReady,
    workerActivationPlan: workerActivationPlan
  });
});
