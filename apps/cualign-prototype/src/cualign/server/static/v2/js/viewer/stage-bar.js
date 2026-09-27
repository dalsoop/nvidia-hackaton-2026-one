import { calculateTickPosition, getStageViolationsSummary } from './math.js';
import { VIEWER_T } from '../domain/vocab/viewer.js';
import { createTransportIcon } from './stage-icons.js';

export function createStageBar(container, { max = 0, value = 0, months = null, violations = [], onChange = null } = {}) {
  let currentMax = Number(max) || 0;
  let currentStage = Math.max(0, Math.min(currentMax, Number(value) || 0));
  let currentViolations = violations || [];
  let currentMonths = months ?? null;
  let isPlaying = false;
  let playTimer = null;

  const T = VIEWER_T.stageBar;

  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  bar.setAttribute('tabindex', '0');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', T.ariaLabel);

  const row = document.createElement('div');
  row.className = 'stage-bar-row';
  bar.appendChild(row);

  const firstBtn = document.createElement('button');
  firstBtn.type = 'button';
  firstBtn.className = 'stage-btn stage-first-btn';
  firstBtn.title = T.firstTitle;
  firstBtn.setAttribute('aria-label', T.firstTitle);
  firstBtn.appendChild(createTransportIcon('first'));
  row.appendChild(firstBtn);

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'stage-btn stage-play-btn';
  playBtn.title = T.playPauseTitle;
  playBtn.setAttribute('aria-label', T.playPauseTitle);
  playBtn.appendChild(createTransportIcon('play'));
  row.appendChild(playBtn);

  const trackWrap = document.createElement('div');
  trackWrap.className = 'stage-track-wrap';
  row.appendChild(trackWrap);

  const ticksContainer = document.createElement('div');
  ticksContainer.className = 'stage-ticks';
  trackWrap.appendChild(ticksContainer);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'stage-slider';
  slider.min = '0';
  slider.max = String(currentMax);
  slider.value = String(currentStage);
  slider.disabled = currentMax === 0;
  slider.setAttribute('aria-valuemin', '0');
  slider.setAttribute('aria-valuemax', String(currentMax));
  slider.setAttribute('aria-valuenow', String(currentStage));
  trackWrap.appendChild(slider);

  const marksContainer = document.createElement('div');
  marksContainer.className = 'stage-marks';
  trackWrap.appendChild(marksContainer);

  const lastBtn = document.createElement('button');
  lastBtn.type = 'button';
  lastBtn.className = 'stage-btn stage-last-btn';
  lastBtn.title = T.lastTitle;
  lastBtn.setAttribute('aria-label', T.lastTitle);
  lastBtn.appendChild(createTransportIcon('last'));
  row.appendChild(lastBtn);

  const label = document.createElement('div');
  label.className = 'stage-label';
  bar.appendChild(label);

  container.appendChild(bar);

  function updateLabel() {
    if (currentMax === 0) {
      label.textContent = T.noPlan;
    } else if (currentStage === 0) {
      label.textContent = currentMonths
        ? T.beforeTreatmentWithMonths(currentMax, currentMonths)
        : T.beforeTreatment(currentMax);
    } else {
      label.textContent = currentMonths
        ? T.stageLabelWithMonths(currentStage, currentMax, currentMonths)
        : T.stageLabel(currentStage, currentMax);
    }
  }

  function renderTicks() {
    ticksContainer.replaceChildren();
    if (currentMax <= 0 || currentMax > 40) return;

    for (let k = 0; k <= currentMax; k++) {
      const pct = calculateTickPosition(k, currentMax);
      const tick = document.createElement('span');
      tick.className = 'stage-tick';
      tick.style.left = `${pct.toFixed(2)}%`;
      ticksContainer.appendChild(tick);
    }
  }

  function renderMarks() {
    marksContainer.replaceChildren();
    if (currentMax <= 0) return;

    const summary = getStageViolationsSummary(currentViolations);

    for (const [stStr, s] of Object.entries(summary)) {
      const k = Number(stStr);
      if (k < 0 || k > currentMax) continue;

      const pct = calculateTickPosition(k, currentMax);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.className = `stage-violation-dot ${s.collision ? 'has-collision' : 'has-movelimit'}`;
      dot.style.left = `${pct.toFixed(2)}%`;

      const details = [];
      if (s.collision) details.push(T.collisionCount(s.collision));
      if (s.move_limit) details.push(T.moveLimitCount(s.move_limit));
      if (s.other) details.push(T.otherViolationCount(s.other));
      dot.title = T.stageViolationTitle(k, details);
      dot.setAttribute('aria-label', T.stageViolationTitle(k, details));

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        pause();
        goToStage(k);
      });

      marksContainer.appendChild(dot);
    }
  }

  function updateSliderFill() {
    const pct = calculateTickPosition(currentStage, currentMax);
    slider.style.setProperty('--track-fill', `${pct.toFixed(1)}%`);
    slider.setAttribute('aria-valuenow', String(currentStage));
  }

  function goToStage(n, notify = true) {
    const target = Math.max(0, Math.min(currentMax, Number(n) || 0));
    currentStage = target;
    slider.value = String(currentStage);
    updateSliderFill();
    updateLabel();
    if (notify && typeof onChange === 'function') {
      onChange(currentStage);
    }
  }

  function play() {
    if (currentMax <= 0) return;
    isPlaying = true;
    playBtn.classList.add('playing');
    playBtn.setAttribute('aria-pressed', 'true');
    playBtn.replaceChildren(createTransportIcon('pause'));
    if (playTimer) clearInterval(playTimer);

    playTimer = setInterval(() => {
      if (currentStage >= currentMax) {
        goToStage(0);
      } else {
        goToStage(currentStage + 1);
      }
    }, 350);
  }

  function pause() {
    isPlaying = false;
    playBtn.classList.remove('playing');
    playBtn.setAttribute('aria-pressed', 'false');
    playBtn.replaceChildren(createTransportIcon('play'));
    if (playTimer) {
      clearInterval(playTimer);
      playTimer = null;
    }
  }

  function togglePlay() {
    if (isPlaying) {
      pause();
    } else {
      if (currentStage >= currentMax) {
        goToStage(0);
      }
      play();
    }
  }

  playBtn.addEventListener('click', togglePlay);

  firstBtn.addEventListener('click', () => {
    pause();
    goToStage(0);
  });

  lastBtn.addEventListener('click', () => {
    pause();
    goToStage(currentMax);
  });

  slider.addEventListener('input', (e) => {
    pause();
    goToStage(Number(e.target.value));
  });

  function handleKeyDown(e) {
    if (e.target.tagName === 'INPUT' && e.target !== slider) return;
    if (e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      pause();
      goToStage(currentStage - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      pause();
      goToStage(currentStage + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      pause();
      goToStage(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      pause();
      goToStage(currentMax);
    } else if (e.key === ' ' || e.code === 'Space') {
      if (e.target === bar || e.target === slider || e.target.classList?.contains('stage-btn')) {
        e.preventDefault();
        togglePlay();
      }
    }
  }

  bar.addEventListener('keydown', handleKeyDown);
  if (container && container !== bar) {
    container.addEventListener('keydown', handleKeyDown);
  }

  updateSliderFill();
  updateLabel();
  renderTicks();
  renderMarks();

  function setStage(n) {
    goToStage(n, false);
  }

  function setMax(n) {
    currentMax = Math.max(0, Number(n) || 0);
    slider.max = String(currentMax);
    slider.disabled = currentMax === 0;
    slider.setAttribute('aria-valuemax', String(currentMax));
    if (currentStage > currentMax) {
      currentStage = currentMax;
    }
    slider.value = String(currentStage);
    updateSliderFill();
    updateLabel();
    renderTicks();
    renderMarks();
  }

  function setViolations(list) {
    currentViolations = list || [];
    renderMarks();
  }

  function setMonths(m) {
    currentMonths = m ?? null;
    updateLabel();
  }

  function destroy() {
    pause();
    bar.removeEventListener('keydown', handleKeyDown);
    if (container && container !== bar) {
      container.removeEventListener('keydown', handleKeyDown);
    }
    bar.remove();
  }

  return {
    setStage,
    setMax,
    setViolations,
    setMonths,
    getStage: () => currentStage,
    getMax: () => currentMax,
    play,
    pause,
    isPlaying: () => isPlaying,
    destroy
  };
}
