// Right detail panel component for cases screen

import { clear, h } from '../../ui/dom.js';
import { universalToFdi } from '../../domain/teeth.js';
import { TCases } from '../../domain/vocab/cases.js';
import { FDI_COORDINATES, formatConstraintTags } from './data.js';

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
  if (!checkData || !Array.isArray(checkData.teeth) || checkData.teeth.length === 0) {
    return [];
  }
  const nodes = [];
  const teethList = checkData.teeth;
  const rotMap = checkData.rotation_deg || {};
  const vertMap = checkData.vertical_mm || {};

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
    TCases.maxillary,
    h('br'),
    TCases.teethCount(teethList.length)
  );
  nodes.push(centerText);

  return nodes;
}

function buildCheckCards(checkData) {
  if (!checkData) {
    return [];
  }
  const nTeeth = checkData.n_teeth ?? checkData.teeth?.length ?? 0;
  const crowding = typeof checkData.crowding_mm === 'number' ? `${checkData.crowding_mm} mm` : '0 mm';

  const missingList = checkData.missing || [];
  const outsideList = checkData.outside || [];
  const missCount = missingList.length + outsideList.length;
  const missText = missCount > 0 ? TCases.teethUnit(missCount) : TCases.none;

  const rotMap = checkData.rotation_deg || {};
  const rotEntries = Object.entries(rotMap).filter(([, v]) => Math.abs(v) > 0.05);
  let rotText = TCases.none;
  if (rotEntries.length > 0) {
    rotEntries.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    const [topU, topDeg] = rotEntries[0];
    const fdi = universalToFdi(Number(topU)) || topU;
    rotText = `${fdi} · ${Math.abs(topDeg)}°`;
  }

  const vertMap = checkData.vertical_mm || {};
  const vertCount = Object.values(vertMap).filter((v) => Math.abs(v) > 0.05).length;
  const vertText = vertCount > 0 ? TCases.teethUnit(vertCount) : TCases.none;

  const gingivaText = checkData.scanned_gingiva ? TCases.exist : TCases.none;

  const cardDefs = [
    { label: TCases.teeth, value: TCases.teethUnit(nTeeth) },
    { label: TCases.crowding, value: crowding },
    { label: TCases.missingOutside, value: missText },
    { label: TCases.rotation, value: rotText },
    { label: TCases.vertical, value: vertText },
    { label: TCases.gumScan, value: gingivaText }
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
  const heading = isSample ? TCases.colPrescription : TCases.conditions;
  const text = selectedCase.prescription || TCases.defaultConditions;
  const note = selectedCase.note;
  const tags = formatConstraintTags(selectedCase.constraints);

  return h('div', { class: 'cases-detail-section' },
    h('div', { class: 'cases-detail-section-title' }, heading),
    h('div', { class: 'cases-detail-rx-main' }, text),
    note ? h('div', { class: 'cases-detail-rx-note' }, note) : null,
    tags.length > 0
      ? h('div', { class: 'cases-detail-tags' },
          ...tags.map((t) => h('span', {
            class: ['cases-detail-tag', t.accent ? 'cases-detail-tag-accent' : ''].filter(Boolean)
          }, t.text))
        )
      : null
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
      'aria-label': TCases.closeDetail,
      onClick: onClose
    }, createCloseSvg())
  );

  // Body
  const body = h('div', { class: 'cases-detail-body' });

  // 1. Error state for check
  if (checkError) {
    body.appendChild(h('div', { class: 'cases-error-box' }, checkError));
  } else if (checkData) {
    // Tooth Chart
    const toothNodes = buildToothNodes(checkData);
    if (toothNodes.length > 0) {
      const chartBox = h('div', { class: 'cases-chart-box' }, ...toothNodes);
      const legend = h('div', { class: 'cases-chart-legend' },
        h('span', { class: 'cases-legend-item' },
          h('span', { class: 'cases-legend-dot-rotate' }),
          TCases.rotCorrectionTarget
        ),
        h('span', { class: 'cases-legend-item' },
          h('span', { class: 'cases-legend-dot-height' }),
          TCases.heightCorrectionTarget
        )
      );
      const chartSection = h('div', { class: 'cases-detail-section' },
        h('div', { class: 'cases-detail-section-title' }, TCases.teethInfo),
        chartBox,
        legend
      );
      body.appendChild(chartSection);
    }

    // 2. Scan check cards
    const checkCards = buildCheckCards(checkData);
    if (checkCards.length > 0) {
      const checkGrid = h('div', { class: 'cases-check-grid' }, ...checkCards);
      const checkSection = h('div', { class: 'cases-detail-section' },
        h('div', { class: 'cases-detail-section-title' }, TCases.scanCheck),
        checkGrid
      );
      body.appendChild(checkSection);
    }
  }

  // 3. Prescription / Conditions
  body.appendChild(buildPrescriptionSection(selectedCase));

  // Footer CTA button
  const isUnconfirmedScan = selectedCase.status === 'scan_check';
  const ctaLabel = isUnconfirmedScan ? TCases.goToScanCheck : TCases.openWorkspace;
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
