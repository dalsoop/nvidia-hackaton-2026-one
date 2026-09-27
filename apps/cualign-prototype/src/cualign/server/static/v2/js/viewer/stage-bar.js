// Viewer stage scrubber bar (J5 contract)
// 440px bar at bottom-right with play, first, track, ticks, violation red dots, last, stage label, and keyboard controls (←→, Home, End)

import { calculateTickPosition, getStageViolationsSummary } from './math.js';

/**
 * Creates the 440px stage scrubber bar.
 *
 * @param {HTMLElement} container
 * @param {object} [options]
 * @param {number} [options.max=0]
 * @param {number} [options.value=0]
 * @param {Array} [options.violations=[]]
 * @param {(stage: number) => void} [options.onChange]
 * @returns {{ setStage: (n: number) => void, setMax: (n: number) => void, setViolations: (v: Array) => void, destroy: () => void }}
 */
export function createStageBar(container, { max = 0, value = 0, violations = [], onChange = null } = {}) {
  let currentMax = Number(max) || 0;
  let currentStage = Math.max(0, Math.min(currentMax, Number(value) || 0));
  let currentViolations = violations || [];
  let isPlaying = false;
  let playTimer = null;

  // Root bar container
  const bar = document.createElement('div');
  bar.className = 'stage-bar';
  bar.setAttribute('tabindex', '0');
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', '3D 단계 제어기');

  // Top/main row
  const row = document.createElement('div');
  row.className = 'stage-bar-row';
  bar.appendChild(row);

  // 1. First button (|◀)
  const firstBtn = document.createElement('button');
  firstBtn.type = 'button';
  firstBtn.className = 'stage-btn stage-first-btn';
  firstBtn.title = '처음 단계 (Home)';
  firstBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <rect x="2" y="3" width="2" height="10" rx="1" />
      <polygon points="13,3 5,8 13,13" />
    </svg>
  `;
  row.appendChild(firstBtn);

  // 2. Play/Pause button (▶ / ⏸)
  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'stage-btn stage-play-btn';
  playBtn.title = '재생 / 일시정지 (Space)';
  playBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="icon-play">
      <polygon points="4,2 14,8 4,14" />
    </svg>
  `;
  row.appendChild(playBtn);

  // 3. Track and Scrubber Slider
  const trackWrap = document.createElement('div');
  trackWrap.className = 'stage-track-wrap';
  row.appendChild(trackWrap);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'stage-slider';
  slider.min = '0';
  slider.max = String(currentMax);
  slider.value = String(currentStage);
  slider.disabled = currentMax === 0;
  trackWrap.appendChild(slider);

  const marksContainer = document.createElement('div');
  marksContainer.className = 'stage-marks';
  trackWrap.appendChild(marksContainer);

  // 4. Last button (▶|)
  const lastBtn = document.createElement('button');
  lastBtn.type = 'button';
  lastBtn.className = 'stage-btn stage-last-btn';
  lastBtn.title = '최종 단계 (End)';
  lastBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
      <polygon points="3,3 11,8 3,13" />
      <rect x="12" y="3" width="2" height="10" rx="1" />
    </svg>
  `;
  row.appendChild(lastBtn);

  // 5. Label ("단계 N / M")
  const label = document.createElement('div');
  label.className = 'stage-label';
  bar.appendChild(label);

  container.appendChild(bar);

  function updateLabel() {
    if (currentMax === 0) {
      label.textContent = '계획 없음';
    } else if (currentStage === 0) {
      label.textContent = `치료 전 · 총 ${currentMax}단계`;
    } else {
      label.textContent = `단계 ${currentStage} / ${currentMax}`;
    }
  }

  function renderMarks() {
    marksContainer.innerHTML = '';
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
      if (s.collision) details.push(`충돌 ${s.collision}건`);
      if (s.move_limit) details.push(`이동한계 초과 ${s.move_limit}건`);
      dot.title = `단계 ${k}: ${details.join(', ')}`;

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
    playBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="icon-pause">
        <rect x="3" y="2" width="3.5" height="12" rx="1" />
        <rect x="9.5" y="2" width="3.5" height="12" rx="1" />
      </svg>
    `;
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
    playBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" class="icon-play">
        <polygon points="4,2 14,8 4,14" />
      </svg>
    `;
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

  // Event Listeners
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

  // Keyboard controls: ArrowLeft, ArrowRight, Home, End, Space
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

  // Initial render
  updateSliderFill();
  updateLabel();
  renderMarks();

  function setStage(n) {
    goToStage(n, false);
  }

  function setMax(n) {
    currentMax = Math.max(0, Number(n) || 0);
    slider.max = String(currentMax);
    slider.disabled = currentMax === 0;
    if (currentStage > currentMax) {
      currentStage = currentMax;
    }
    slider.value = String(currentStage);
    updateSliderFill();
    updateLabel();
    renderMarks();
  }

  function setViolations(list) {
    currentViolations = list || [];
    renderMarks();
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
    getStage: () => currentStage,
    getMax: () => currentMax,
    play,
    pause,
    isPlaying: () => isPlaying,
    destroy
  };
}
