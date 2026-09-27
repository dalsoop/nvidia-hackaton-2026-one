import { projectNormalizedToScreen } from './math.js';

export function appendDiv(parent, className, hidden = false) {
  const element = document.createElement('div');
  element.className = className;
  element.hidden = hidden;
  parent.appendChild(element);
  return element;
}

export function projectToScreen(worldPos, camera, width, height) {
  const vector = worldPos.clone().project(camera);
  const { x, y } = projectNormalizedToScreen(vector.x, vector.y, width, height);
  return { x, y, visible: vector.z < 1.0 };
}

export function textSpan(className, text) {
  const span = document.createElement('span');
  if (className) span.className = className;
  span.textContent = text;
  return span;
}

export function replaceTooltipContent(tooltip, lines) {
  tooltip.replaceChildren();
  lines.forEach((line, index) => {
    if (index > 0) tooltip.append(document.createTextNode(' · '));
    const item = document.createElement(line.tag || 'span');
    if (line.className) item.className = line.className;
    item.textContent = line.text;
    tooltip.appendChild(item);
  });
}
