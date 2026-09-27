// Scan input check screen (J4 contract)
// Left panel: 380px inspection summary
// Center: 3D viewer with pretreatment mesh and FDI tooth labels

import { clear, h } from '../../ui/dom.js';
import { universalToFdi } from '../../domain/teeth.js';
import { CHECK_VOCAB } from '../../domain/vocab/check.js';

import { deriveCheckState, parsePatientAndScanId } from './check-model.js';
import { renderCheckPanel } from './check-panel.js';

export {
  deriveCheckState,
  parsePatientAndScanId,
  formatBasis,
  formatRotationSummary,
  formatVerticalSummary,
  formatOrientationSummary
} from './check-model.js';

/**
 * Mounts the scan check screen into root.
 *
 * @param {HTMLElement} root
 * @param {object} params
 * @param {object} ctx
 * @returns {function(): void}
 */
export function mount(root, params, ctx) {
  clear(root);

  const caseId = params.caseId || '';
  const { pid, sid } = parsePatientAndScanId(caseId);
  const isPatientCase = Boolean(pid && sid);

  // Left 380px panel + center 3D viewer
  const panel = h('aside', { class: 'check-panel' });
  const viewerContainer = h('section', { class: 'check-viewer-container' });
  root.appendChild(h('div', { class: 'screen-check' }, panel, viewerContainer));

  let isUnmounted = false;
  let viewer = null;
  // Loaded lazily so the pure helpers above stay importable without three.js.
  const viewerReady = import('../../viewer/index.js').then((mod) => {
    if (!isUnmounted) viewer = mod.createViewer(viewerContainer);
    return viewer;
  });
  let activeCheck = null;
  let errorMessage = '';
  let deletePending = false;
  let busy = false;

  function renderPanel() {
    if (isUnmounted) return;
    const state = deriveCheckState(activeCheck);
    renderCheckPanel(panel, {
      state,
      subtitle: `${pid ? pid + ' · ' : ''}${sid || caseId} · ${CHECK_VOCAB.versionSuffix(state.revision)}`,
      errorMessage,
      isPatientCase,
      deletePending
    }, {
      onConfirm: handleConfirm,
      onMirror: handleMirror,
      onDelete: handleDelete,
      onDeletePending: (open) => {
        deletePending = open;
        renderPanel();
      }
    });
  }

  function setErrorMessage(msg) {
    errorMessage = msg || '';
    renderPanel();
  }

  function setCheck(check) {
    activeCheck = check;
    ctx.store.set({ currentScan: check });
  }

  // Mesh and labels follow the check so the numbers match the current revision.
  async function loadMesh(check) {
    try {
      const [mesh] = await Promise.all([ctx.api.caseMesh(caseId), viewerReady]);
      if (isUnmounted || !viewer) return;
      viewer.loadCase(mesh);
      viewer.setLabels((check.teeth || []).map((u) => {
        const fdi = universalToFdi(u);
        return { tooth: u, fdi, label: String(fdi ?? u) };
      }));
      viewer.setLayers({ numbers: true });
    } catch (err) {
      if (!isUnmounted) setErrorMessage(err?.message || CHECK_VOCAB.meshFailed);
    }
  }

  async function loadData() {
    clear(panel);
    panel.appendChild(h('div', { class: 'check-loading' }, CHECK_VOCAB.loading));
    try {
      const check = await ctx.api.caseCheck(caseId);
      if (isUnmounted) return;
      setCheck(check);
      renderPanel();
      await loadMesh(check);
    } catch (err) {
      if (!isUnmounted) setErrorMessage(err?.message || CHECK_VOCAB.fetchError);
    }
  }

  // Runs one panel action at a time; the clicked button stays disabled until it ends.
  async function runAction(selector, action, fallbackMessage) {
    if (busy) return;
    busy = true;
    errorMessage = '';
    renderPanel();
    const btn = panel.querySelector(selector);
    if (btn) btn.disabled = true;
    try {
      await action();
    } catch (err) {
      if (!isUnmounted) setErrorMessage(err?.message || fallbackMessage(err));
    } finally {
      busy = false;
      if (btn && !isUnmounted) btn.disabled = false;
    }
  }

  function handleConfirm(state) {
    return runAction('.check-btn-primary', async () => {
      if (isPatientCase) {
        await ctx.api.confirmScan(pid, sid, state.revision);
      }
      await ctx.api.activateCase(caseId);
      if (isUnmounted) return;
      if (isPatientCase) setCheck({ ...activeCheck, confirmed: true });
      ctx.navigate(`#/workspace/${encodeURIComponent(caseId)}`);
    }, (err) => (err?.status === 409 ? CHECK_VOCAB.conflict409 : CHECK_VOCAB.planStartFailed));
  }

  function handleMirror() {
    if (!isPatientCase) return null;
    return runAction('.check-btn-mirror', async () => {
      const updated = await ctx.api.mirrorScan(pid, sid);
      if (isUnmounted) return;
      setCheck(updated);
      renderPanel();
      await loadMesh(updated);
    }, () => CHECK_VOCAB.mirrorFailed);
  }

  function handleDelete() {
    return runAction('.check-btn-delete', async () => {
      if (isPatientCase) {
        await ctx.api.deleteScan(pid, sid);
        ctx.navigate(`#/patients/${encodeURIComponent(pid)}`);
      } else {
        ctx.navigate('#/cases');
      }
    }, () => CHECK_VOCAB.deleteFailed);
  }

  loadData();

  return () => {
    isUnmounted = true;
    viewer?.destroy();
    clear(root);
  };
}
