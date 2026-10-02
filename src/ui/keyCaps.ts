import { el } from './dom';

/** Key-cap tokens that are mouse buttons rather than keyboard keys. */
const MOUSE_CAPS: Record<string, { side: 'left' | 'right'; label: string }> = {
  LMB: { side: 'left', label: 'LEFT CLICK' },
  RMB: { side: 'right', label: 'RIGHT CLICK' },
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * One key cap: a keyboard key ("SPACE", "E") or a mouse button ("LMB" /
 * "RMB") drawn as a little mouse with that button lit. `compact` drops the
 * mouse button's words (the HUD legend), keeping the picture.
 */
export function keyCap(token: string, parent: HTMLElement, compact = false): HTMLElement {
  const mouse = MOUSE_CAPS[token];
  const cap = el('kbd', mouse ? 'bf-kbd bf-kbd-mouse' : 'bf-kbd', parent);
  if (!mouse) {
    cap.textContent = token;
    return cap;
  }
  cap.setAttribute('aria-label', mouse.label.toLowerCase());
  cap.appendChild(mouseGlyph(mouse.side));
  if (!compact) el('span', '', cap).textContent = mouse.label;
  return cap;
}

/** A mouse outline with one button filled in. */
function mouseGlyph(side: 'left' | 'right'): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 22');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('bf-mouse-glyph');
  const hot = document.createElementNS(SVG_NS, 'path');
  hot.setAttribute('d', side === 'left' ? 'M8 1.5A6.5 6.5 0 0 0 1.5 8V9.5H8Z' : 'M8 1.5A6.5 6.5 0 0 1 14.5 8V9.5H8Z');
  hot.setAttribute('class', 'bf-mouse-hot');
  const body = document.createElementNS(SVG_NS, 'rect');
  body.setAttribute('x', '1.5');
  body.setAttribute('y', '1.5');
  body.setAttribute('width', '13');
  body.setAttribute('height', '19');
  body.setAttribute('rx', '6.5');
  body.setAttribute('class', 'bf-mouse-body');
  const seam = document.createElementNS(SVG_NS, 'path');
  seam.setAttribute('d', 'M8 1.5V9.5M1.5 9.5H14.5');
  seam.setAttribute('class', 'bf-mouse-body');
  svg.append(hot, body, seam);
  return svg;
}
