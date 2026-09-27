// Safe DOM creation helper without innerHTML usage

export function h(tag, props = null, ...children) {
  const el = document.createElement(tag);

  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined) {
        continue;
      }
      if (key === 'class' || key === 'className') {
        const cls = Array.isArray(value) ? value.filter(Boolean).join(' ') : String(value);
        if (cls) {
          el.className = cls;
        }
      } else if (key === 'style') {
        if (typeof value === 'object') {
          for (const [sKey, sVal] of Object.entries(value)) {
            if (sVal !== null && sVal !== undefined) {
              if (sKey.startsWith('--')) {
                el.style.setProperty(sKey, String(sVal));
              } else {
                el.style[sKey] = sVal;
              }
            }
          }
        } else {
          el.setAttribute('style', String(value));
        }
      } else if (key.startsWith('on') && typeof value === 'function') {
        const eventName = key.slice(2).toLowerCase();
        el.addEventListener(eventName, value);
      } else if (key === 'dataset' && typeof value === 'object') {
        for (const [dKey, dVal] of Object.entries(value)) {
          if (dVal !== null && dVal !== undefined) {
            el.dataset[dKey] = String(dVal);
          }
        }
      } else if (key in el && typeof el[key] !== 'function' && key !== 'list') {
        el[key] = value;
      } else {
        el.setAttribute(key, String(value));
      }
    }
  }

  appendChildren(el, children);
  return el;
}

function appendChildren(parent, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    if (Array.isArray(child)) {
      appendChildren(parent, child);
    } else if (child instanceof Node) {
      parent.appendChild(child);
    } else {
      parent.appendChild(document.createTextNode(String(child)));
    }
  }
}

export function clear(el) {
  if (!el) {
    return el;
  }
  while (el.firstChild) {
    el.removeChild(el.firstChild);
  }
  return el;
}
