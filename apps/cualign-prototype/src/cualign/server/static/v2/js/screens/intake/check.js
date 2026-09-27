// Scan input check screen (J4 contract)
// Left panel: 380px inspection summary
// Center: 3D viewer with pretreatment mesh and FDI tooth labels

import { clear, h } from '../../ui/dom.js';
import { universalToFdi } from '../../domain/teeth.js';
import { T } from '../../domain/vocab.js';

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
        label: '계획할 수 없는 스캔',
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
    unsupportedReasons = ['스캔 점검 기준을 충족하지 못했습니다.'];
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
    ? { label: '번호 확인 — 계획 시작', disabled: false, type: 'confirm' }
    : { label: '계획할 수 없는 스캔', disabled: true, type: 'unsupported' };

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
  const map = {
    gingiva: '잇몸 기준',
    cervical: '치관 아래 경계 기준',
    occlusal: '교합면 기준',
    palate: '구개(입천장) 기준',
    none: '근거 없음'
  };
  return map[basis] || basis || '미지정';
}

export function formatRotationSummary(rotations) {
  if (!Array.isArray(rotations) || rotations.length === 0) {
    return '보정할 회전 없음';
  }
  return rotations
    .map((r) => `${r.fdi}번 ${r.deg > 0 ? '+' : ''}${r.deg}°`)
    .join(', ');
}

export function formatVerticalSummary(verticals) {
  if (!Array.isArray(verticals) || verticals.length === 0) {
    return '보정할 차이 없음';
  }
  return verticals
    .map((v) => `${v.fdi}번 ${v.mm > 0 ? '교합면 쪽' : '잇몸 쪽'} ${Math.abs(v.mm)}mm`)
    .join(', ');
}

export function formatOrientationSummary(orientation) {
  if (!orientation || typeof orientation !== 'object') {
    return '미지정';
  }
  const basis = formatBasis(orientation.basis);
  const rot = orientation.rotation_deg ? ` · ${orientation.rotation_deg}° 회전` : '';
  const renum = orientation.renumbered ? ' · 번호 좌우 뒤집음' : '';
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
      panel.appendChild(h('div', { class: 'check-loading' }, '스캔 점검 결과를 불러오는 중…'));

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
      setErrorMessage(err?.message || '스캔 점검 정보를 불러오지 못했습니다.');
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
      const message = err?.message || (err?.status === 409 ? '확인 충돌(409): 지원하지 않는 스캔이거나 개정판 충돌이 발생했습니다.' : '계획 시작에 실패했습니다.');
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
      setErrorMessage(err?.message || '좌우 번호 뒤집기에 실패했습니다.');
    }
  }

  async function handleDelete() {
    setErrorMessage('');
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('이 스캔과 파일을 삭제하시겠습니까? 되돌릴 수 없습니다.')) {
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
      setErrorMessage(err?.message || '스캔 삭제에 실패했습니다.');
    }
  }

  function renderPanel() {
    clear(panel);

    const state = deriveCheckState(activeCheck);

    // Header
    const header = h('div', { class: 'check-header' },
      h('div', { class: 'check-header-top' },
        h('h1', { class: 'check-title' }, '입력 확인'),
        h('span', {
          class: `badge ${state.isSupported ? 'badge-ready' : 'badge-violation'}`
        }, state.isSupported ? '계획 가능' : '지원 불가')
      ),
      h('div', { class: 'check-subtitle' },
        `${pid ? pid + ' · ' : ''}${sid || caseId} · 상악 (버전 ${state.revision})`
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
      }, '좌우 번호 뒤집기');

      body.appendChild(h('div', { class: 'check-box check-box-warning' },
        h('b', null, '치아 번호가 좌우 반대로 보입니다.'),
        h('p', null, '2번(우측)이 화면 왼쪽, 15번(좌측)이 화면 오른쪽에 와야 합니다. 번호를 뒤집으려면 아래 버튼을 누르세요.'),
        mirrorBtn
      ));
    }

    // Orientation: basis === 'none' caution notice
    if (state.hasOrientationNotice) {
      body.appendChild(h('div', { class: 'check-box check-box-notice' },
        h('b', null, '주의: 방향 근거 없음'),
        h('p', null, state.orientationNote || '방향 근거가 없어 입력 방향 그대로 둡니다. 3D에서 치아 방향을 확인하세요.')
      ));
    }

    // Unsupported: red danger box with reasons
    if (!state.isSupported) {
      const list = h('ul', { class: 'check-unsupported-list' },
        ...state.unsupportedReasons.map((why) => h('li', null, why))
      );
      body.appendChild(h('div', { class: 'check-box check-box-danger' },
        h('b', null, '계획할 수 없는 스캔'),
        h('p', null, '이 스캔은 현재 자동 계획 기준을 충족하지 못해 계획을 진행할 수 없습니다.'),
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
    addRow('치아', `${state.teeth.length}개 · FDI: ${fdiToothList || '없음'}`);

    const fdiMissingList = state.fdiMissing.map((t) => t.fdi).filter(Boolean).join(', ');
    addRow('누락', fdiMissingList || '없음', state.missing.length > 0);

    const fdiOutsideList = state.fdiOutside.map((t) => t.fdi).filter(Boolean).join(', ');
    addRow('범위 밖', fdiOutsideList || '없음');

    addRow('총생', `${state.crowding_mm} mm`);

    addRow('회전 보정 대상', formatRotationSummary(state.rotations));

    addRow('높이 보정 대상', formatVerticalSummary(state.verticals));

    addRow('잇몸 스캔', state.scannedGingiva ? '스캔 잇몸' : '표시용 생성 잇몸');

    addRow('방향 정렬', formatOrientationSummary(state.orientation), state.hasOrientationNotice);

    body.appendChild(dl);

    // Tooth Width Table (FDI)
    if (state.widths.length > 0) {
      body.appendChild(h('h3', { class: 'check-section-title' }, '치아 폭 표 (FDI)'));

      const tableRows = state.widths.map((w) =>
        h('tr', null,
          h('td', { class: 'check-td-tooth' }, `${w.fdi}번`),
          h('td', { class: 'check-td-width' }, `${w.width_mm} mm`)
        )
      );

      const table = h('div', { class: 'check-table-wrap' },
        h('table', { class: 'check-table' },
          h('thead', null,
            h('tr', null,
              h('th', null, 'FDI 치아'),
              h('th', null, '접촉 폭')
            )
          ),
          h('tbody', null, ...tableRows)
        )
      );
      body.appendChild(table);
    }

    body.appendChild(h('p', { class: 'check-hint' },
      '오른쪽 3D에서 치아 번호(FDI 칩)와 위치를 확인하세요.'
    ));

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
      }, '스캔 삭제');
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
