// Left panel of the scan input check screen: header, notices, inspection
// summary, width table and the footer actions.

import { clear, h } from '../../ui/dom.js';
import { CHECK_VOCAB } from '../../domain/vocab/check.js';
import { formatOrientationSummary, formatRotationSummary, formatVerticalSummary } from './check-model.js';

export function renderCheckPanel(panel, view, handlers) {
  const { state, subtitle, errorMessage, isPatientCase, deletePending } = view;
  clear(panel);

  // Header
  const header = h('div', { class: 'check-header' },
    h('div', { class: 'check-header-top' },
      h('h1', { class: 'check-title' }, CHECK_VOCAB.title)
    ),
    h('div', { class: 'check-subtitle' },
      subtitle
    )
  );
  panel.appendChild(header);

  // Scrollable Body
  const body = h('div', { class: 'check-body' });

  // Error Alert Banner
  if (errorMessage) {
    body.appendChild(h('div', { class: 'check-box check-box-error' },
      h('b', null, CHECK_VOCAB.errorPrefix),
      errorMessage
    ));
  }

  // Orientation: side === 'reversed' warning
  if (state.isReversed && isPatientCase) {
    const mirrorBtn = h('button', {
      type: 'button',
      class: 'btn btn-ghost check-btn-mirror',
      onClick: handlers.onMirror
    }, CHECK_VOCAB.mirrorButton);

    body.appendChild(h('div', { class: 'check-box check-box-warning' },
      h('b', null, CHECK_VOCAB.reversedTitle),
      mirrorBtn
    ));
  }

  // Orientation: basis === 'none' caution notice
  if (state.hasOrientationNotice) {
    body.appendChild(h('div', { class: 'check-box check-box-notice' },
      h('b', null, CHECK_VOCAB.orientationNoticeTitle),
      state.orientationNote ? h('p', null, state.orientationNote) : null
    ));
  }

  // Unsupported: red danger box with reasons
  if (!state.isSupported) {
    const list = h('ul', { class: 'check-unsupported-list' },
      ...state.unsupportedReasons.map((why) => h('li', null, why))
    );
    body.appendChild(h('div', { class: 'check-box check-box-danger' },
      h('b', null, CHECK_VOCAB.unsupportedTitle),
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

  panel.appendChild(body);

  // Footer
  const footer = h('div', { class: 'check-footer' });

  const primaryBtn = h('button', {
    type: 'button',
    class: `btn btn-primary check-btn-primary ${state.primaryAction.disabled ? 'disabled' : ''}`,
    disabled: state.primaryAction.disabled,
    onClick: () => handlers.onConfirm(state)
  }, state.primaryAction.label);

  footer.appendChild(primaryBtn);

  if (state.showDelete && isPatientCase && deletePending) {
    footer.appendChild(h('div', { class: 'check-delete-confirm', role: 'alert' },
      h('span', null, CHECK_VOCAB.confirmDeletePrompt),
      h('button', {
        type: 'button',
        class: 'btn btn-danger check-btn-delete',
        onClick: handlers.onDelete
      }, CHECK_VOCAB.deleteConfirm),
      h('button', {
        type: 'button',
        class: 'btn btn-ghost',
        onClick: () => handlers.onDeletePending(false)
      }, CHECK_VOCAB.cancel)
    ));
  } else if (state.showDelete && isPatientCase) {
    const deleteBtn = h('button', {
      type: 'button',
      class: 'btn btn-danger check-btn-delete',
      onClick: () => handlers.onDeletePending(true)
    }, CHECK_VOCAB.btnDelete);
    footer.appendChild(deleteBtn);
  }

  panel.appendChild(footer);
}
