// SPDX-License-Identifier: MPL-2.0
"use strict";
const twpPDFToggle = (() => {
  const get = button => button.getAttribute('aria-pressed') === 'true';
  function set(button, enabled) {
    button.setAttribute('aria-pressed', String(!!enabled));
    button.querySelector('.pdf-toggle-state').textContent = enabled ? '开启' : '关闭';
  }
  for (const button of document.querySelectorAll('button.pdf-toggle')) {
    const state = document.createElement('span');
    state.className = 'pdf-toggle-state';
    state.setAttribute('aria-hidden', 'true');
    button.append(state);
    set(button, get(button));
    button.addEventListener('click', () => {
      set(button, !get(button));
      button.dispatchEvent(new Event('input', {bubbles: true}));
      button.dispatchEvent(new Event('change', {bubbles: true}));
    });
  }
  return {get, set};
})();
