// Patient & scan intake screen orchestrator (J3 contract)
// Left 280px patient list + new patient form; Center patient header, scan list, and scan upload

import { clear, h } from '../../ui/dom.js';
import { T } from '../../domain/vocab.js';
import { INTAKE_TEXTS } from '../../domain/vocab/intake.js';
import { renderUpload } from './upload.js';

function fmtDate(iso) {
  if (!iso) return '';
  return String(iso).slice(0, 16).replace('T', ' ');
}

export function mount(root, params, ctx) {
  clear(root);

  let isMounted = true;
  let allPatients = [];
  let currentPatient = null;
  let selectedPid = params?.pid || null;
  let isDeletingPatient = false;
  let deletingScanId = null;
  let patientError = null;
  let formError = null;

  // Root screen container
  const screenEl = h('div', { class: 'screen-intake' });
  const listPanelEl = h('aside', { class: 'panel-list intake-panel-list' });
  const mainPanelEl = h('section', { class: 'intake-main-panel' });

  screenEl.appendChild(listPanelEl);
  screenEl.appendChild(mainPanelEl);
  root.appendChild(screenEl);

  function renderListPanel() {
    clear(listPanelEl);

    // 1. Panel Header
    const countText = T.itemsCount(allPatients.length);
    const headerEl = h('div', { class: 'panel-header intake-list-header' },
      h('h3', { class: 'panel-title' }, T.cases.newPatient ? INTAKE_TEXTS.patientListTitle : INTAKE_TEXTS.patient),
      h('span', { class: 'panel-subtitle' }, countText)
    );

    // 2. New Patient Registration Form
    const aliasInput = h('input', {
      type: 'text',
      class: 'intake-input',
      name: 'alias',
      placeholder: INTAKE_TEXTS.aliasPlaceholder,
      maxlength: 40,
      autocomplete: 'off',
      required: true
    });

    const memoInput = h('input', {
      type: 'text',
      class: 'intake-input',
      name: 'memo',
      placeholder: INTAKE_TEXTS.memoPlaceholder,
      maxlength: 200,
      autocomplete: 'off'
    });

    const formErrorEl = h('div', { class: 'intake-form-error' }, formError || '');
    if (!formError) {
      formErrorEl.style.display = 'none';
    }

    const submitBtn = h('button', {
      type: 'submit',
      class: 'btn btn-primary intake-submit-btn'
    }, INTAKE_TEXTS.submitNewPatient);

    const formEl = h('form', {
      class: 'intake-patient-form',
      onSubmit: async (e) => {
        e.preventDefault();
        formError = null;
        renderListPanel();

        const alias = aliasInput.value.trim();
        const memo = memoInput.value.trim();

        if (!alias) {
          formError = INTAKE_TEXTS.aliasRequired;
          renderListPanel();
          return;
        }

        try {
          submitBtn.disabled = true;
          const newPatient = await ctx.api.createPatient(alias, memo);
          aliasInput.value = '';
          memoInput.value = '';
          formError = null;

          await loadPatientsData(newPatient.patient_id);
          if (ctx.navigate) {
            ctx.navigate(`#/patients/${encodeURIComponent(newPatient.patient_id)}`);
          }
        } catch (err) {
          formError = err?.message || T.errors.requestFailed;
          renderListPanel();
        } finally {
          submitBtn.disabled = false;
        }
      }
    },
      h('div', { class: 'intake-form-title' }, INTAKE_TEXTS.newPatientTitle),
      aliasInput,
      memoInput,
      formErrorEl,
      submitBtn
    );

    // 3. Patients List
    const itemsContainer = h('div', { class: 'intake-patient-items' });

    if (allPatients.length === 0) {
      const emptyEl = h('div', { class: 'intake-patient-empty' }, INTAKE_TEXTS.noPatients);
      itemsContainer.appendChild(emptyEl);
    } else {
      for (const p of allPatients) {
        const isSelected = p.patient_id === selectedPid;
        const scansCount = T.itemsCount(p.n_scans ?? p.scans?.length ?? 0);

        const card = h('button', {
          type: 'button',
          class: ['intake-patient-card', isSelected ? 'intake-patient-card-active' : ''],
          onClick: () => {
            if (selectedPid !== p.patient_id) {
              selectedPid = p.patient_id;
              isDeletingPatient = false;
              deletingScanId = null;
              patientError = null;
              if (ctx.navigate) {
                ctx.navigate(`#/patients/${encodeURIComponent(p.patient_id)}`);
              }
              loadCurrentPatient(p.patient_id);
              renderListPanel();
            }
          }
        },
          h('div', { class: 'intake-card-top' },
            h('span', { class: 'intake-card-alias' }, p.alias),
            h('span', { class: 'intake-card-id' }, p.patient_id)
          ),
          h('div', { class: 'intake-card-bottom' },
            h('span', { class: 'intake-card-meta' }, INTAKE_TEXTS.scanCountText(scansCount)),
            h('span', { class: 'intake-card-date' }, fmtDate(p.created_at))
          )
        );

        itemsContainer.appendChild(card);
      }
    }

    listPanelEl.appendChild(headerEl);
    listPanelEl.appendChild(formEl);
    listPanelEl.appendChild(itemsContainer);
  }

  function renderMainPanel() {
    clear(mainPanelEl);

    if (!currentPatient) {
      const noPatientEl = h('div', { class: 'intake-empty-view' },
        h('h2', { class: 'intake-empty-title' }, INTAKE_TEXTS.emptySelectionTitle),
        h('p', { class: 'intake-empty-desc' }, INTAKE_TEXTS.emptySelectionDesc)
      );
      mainPanelEl.appendChild(noPatientEl);
      return;
    }

    // 1. Patient Header
    const p = currentPatient;
    const headerEl = h('div', { class: 'intake-patient-header' });

    const headerTextEl = h('div', { class: 'intake-patient-header-text' },
      h('h2', { class: 'intake-patient-alias' }, p.alias),
      h('div', { class: 'intake-patient-meta' },
        INTAKE_TEXTS.patientMeta(p.patient_id, fmtDate(p.created_at), p.memo)
      )
    );

    // Patient Deletion Action with in-screen confirmation (no window.confirm)
    const headerActionsEl = h('div', { class: 'intake-patient-header-actions' });

    if (isDeletingPatient) {
      const confirmBox = h('div', { class: 'intake-inline-confirm-box', role: 'alert' },
        h('span', { class: 'intake-inline-confirm-text' },
          INTAKE_TEXTS.confirmDeletePatient(p.alias, p.patient_id)
        ),
        h('button', {
          type: 'button',
          class: 'btn btn-danger small',
          onClick: async () => {
            try {
              await ctx.api.deletePatient(p.patient_id);
              isDeletingPatient = false;
              currentPatient = null;
              selectedPid = null;

              if (ctx.store) {
                const curCase = ctx.store.get().caseId;
                if (curCase && curCase.startsWith(p.patient_id)) {
                  ctx.store.set({ caseId: null });
                }
              }

              await loadPatientsData();
              if (allPatients.length > 0) {
                const nextPid = allPatients[0].patient_id;
                selectedPid = nextPid;
                if (ctx.navigate) {
                  ctx.navigate(`#/patients/${encodeURIComponent(nextPid)}`);
                }
                await loadCurrentPatient(nextPid);
              } else {
                if (ctx.navigate) {
                  ctx.navigate('#/cases');
                }
                renderMainPanel();
              }
            } catch (err) {
              patientError = err?.message || T.errors.requestFailed;
              renderMainPanel();
            }
          }
        }, INTAKE_TEXTS.deleteConfirmBtn),
        h('button', {
          type: 'button',
          class: 'btn btn-ghost small',
          onClick: () => {
            isDeletingPatient = false;
            renderMainPanel();
          }
        }, INTAKE_TEXTS.cancelBtn)
      );
      headerActionsEl.appendChild(confirmBox);
    } else {
      const deleteBtn = h('button', {
        type: 'button',
        class: 'btn btn-ghost intake-delete-patient-btn',
        title: INTAKE_TEXTS.deletePatientTitle,
        onClick: () => {
          isDeletingPatient = true;
          renderMainPanel();
        }
      }, INTAKE_TEXTS.deletePatientBtn);
      headerActionsEl.appendChild(deleteBtn);
    }

    headerEl.appendChild(headerTextEl);
    headerEl.appendChild(headerActionsEl);
    mainPanelEl.appendChild(headerEl);

    if (patientError) {
      const errorBar = h('div', { class: 'upload-error-card intake-error-bar', role: 'alert' }, patientError);
      mainPanelEl.appendChild(errorBar);
    }

    // 2. Scan List Section
    const scans = p.scans || [];
    const scanSectionEl = h('div', { class: 'intake-scans-section' },
      h('div', { class: 'intake-section-header' },
        h('h3', { class: 'intake-section-title' }, INTAKE_TEXTS.scanListTitle),
        h('span', { class: 'intake-section-badge' }, T.itemsCount(scans.length))
      )
    );

    if (scans.length === 0) {
      const emptyScansEl = h('div', { class: 'intake-scans-empty' },
        INTAKE_TEXTS.noScans
      );
      scanSectionEl.appendChild(emptyScansEl);
    } else {
      const scanListEl = h('div', { class: 'intake-scans-list' });

      // Show newest scans first
      for (const sc of [...scans].reverse()) {
        const isConfirmed = sc.confirmed_revision != null && sc.confirmed_revision === (sc.revision ?? 1);
        const caseId = sc.case_id || `${p.patient_id}-${sc.scan_id}`;
        const isThisDeleting = deletingScanId === sc.scan_id;

        const scanRowEl = h('div', { class: 'intake-scan-row' });

        // Left info
        const scanInfoEl = h('div', { class: 'intake-scan-info' },
          h('div', { class: 'intake-scan-title-row' },
            h('span', { class: 'intake-scan-id font-bold' }, INTAKE_TEXTS.scanMaxilla(sc.scan_id)),
            h('span', {
              class: ['badge', isConfirmed ? 'badge-ready' : 'badge-scan-check']
            }, isConfirmed ? INTAKE_TEXTS.confirmedBadge : INTAKE_TEXTS.unconfirmedBadge)
          ),
          h('div', { class: 'intake-scan-meta' },
            INTAKE_TEXTS.scanMeta({
              teethCount: sc.teeth?.length || 0,
              hasGingiva: Boolean(sc.gingiva),
              uploadedAt: fmtDate(sc.uploaded_at),
              isConfirmed,
              plansCount: sc.plans ?? 0
            })
          )
        );

        // Right actions
        const scanActionsEl = h('div', { class: 'intake-scan-actions' });

        if (isThisDeleting) {
          const confirmBox = h('div', { class: 'intake-inline-confirm-box', role: 'alert' },
            h('span', { class: 'intake-inline-confirm-text' }, INTAKE_TEXTS.confirmDeleteScan(sc.scan_id)),
            h('button', {
              type: 'button',
              class: 'btn btn-danger small',
              onClick: async () => {
                try {
                  await ctx.api.deleteScan(p.patient_id, sc.scan_id);
                  deletingScanId = null;

                  if (ctx.store) {
                    const curCase = ctx.store.get().caseId;
                    if (curCase === caseId) {
                      ctx.store.set({ caseId: null });
                    }
                  }

                  await loadCurrentPatient(p.patient_id);
                } catch (err) {
                  patientError = err?.message || T.errors.requestFailed;
                  deletingScanId = null;
                  renderMainPanel();
                }
              }
            }, INTAKE_TEXTS.deleteConfirmBtn),
            h('button', {
              type: 'button',
              class: 'btn btn-ghost small',
              onClick: () => {
                deletingScanId = null;
                renderMainPanel();
              }
            }, INTAKE_TEXTS.cancelBtn)
          );
          scanActionsEl.appendChild(confirmBox);
        } else {
          // Check scan button navigating to #/check/<pid>-<sid>
          const checkBtn = h('a', {
            href: `#/check/${encodeURIComponent(caseId)}`,
            class: 'btn btn-ghost small intake-check-btn',
            onClick: (e) => {
              if (ctx.store) {
                ctx.store.set({ caseId });
              }
              if (ctx.navigate) {
                e.preventDefault();
                ctx.navigate(`#/check/${encodeURIComponent(caseId)}`);
              }
            }
          }, INTAKE_TEXTS.checkScanBtn);

          // Delete scan button with in-screen confirmation
          const delBtn = h('button', {
            type: 'button',
            class: 'btn btn-ghost small intake-scan-del-btn',
            title: INTAKE_TEXTS.deleteScanTitle,
            onClick: () => {
              deletingScanId = sc.scan_id;
              renderMainPanel();
            }
          }, INTAKE_TEXTS.deleteScanBtn);

          scanActionsEl.appendChild(checkBtn);
          scanActionsEl.appendChild(delBtn);
        }

        scanRowEl.appendChild(scanInfoEl);
        scanRowEl.appendChild(scanActionsEl);
        scanListEl.appendChild(scanRowEl);
      }

      scanSectionEl.appendChild(scanListEl);
    }

    mainPanelEl.appendChild(scanSectionEl);

    // 3. Scan Upload Section (rendered via upload.js)
    const uploadSectionEl = h('div', { class: 'intake-upload-wrapper' });
    renderUpload(uploadSectionEl, {
      patient: currentPatient,
      ctx,
      onUploaded: async () => {
        if (p?.patient_id) {
          await loadCurrentPatient(p.patient_id);
        }
      }
    });

    mainPanelEl.appendChild(uploadSectionEl);
  }

  async function loadPatientsData(preferredPid = null) {
    try {
      const res = await ctx.api.listPatients();
      if (!isMounted) return;

      allPatients = res.patients || [];
      renderListPanel();

      const targetPid = preferredPid || selectedPid;
      if (targetPid) {
        await loadCurrentPatient(targetPid);
      } else if (allPatients.length > 0) {
        selectedPid = allPatients[0].patient_id;
        if (ctx.navigate) {
          ctx.navigate(`#/patients/${encodeURIComponent(selectedPid)}`);
        }
        await loadCurrentPatient(selectedPid);
      } else {
        currentPatient = null;
        renderMainPanel();
      }
    } catch (err) {
      if (!isMounted) return;
      patientError = err?.message || T.errors.server;
      renderMainPanel();
    }
  }

  async function loadCurrentPatient(pid) {
    if (!pid) {
      currentPatient = null;
      renderMainPanel();
      return;
    }

    try {
      const p = await ctx.api.getPatient(pid);
      if (!isMounted) return;
      currentPatient = p;
      selectedPid = pid;
      patientError = null;
      renderListPanel();
      renderMainPanel();
    } catch (err) {
      if (!isMounted) return;
      currentPatient = null;
      patientError = err?.message || T.errors.notFound;
      renderMainPanel();
    }
  }

  loadPatientsData(params?.pid);

  return () => {
    isMounted = false;
    clear(root);
  };
}
