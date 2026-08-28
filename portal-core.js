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
    compareSemanticVersions: compareSemanticVersions,
    versionUpdateDecision: versionUpdateDecision,
    releaseArtifactsReady: releaseArtifactsReady,
    workerActivationPlan: workerActivationPlan
  });
});
