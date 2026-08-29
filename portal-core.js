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

  const SEMANTIC_FAMILIES = [
    { file: 'formularios.webp', label: 'Formularios', keywords: ['formulario', 'encuesta', 'cuestionario', 'solicitud', 'inscripcion', 'google forms'] },
    { file: 'incidencias.webp', label: 'Incidencias', keywords: ['incidencia', 'disciplina', 'parte disciplinario', 'registro de partes', 'sancion', 'averia', 'problema'] },
    { file: 'comunidad.webp', label: 'Convivencia', keywords: ['convivencia', 'mediacion', 'familia', 'comunidad', 'claustro', 'coeducacion'] },
    { file: 'organizacion.webp', label: 'Organización', keywords: ['organizacion', 'horario', 'calendario', 'agenda', 'reserva', 'gestion academica', 'seneca', 'secretaria', 'evaluacion'] },
    { file: 'espacios.webp', label: 'Espacios y reservas', keywords: ['espacio', 'aula', 'reserva de aula', 'instalacion', 'laboratorio', 'biblioteca escolar'] },
    { file: 'mantenimiento.webp', label: 'Mantenimiento', keywords: ['mantenimiento', 'reparacion', 'taller', 'material deteriorado', 'inventario tecnico'] },
    { file: 'documentacion.webp', label: 'Documentación', keywords: ['documentacion', 'documento', 'instrucciones', 'normativa', 'protocolo', 'acta', 'archivo', 'google docs', 'google drive', 'google sheets'] },
    { file: 'alumnado.webp', label: 'Alumnado', keywords: ['alumnado', 'estudiante', 'tutoria', 'orientacion', 'grupo', 'matricula'] },
    { file: 'digital.webp', label: 'Aplicaciones y plataformas', keywords: ['moodle', 'plataforma', 'aplicacion', 'herramienta digital', 'tic', 'canva', 'servicio corporativo'] },
    { file: 'recursos.webp', label: 'Recursos', keywords: ['recurso', 'docencia', 'aprendizaje', 'material', 'biblioteca'] }
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
    let best = SEMANTIC_FAMILIES[SEMANTIC_FAMILIES.length - 1];
    let bestScore = 0;
    SEMANTIC_FAMILIES.forEach(function (family) {
      let score = 0;
      family.keywords.forEach(function (keyword) {
        const clean = normalizeText(keyword);
        if (fields.category.indexOf(clean) !== -1) score += 8;
        if (fields.title.indexOf(clean) !== -1) score += 6;
        if (fields.description.indexOf(clean) !== -1) score += 3;
        if (fields.service.indexOf(clean) !== -1) score += 10;
        if (fields.url.indexOf(clean.replace(/\s+/g, '')) !== -1) score += 2;
      });
      if (score > bestScore) {
        best = family;
        bestScore = score;
      }
    });
    return { file: best.file, label: best.label, service: service };
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
      scale: 1.02 + (Math.floor(hash / 997) % 7) / 100
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
