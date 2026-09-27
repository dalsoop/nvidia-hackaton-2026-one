export function createTransportIcon(kind) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  for (const [name, value] of Object.entries({ width: 14, height: 14, viewBox: '0 0 16 16', fill: 'currentColor' })) {
    svg.setAttribute(name, String(value));
  }
  svg.classList.add(`icon-${kind}`);
  const shapes = kind === 'first'
    ? [['rect', { x: 2, y: 3, width: 2, height: 10, rx: 1 }], ['polygon', { points: '13,3 5,8 13,13' }]]
    : kind === 'last'
      ? [['polygon', { points: '3,3 11,8 3,13' }], ['rect', { x: 12, y: 3, width: 2, height: 10, rx: 1 }]]
      : kind === 'pause'
        ? [['rect', { x: 3, y: 2, width: 3.5, height: 12, rx: 1 }], ['rect', { x: 9.5, y: 2, width: 3.5, height: 12, rx: 1 }]]
        : [['polygon', { points: '4,2 14,8 4,14' }]];
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(namespace, tag);
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, String(value));
    svg.appendChild(shape);
  }
  return svg;
}
