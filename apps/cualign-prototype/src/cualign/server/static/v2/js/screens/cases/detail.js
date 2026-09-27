// Right detail panel component for cases screen

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { universalToFdi } from '../../domain/teeth.js';
import {
  FDI_COORDINATES,
  LABEL_CLOSE_DETAIL,
  LABEL_DEFAULT_CONDITIONS,
  LABEL_EXIST,
  LABEL_EXTRACTION,
  LABEL_GO_CHECK,
  LABEL_GUM_SCAN,
  LABEL_HEIGHT_CORRECTION,
  LABEL_MAXILLARY,
  LABEL_MISSING_OUTSIDE,
  LABEL_NONE,
  LABEL_NON_EXTRACTION,
  LABEL_OPEN_WORKSPACE,
  LABEL_ROTATION,
  LABEL_ROT_CORRECTION,
  LABEL_SCAN_CHECK,
  LABEL_TEETH_INFO,
  LABEL_VERTICAL
} from './data.js';

const LABEL_CROWDING = '\uCD1D\uC0DD';
const LABEL_TEETH = '\uCE58\uC544';

function createCloseSvg() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M6 6l12 12M18 6L6 18');
  svg.appendChild(path);
  return svg;
}

function buildToothNodes(checkData) {
  const nodes = [];
  const teethList = checkData?.teeth || [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const rotMap = checkData?.rotation_deg || {};
  const vertMap = checkData?.vertical_mm || {};

  for (const u of teethList) {
    const fdi = universalToFdi(u);
    if (!fdi || !FDI_COORDINATES[fdi]) {
      continue;
    }
    const pos = FDI_COORDINATES[fdi];
    const hasRot = Math.abs(rotMap[u] ?? rotMap[String(u)] ?? rotMap[fdi] ?? rotMap[String(fdi)] ?? 0) > 0.05;
    const hasVert = Math.abs(vertMap[u] ?? vertMap[String(u)] ?? vertMap[fdi] ?? vertMap[String(fdi)] ?? 0) > 0.05;

    const ringCls = hasRot
      ? 'cases-tooth-rotate'
      : hasVert
      ? 'cases-tooth-height'
      : 'cases-tooth-normal';

    const toothEl = h('div', {
      class: ['cases-tooth-node', ringCls],
      style: {
        '--tooth-x': `${pos.x}px`,
        '--tooth-y': `${pos.y}px`
      }
    }, String(fdi));

    nodes.push(toothEl);
  }

  const centerText = h('div', { class: 'cases-chart-center-label' },
    LABEL_MAXILLARY,
    h('br'),
    T.teethCount(teethList.length)
  );
  nodes.push(centerText);

  return nodes;
}

function buildCheckCards(checkData) {
  const nTeeth = checkData ? (checkData.n_teeth ?? checkData.teeth?.length ?? 14) : 14;
  const crowding = checkData ? `${checkData.crowding_mm ?? 0} mm` : '0 mm';

  const missingList = checkData?.missing || [];
  const outsideList = checkData?.outside || [];
  const missCount = missingList.length + outsideList.length;
  const missText = missCount > 0 ? `${missCount}\uAC1C` : LABEL_NONE;

  const rotMap = checkData?.rotation_deg || {};
  const rotEntries = Object.entries(rotMap).filter(([, v]) => Math.abs(v) > 0.05);
  let rotText = LABEL_NONE;
  if (rotEntries.length > 0) {
    rotEntries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const [topU, topDeg] = rotEntries[0];
    const fdi = universalToFdi(Number(topU)) || topU;
    rotText = `${fdi} \u00B7 ${Math.abs(topDeg)}\u00B0`;
  }

  const vertMap = checkData?.vertical_mm || {};
  const vertCount = Object.values(vertMap).filter((v) => Math.abs(v) > 0.05).length;
  const vertText = vertCount > 0 ? `${vertCount}\uAC1C` : LABEL_NONE;

  const gingivaText = checkData?.scanned_gingiva ? LABEL_EXIST : LABEL_NONE;

  const cardDefs = [
    { label: LABEL_TEETH, value: `${nTeeth}\uAC1C` },
    { label: LABEL_CROWDING, value: crowding },
    { label: LABEL_MISSING_OUTSIDE, value: missText },
    { label: LABEL_ROTATION, value: rotText },
    { label: LABEL_VERTICAL, value: vertText },
    { label: LABEL_GUM_SCAN, value: gingivaText }
  ];

  return cardDefs.map((def) =>
    h('div', { class: 'cases-check-card' },
      h('div', { class: 'cases-check-card-label' }, def.label),
      h('div', { class: 'cases-check-card-value' }, def.value)
    )
  );
}

function buildPrescriptionSection(selectedCase) {
  const isSample = selectedCase.kind === 'sample';
  const heading = isSample ? T.cases.colPrescription : T.workspace.conditions;
  const text = selectedCase.prescription || LABEL_DEFAULT_CONDITIONS;
  const note = selectedCase.note;

  const tags = [];
  const c = selectedCase.constraints;

  const isExtraction = Boolean(c?.allow_extraction);
  tags.push({ text: isExtraction ? LABEL_EXTRACTION : LABEL_NON_EXTRACTION, accent: false });

  if (c?.ipr_exclude_teeth && c.ipr_exclude_teeth.length > 0) {
    const fdiExcludes = c.ipr_exclude_teeth.map((u) => universalToFdi(u) || u);
    tags.push({ text: `IPR \uC81C\uC678 ${fdiExcludes.join(', ')}`, accent: true });
  }

  tags.push({ text: `\uBA74\uB2F9 ${c?.max_ipr_per_contact ?? '0.25'} mm`, accent: false });
  tags.push({ text: c?.stage_cap ? T.stagesCount(c.stage_cap) : '\uB2E8\uACC4 \uC0C1\uD55C \uC5C6\uC74C', accent: false });
  tags.push({ text: '\uC774\uB3D9 \uB3D9\uC2DC', accent: false });

  return h('div', { class: 'cases-detail-section' },
    h('div', { class: 'cases-detail-section-title' }, heading),
    h('div', { class: 'cases-detail-rx-main' }, text),
    note ? h('div', { class: 'cases-detail-rx-note' }, note) : null,
    h('div', { class: 'cases-detail-tags' },
      ...tags.map((t) => h('span', {
        class: ['cases-detail-tag', t.accent ? 'cases-detail-tag-accent' : ''].filter(Boolean)
      }, t.text))
    )
  );
}

export function renderDetail(container, {
  selectedCase = null,
  checkData = null,
  checkError = null,
  onClose = () => {},
  onNavigate = () => {}
} = {}) {
  clear(container);

  if (!selectedCase) {
    container.classList.add('cases-detail-empty');
    return container;
  }
  container.classList.remove('cases-detail-empty');

  // Header
  const header = h('div', { class: 'cases-detail-header' },
    h('div', { class: 'cases-detail-header-text' },
      h('div', { class: 'cases-detail-case-id' }, selectedCase.displayId),
      h('div', { class: 'cases-detail-case-title' }, selectedCase.displayTitle)
    ),
    h('button', {
      type: 'button',
      class: 'cases-detail-close-btn',
      'aria-label': LABEL_CLOSE_DETAIL,
      onClick: onClose
    }, createCloseSvg())
  );

  // Body
  const body = h('div', { class: 'cases-detail-body' });

  // 1. FDI Tooth Chart
  const chartBox = h('div', { class: 'cases-chart-box' }, ...buildToothNodes(checkData));
  const legend = h('div', { class: 'cases-chart-legend' },
    h('span', { class: 'cases-legend-item' },
      h('span', { class: 'cases-legend-dot-rotate' }),
      LABEL_ROT_CORRECTION
    ),
    h('span', { class: 'cases-legend-item' },
      h('span', { class: 'cases-legend-dot-height' }),
      LABEL_HEIGHT_CORRECTION
    )
  );
  const chartSection = h('div', { class: 'cases-detail-section' },
    h('div', { class: 'cases-detail-section-title' }, LABEL_TEETH_INFO),
    chartBox,
    legend
  );
  body.appendChild(chartSection);

  // 2. Scan check
  if (checkError) {
    body.appendChild(h('div', { class: 'cases-error-box' }, checkError));
  }
  const checkGrid = h('div', { class: 'cases-check-grid' }, ...buildCheckCards(checkData));
  const checkSection = h('div', { class: 'cases-detail-section' },
    h('div', { class: 'cases-detail-section-title' }, LABEL_SCAN_CHECK),
    checkGrid
  );
  body.appendChild(checkSection);

  // 3. Prescription / Conditions
  body.appendChild(buildPrescriptionSection(selectedCase));

  // Footer CTA button
  const isUnconfirmedScan = selectedCase.status === 'scan_check';
  const ctaLabel = isUnconfirmedScan ? LABEL_GO_CHECK : LABEL_OPEN_WORKSPACE;
  const targetRoute = isUnconfirmedScan
    ? `#/check/${encodeURIComponent(selectedCase.case_id)}`
    : `#/workspace/${encodeURIComponent(selectedCase.case_id)}`;

  const ctaBtn = h('a', {
    class: 'btn btn-primary cases-cta-btn',
    href: targetRoute,
    onClick: (e) => {
      e.preventDefault();
      onNavigate(targetRoute);
    }
  }, ctaLabel);

  const footer = h('div', { class: 'cases-detail-footer' }, ctaBtn);

  container.appendChild(header);
  container.appendChild(body);
  container.appendChild(footer);

  return container;
}
