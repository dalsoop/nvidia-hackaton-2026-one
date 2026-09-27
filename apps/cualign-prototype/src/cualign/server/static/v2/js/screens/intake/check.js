// Scan input check screen (J4 contract)
// Left panel: 380px inspection summary
// Center: 3D viewer with pretreatment mesh and FDI tooth labels

import { clear, h } from '../../ui/dom.js';
import { universalToFdi } from '../../domain/teeth.js';
import { T } from '../../domain/vocab.js';
import { CHECK_VOCAB } from '../../domain/vocab/check.js';

/**
 * Pure function: derives screen and UI state from caseCheck API payload.
 *
 * @param {object|null} check
 * @returns {object}
 */
export function deriveCheckState(check) {
  if (!check || typeof check !== 'object') {
    return {
      caseId: '',
      revision: 1,
      confirmed: false,
      confirmedAt: null,
      isSupported: false,
      ready: false,
      unsupportedReasons: [],
      isReversed: false,
      hasOrientationNotice: false,
      orientationNote: '',
      orientation: {},
      teeth: [],
      fdiTeeth: [],
      missing: [],
      fdiMissing: [],
      outside: [],
      fdiOutside: [],
      crowding_mm: 0,
      scannedGingiva: false,
      widths: [],
      rotations: [],
      verticals: [],
      primaryAction: {
        label: CHECK_VOCAB.btnUnsupported,
        disabled: true,
        type: 'unsupported'
      },
      showDelete: true
    };
  }

  let unsupportedReasons = [];
  if (Array.isArray(check.unsupported)) {
    unsupportedReasons = check.unsupported.filter(Boolean);
  } else if (typeof check.unsupported === 'string' && check.unsupported.trim()) {
    unsupportedReasons = [check.unsupported.trim()];
  }

  const isSupported = unsupportedReasons.length === 0 && check.ready !== false;
  if (!isSupported && unsupportedReasons.length === 0) {
    unsupportedReasons = [CHECK_VOCAB.unsupportedDefaultReason];
  }
  const ready = Boolean(check.ready !== false && isSupported);

  const orientation = check.orientation || {};
  const isReversed = orientation.side === 'reversed';
  const hasOrientationNotice = orientation.basis === 'none';
  const orientationNote = orientation.note || '';

  const teeth = Array.isArray(check.teeth) ? check.teeth : [];
  const fdiTeeth = teeth
    .map((u) => ({ universal: u, fdi: universalToFdi(u) }))
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const missing = Array.isArray(check.missing) ? check.missing : [];
  const fdiMissing = missing
    .map((u) => ({ universal: u, fdi: universalToFdi(u) }))
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const outside = Array.isArray(check.outside) ? check.outside : [];
  const fdiOutside = outside
    .map((u) => ({ universal: u, fdi: universalToFdi(u) }))
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const rawWidths = check.widths_mm || {};
  const widths = Object.entries(rawWidths)
    .map(([uStr, w]) => {
      const u = Number(uStr);
      return {
        universal: u,
        fdi: universalToFdi(u),
        width_mm: typeof w === 'number' ? w : Number(w)
      };
    })
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const rawRot = check.rotation_deg || {};
  const rotations = Object.entries(rawRot)
    .map(([uStr, deg]) => {
      const u = Number(uStr);
      return {
        universal: u,
        fdi: universalToFdi(u),
        deg: typeof deg === 'number' ? deg : Number(deg)
      };
    })
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const rawVert = check.vertical_mm || {};
  const verticals = Object.entries(rawVert)
    .map(([uStr, mm]) => {
      const u = Number(uStr);
      return {
        universal: u,
        fdi: universalToFdi(u),
        mm: typeof mm === 'number' ? mm : Number(mm)
      };
    })
    .sort((a, b) => (a.fdi ?? 0) - (b.fdi ?? 0));

  const primaryAction = isSupported
    ? { label: CHECK_VOCAB.btnStartPlan, disabled: false, type: 'confirm' }
    : { label: CHECK_VOCAB.btnUnsupported, disabled: true, type: 'unsupported' };

  return {
    caseId: check.case_id || '',
    revision: check.revision ?? 1,
    confirmed: Boolean(check.confirmed),
    confirmedAt: check.confirmed_at || null,
    isSupported,
    ready,
    unsupportedReasons,
    isReversed,
    hasOrientationNotice,
    orientationNote,
    orientation,
    teeth,
    fdiTeeth,
    missing,
    fdiMissing,
    outside,
    fdiOutside,
    crowding_mm: typeof check.crowding_mm === 'number' ? check.crowding_mm : 0,
    scannedGingiva: Boolean(check.scanned_gingiva),
    widths,
    rotations,
    verticals,
    primaryAction,
    showDelete: !isSupported
  };
}

