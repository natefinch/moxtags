// Menu toggle/close behavior for long-layout tag dropdown buttons.
//
// Extracted from content.js to enable direct testing. The toggle logic
// opens/closes a dropdown menu and registers a one-time close-on-outside-click
// handler via setTimeout(0) to avoid catching the triggering click.

/**
 * Install click-to-toggle behavior on a button/menu pair.
 * Clicking the button toggles the menu's .show class. When the menu opens,
 * a one-time mousedown capture handler is registered (via setTimeout(0)) that
 * closes the menu if the click target is outside the container.
 *
 * @param {Object} options
 * @param {HTMLElement} options.button - The toggle button element.
 * @param {HTMLElement} options.menu - The dropdown menu element.
 * @param {HTMLElement} options.container - Parent element containing both.
 * @param {Document} [options.document] - Document for event registration (default: global document).
 * @param {Function} [options.onOpen] - Called after the menu opens.
 * @param {Function} [options.onClose] - Called after the menu closes.
 */
export function installMenuToggle({ button, menu, container, document: doc, onOpen, onClose }) {
  doc = doc ?? document;

  button.addEventListener('click', (e) => {
    e.stopPropagation();

    // Close other open long-layout menus.
    doc.querySelectorAll('.moxtags-long-menu.show').forEach(m => {
      if (m !== menu) m.classList.remove('show');
    });

    if (menu.classList.contains('show')) {
      menu.classList.remove('show');
      if (onClose) onClose();
      return;
    }

    menu.classList.add('show');
    if (onOpen) onOpen();

    // Register a one-time close handler after a microtask so it
    // doesn't immediately catch the current click.
    setTimeout(() => {
      function closeOnOutsideClick(ev) {
        if (!container.contains(ev.target)) {
          menu.classList.remove('show');
          doc.removeEventListener('mousedown', closeOnOutsideClick, true);
          if (onClose) onClose();
        }
      }
      doc.addEventListener('mousedown', closeOnOutsideClick, true);
    }, 0);
  });
}