export function parsePatientAndScanId(caseId) {
  if (!caseId) return { pid: '', sid: '' };
  const str = String(caseId).trim();
  const parts = str.split('-');
  if (parts.length >= 2) {
    return { pid: parts[0], sid: parts.slice(1).join('-') };
  }
  return { pid: parts[0], sid: '' };
}

export function formatBasis(basis) {
  return CHECK_VOCAB.bases[basis] || basis || CHECK_VOCAB.unspecified;
}

export function formatRotationSummary(rotations) {
  if (!Array.isArray(rotations) || rotations.length === 0) {
    return CHECK_VOCAB.noRotationNeeded;
  }
  return rotations
    .map((r) => `${r.fdi}번 ${r.deg > 0 ? '+' : ''}${r.deg}°`)
    .join(', ');
}

export function formatVerticalSummary(verticals) {
  if (!Array.isArray(verticals) || verticals.length === 0) {
    return CHECK_VOCAB.noVerticalNeeded;
  }
  return verticals
    .map((v) => `${v.fdi}번 ${v.mm > 0 ? CHECK_VOCAB.occlusalSide : CHECK_VOCAB.gingivalSide} ${Math.abs(v.mm)}mm`)
    .join(', ');
}

export function formatOrientationSummary(orientation) {
  if (!orientation || typeof orientation !== 'object') {
    return CHECK_VOCAB.unspecified;
  }
  const basis = formatBasis(orientation.basis);
  const rot = orientation.rotation_deg ? ` · ${orientation.rotation_deg}° 회전` : '';
  const renum = orientation.renumbered ? CHECK_VOCAB.renumberedSuffix : '';
  return `${basis}${rot}${renum}`;
}

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

  const caseId = decodeURIComponent(params.caseId || '');
  const { pid, sid } = parsePatientAndScanId(caseId);

  // Screen container: Left 380px panel + Center 3D viewer
  const container = h('div', { class: 'screen-check' });
  const panel = h('aside', { class: 'check-panel' });
  const viewerContainer = h('section', { class: 'check-viewer-container' });

  container.appendChild(panel);
  container.appendChild(viewerContainer);
  root.appendChild(container);

  // Initialize 3D viewer dynamically
  let viewer = null;
  async function ensureViewer() {
    if (!viewer && !isUnmounted) {
      try {
        const viewerModule = await import('../../viewer/index.js');
        if (!isUnmounted && viewerModule && typeof viewerModule.createViewer === 'function') {
          viewer = viewerModule.createViewer(viewerContainer);
        }
      } catch (err) {
        console.warn('createViewer failed:', err);
      }
    }
    return viewer;
  }

  let isUnmounted = false;
  let activeCheck = null;
  let errorMessage = '';

  function setErrorMessage(msg) {
    errorMessage = msg || '';
    renderPanel();
  }

  async function loadData() {
    try {
      panel.innerHTML = '';
      panel.appendChild(h('div', { class: 'check-loading' }, CHECK_VOCAB.loading));

      const [checkData, meshData] = await Promise.all([
        ctx.api.caseCheck(caseId),
        ctx.api.caseMesh(caseId).catch((err) => {
          console.warn('Mesh fetch error:', err);
          return null;
        }),
        ensureViewer()
      ]);

      if (isUnmounted) return;

      activeCheck = checkData;

      if (viewer && meshData) {
        viewer.loadCase(meshData);
        const fdiLabels = (checkData.teeth || []).map((u) => {
          const fdi = universalToFdi(u);
          return {
            tooth: u,
            fdi,
            label: String(fdi ?? u)
          };
        });
        viewer.setLabels(fdiLabels);
        viewer.setLayers({ numbers: true });
      }

      renderPanel();
    } catch (err) {
      if (isUnmounted) return;
      setErrorMessage(err?.message || CHECK_VOCAB.fetchError);
    }
  }

  async function handleConfirm(state) {
    setErrorMessage('');
    const btn = panel.querySelector('.check-btn-primary');
    if (btn) btn.disabled = true;

    try {
      if (pid && sid) {
        await ctx.api.confirmScan(pid, sid, state.revision);
      }
      await ctx.api.activateCase(caseId);
      if (ctx.store) {
        ctx.store.set({ caseId, confirmed: true });
      }
      ctx.navigate(`#/workspace/${encodeURIComponent(caseId)}`);
    } catch (err) {
      if (btn) btn.disabled = false;
      const message = err?.message || (err?.status === 409 ? CHECK_VOCAB.conflict409 : CHECK_VOCAB.planStartFailed);
      setErrorMessage(message);
    }
  }

  async function handleMirror() {
    setErrorMessage('');
    const btn = panel.querySelector('.check-btn-mirror');
    if (btn) btn.disabled = true;

    try {
      if (pid && sid) {
        const updatedCheck = await ctx.api.mirrorScan(pid, sid);
        activeCheck = updatedCheck;

        // Reload mesh because numbering reversed
        try {
          const newMesh = await ctx.api.caseMesh(caseId);
          if (viewer && newMesh) {
            viewer.loadCase(newMesh);
            const fdiLabels = (updatedCheck.teeth || []).map((u) => {
              const fdi = universalToFdi(u);
              return { tooth: u, fdi, label: String(fdi ?? u) };
            });
            viewer.setLabels(fdiLabels);
            viewer.setLayers({ numbers: true });
          }
        } catch (meshErr) {
          console.warn('Mesh reload failed after mirror:', meshErr);
        }

        renderPanel();
      }
    } catch (err) {
      if (btn) btn.disabled = false;
      setErrorMessage(err?.message || CHECK_VOCAB.mirrorFailed);
    }
  }

  async function handleDelete() {
    setErrorMessage('');
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm(CHECK_VOCAB.confirmDeletePrompt)) {
        return;
      }
    }

    try {
      if (pid && sid) {
        await ctx.api.deleteScan(pid, sid);
        ctx.navigate(`#/patients/${encodeURIComponent(pid)}`);
      } else {
        ctx.navigate('#/cases');
      }
    } catch (err) {
      setErrorMessage(err?.message || CHECK_VOCAB.deleteFailed);
    }
  }

  function renderPanel() {
    clear(panel);

    const state = deriveCheckState(activeCheck);

    // Header
    const header = h('div', { class: 'check-header' },
      h('div', { class: 'check-header-top' },
        h('h1', { class: 'check-title' }, CHECK_VOCAB.title),
        h('span', {
          class: `badge ${state.isSupported ? 'badge-ready' : 'badge-violation'}`
        }, state.isSupported ? CHECK_VOCAB.supportedBadge : CHECK_VOCAB.unsupportedBadge)
      ),
      h('div', { class: 'check-subtitle' },
        `${pid ? pid + ' · ' : ''}${sid || caseId} · ${CHECK_VOCAB.versionSuffix(state.revision)}`
      )
    );
    panel.appendChild(header);

    // Scrollable Body
    const body = h('div', { class: 'check-body' });

    // Error Alert Banner
    if (errorMessage) {
      body.appendChild(h('div', { class: 'check-box check-box-error' },
        h('b', null, '오류: '),
        errorMessage
      ));
    }

    // Orientation: side === 'reversed' warning
    if (state.isReversed) {
      const mirrorBtn = h('button', {
        type: 'button',
        class: 'btn btn-ghost check-btn-mirror',
        onClick: handleMirror
      }, CHECK_VOCAB.mirrorButton);

      body.appendChild(h('div', { class: 'check-box check-box-warning' },
        h('b', null, CHECK_VOCAB.reversedTitle),
        h('p', null, CHECK_VOCAB.reversedDesc),
        mirrorBtn
      ));
    }

    // Orientation: basis === 'none' caution notice
    if (state.hasOrientationNotice) {
      body.appendChild(h('div', { class: 'check-box check-box-notice' },
        h('b', null, CHECK_VOCAB.orientationNoticeTitle),
        h('p', null, state.orientationNote || CHECK_VOCAB.orientationDefaultNote)
      ));
    }

    // Unsupported: red danger box with reasons
    if (!state.isSupported) {
      const list = h('ul', { class: 'check-unsupported-list' },
        ...state.unsupportedReasons.map((why) => h('li', null, why))
      );
      body.appendChild(h('div', { class: 'check-box check-box-danger' },
        h('b', null, CHECK_VOCAB.unsupportedTitle),
        h('p', null, CHECK_VOCAB.unsupportedDesc),
        list
      ));
    }

    // Inspection Summary Details (DL)
    const dl = h('dl', { class: 'check-dl' });

    function addRow(term, desc, isBad = false) {
      dl.appendChild(h('dt', { class: 'check-dt' }, term));
      dl.appendChild(h('dd', { class: `check-dd ${isBad ? 'check-dd-bad' : ''}` }, desc));
    }

    const fdiToothList = state.fdiTeeth.map((t) => t.fdi).filter(Boolean).join(', ');
    addRow(CHECK_VOCAB.terms.teeth, CHECK_VOCAB.teethCountWithFdi(state.teeth.length, fdiToothList));

    const fdiMissingList = state.fdiMissing.map((t) => t.fdi).filter(Boolean).join(', ');
    addRow(CHECK_VOCAB.terms.missing, fdiMissingList || CHECK_VOCAB.emptyNone, state.missing.length > 0);

    const fdiOutsideList = state.fdiOutside.map((t) => t.fdi).filter(Boolean).join(', ');
    addRow(CHECK_VOCAB.terms.outside, fdiOutsideList || CHECK_VOCAB.emptyNone);

    addRow(CHECK_VOCAB.terms.crowding, CHECK_VOCAB.crowdingMm(state.crowding_mm));

    addRow(CHECK_VOCAB.terms.rotation, formatRotationSummary(state.rotations));

    addRow(CHECK_VOCAB.terms.vertical, formatVerticalSummary(state.verticals));

    addRow(CHECK_VOCAB.terms.gingiva, state.scannedGingiva ? CHECK_VOCAB.scannedGingiva : CHECK_VOCAB.generatedGingiva);

    addRow(CHECK_VOCAB.terms.orientation, formatOrientationSummary(state.orientation), state.hasOrientationNotice);

    body.appendChild(dl);

    // Tooth Width Table (FDI)
    if (state.widths.length > 0) {
      body.appendChild(h('h3', { class: 'check-section-title' }, CHECK_VOCAB.widthTableTitle));

      const tableRows = state.widths.map((w) =>
        h('tr', null,
          h('td', { class: 'check-td-tooth' }, CHECK_VOCAB.toothNumber(w.fdi)),
          h('td', { class: 'check-td-width' }, CHECK_VOCAB.widthMm(w.width_mm))
        )
      );

      const table = h('div', { class: 'check-table-wrap' },
        h('table', { class: 'check-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, CHECK_VOCAB.tableHeaderTooth),
              h('th', null, CHECK_VOCAB.tableHeaderWidth)
            )
          ),
          h('tbody', null, ...tableRows)
        )
      );
      body.appendChild(table);
    }

    body.appendChild(h('p', { class: 'check-hint' }, CHECK_VOCAB.hint3D));

    panel.appendChild(body);

    // Footer
    const footer = h('div', { class: 'check-footer' });

    const primaryBtn = h('button', {
      type: 'button',
      class: `btn btn-primary check-btn-primary ${state.primaryAction.disabled ? 'disabled' : ''}`,
      disabled: state.primaryAction.disabled,
      onClick: () => handleConfirm(state)
    }, state.primaryAction.label);

    footer.appendChild(primaryBtn);

    if (state.showDelete) {
      const deleteBtn = h('button', {
        type: 'button',
        class: 'btn btn-danger check-btn-delete',
        onClick: handleDelete
      }, CHECK_VOCAB.btnDelete);
      footer.appendChild(deleteBtn);
    }

    panel.appendChild(footer);
  }

  loadData();

  return () => {
    isUnmounted = true;
    if (viewer && typeof viewer.destroy === 'function') {
      viewer.destroy();
    }
    clear(root);
  };
}
